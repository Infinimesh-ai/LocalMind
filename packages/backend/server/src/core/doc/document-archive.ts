import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { z } from 'zod';

import { nativeAttachmentCells } from './document-attachments';
import { loadNativeDocument } from './document-editor';
import { ResourceError } from './resource-types';

export const DOCUMENT_ARCHIVE_FORMAT = 'localmind-native-document/v1' as const;
export const DOCUMENT_ARCHIVE_MIME = 'application/vnd.localmind.document+json';
export const DOCUMENT_ARCHIVE_LIMIT = 32 * 1024 * 1024;
const id = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const binary = z
  .object({
    base64: z.string().max(DOCUMENT_ARCHIVE_LIMIT * 2),
    fingerprint: hash,
    byteSize: z.number().int().nonnegative().max(DOCUMENT_ARCHIVE_LIMIT),
  })
  .strict();
const json: z.ZodType<Prisma.JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(json),
  ])
);
const evidence = {
  id,
  userId: id,
  content: json,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
};
export const documentArchiveComments = z
  .object({
    version: id,
    comments: z
      .array(z.object({ ...evidence, resolved: z.boolean() }).strip())
      .max(1000),
    replies: z
      .array(z.object({ ...evidence, commentId: id }).strip())
      .max(10000),
    attachments: z
      .array(
        z
          .object({
            workspaceId: id,
            docId: id,
            key: id,
            size: z.number().int().nonnegative(),
            mime: z.string().max(256),
            name: z.string().max(8192),
            createdAt: z.coerce.date(),
            createdBy: id.nullable(),
          })
          .strip()
      )
      .max(1000),
  })
  .strict();
export type DocumentCommentSnapshot = z.infer<typeof documentArchiveComments>;

export const documentArchive = z
  .object({
    format: z.literal(DOCUMENT_ARCHIVE_FORMAT),
    source: z
      .object({
        workspaceId: id,
        actorId: id,
        resource: z
          .object({ kind: z.enum(['blocksuite', 'office', 'file']), id })
          .strict(),
        version: z.string().min(1).max(2048),
        title: z.string().max(8192),
        metadataVersion: z.string().min(1).max(2048),
      })
      .strict(),
    content: binary.extend({ mimeType: z.string().max(256) }).strict(),
    officeState: binary.extend({ modelVersion: id }).strict().optional(),
    // Only signed server-produced archives can reach restore. These values are
    // preservation data, never arbitrary public mutation paths.
    metadata: z
      .object({
        properties: z.record(json),
        icon: json,
        tags: z.array(id).max(1000),
        definitions: z.array(z.record(json)).max(10000),
        tagDefinitions: z
          .array(
            z
              .object({
                id,
                name: z.string().max(8192),
                color: z.string().max(8192),
              })
              .strict()
          )
          .max(1000),
      })
      .strict(),
    comments: documentArchiveComments.optional(),
    assets: z
      .array(binary.extend({ key: id, mimeType: z.string().max(256) }).strict())
      .max(256),
    commentAssets: z
      .array(binary.extend({ key: id, mimeType: z.string().max(256) }).strict())
      .max(1000),
    externalReferences: z.literal('references-only'),
  })
  .strict();
export type DocumentArchive = z.infer<typeof documentArchive>;
export const archiveFingerprint = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export function archiveBinary(bytes: Uint8Array) {
  return {
    base64: Buffer.from(bytes).toString('base64'),
    fingerprint: archiveFingerprint(bytes),
    byteSize: bytes.length,
  };
}
export function archiveBytes(value: z.infer<typeof binary>) {
  const bytes = Buffer.from(value.base64, 'base64');
  if (
    bytes.toString('base64') !== value.base64 ||
    bytes.length !== value.byteSize ||
    archiveFingerprint(bytes) !== value.fingerprint
  )
    throw new ResourceError('invalid_input');
  return bytes;
}

function boundedJson(value: unknown, state = { count: 0 }, depth = 0): void {
  if (++state.count > 250000 || depth > 64)
    throw new ResourceError('content_too_large');
  if (value && typeof value === 'object')
    for (const child of Object.values(value))
      boundedJson(child, state, depth + 1);
}
export function decodeDocumentArchive(bytes: Buffer) {
  if (bytes.length > DOCUMENT_ARCHIVE_LIMIT)
    throw new ResourceError('content_too_large');
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ResourceError('invalid_input');
  }
  boundedJson(raw);
  const parsed = documentArchive.safeParse(raw);
  if (!parsed.success) throw new ResourceError('invalid_input');
  const value = parsed.data;
  for (const part of [
    value.content,
    ...value.assets,
    ...value.commentAssets,
    ...(value.officeState ? [value.officeState] : []),
  ])
    archiveBytes(part);
  if (
    (value.source.resource.kind === 'office') !== !!value.officeState ||
    (value.source.resource.kind === 'file' && !!value.comments)
  )
    throw new ResourceError('invalid_input');
  for (const list of [
    value.assets,
    value.commentAssets,
    value.comments?.comments ?? [],
    value.comments?.replies ?? [],
  ]) {
    const identities = list.map(item => ('key' in item ? item.key : item.id));
    if (new Set(identities).size !== identities.length)
      throw new ResourceError('invalid_input');
  }
  const comments = new Set(value.comments?.comments.map(row => row.id));
  if (value.comments?.replies.some(row => !comments.has(row.commentId)))
    throw new ResourceError('invalid_input');
  const attachments = value.comments?.attachments ?? [];
  if (
    attachments.length !== value.commentAssets.length ||
    attachments.some(
      row =>
        !value.commentAssets.some(
          asset =>
            asset.key === row.key &&
            asset.byteSize === row.size &&
            asset.mimeType === row.mime
        )
    )
  )
    throw new ResourceError('invalid_input');
  return value;
}
export function encodeDocumentArchive(value: DocumentArchive) {
  // Object ordering and ECDSA randomness must not change subsequent chunks.
  const canonical = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, canonical(value)])
      );
    return value;
  };
  const bytes = Buffer.from(JSON.stringify(canonical(value)));
  decodeDocumentArchive(bytes);
  return bytes;
}

/** Collect known blob identities, including rich-text marks and database URLs. */
export function nativeDocumentAssets(bytes: Uint8Array, workspaceId: string) {
  const document = loadNativeDocument(bytes),
    ids = new Set<string>();
  const prefix = `/api/workspaces/${encodeURIComponent(workspaceId)}/blobs/`;
  let count = 0;
  const visit = (value: unknown, key = '', depth = 0): void => {
    if (++count > 100000 || depth > 64)
      throw new ResourceError('content_too_large');
    if (typeof value === 'string') {
      if (
        /^(?:prop:)?(?:sourceId|blobId)$/.test(key) &&
        value &&
        !/^(?:https?:|\/)/i.test(value)
      )
        ids.add(value);
      if (value.startsWith(prefix)) {
        try {
          ids.add(
            decodeURIComponent(value.slice(prefix.length).split(/[?#]/, 1)[0])
          );
        } catch {
          throw new ResourceError('invalid_input');
        }
      }
    } else if (value instanceof Y.Text) visit(value.toDelta(), '', depth + 1);
    else if (value instanceof Y.Map)
      for (const [key, child] of value) visit(child, key, depth + 1);
    else if (value instanceof Y.Array || Array.isArray(value))
      value.forEach(child => visit(child, '', depth + 1));
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value))
        visit(child, key, depth + 1);
    if (ids.size > 256) throw new ResourceError('content_too_large');
  };
  try {
    for (const cell of nativeAttachmentCells(document.getMap('blocks'))) {
      for (const value of cell.values()) {
        const id = value instanceof Y.Map ? value.get('id') : undefined;
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
    visit(document.getMap('blocks'));
    return [...ids].sort();
  } finally {
    document.destroy();
  }
}
