import { WORKSPACE_PAGE_TREE_CONTRACT } from '@affine/graphql';
import { NativeFileContentSchema } from '@localmind/office';
import { z } from 'zod';

import {
  documentId,
  documentNativeBatch,
} from '../../../core/doc/document-schema';

export const documentDestination = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('legacy-folder'),
      folderId: documentId.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('page-tree'),
      contractVersion: z.literal(WORKSPACE_PAGE_TREE_CONTRACT),
      parentNodeId: documentId.nullable(),
      expectedRevision: z.number().int().nonnegative(),
      expectedAuthorizationRevision: z.string().min(1).max(2048),
    })
    .strict(),
]);
const common = {
  idempotencyKey: documentId,
  title: z.string().trim().min(1).max(480),
  destination: documentDestination,
};
const newId = documentId.regex(/^[A-Za-z0-9_-]{1,128}$/).optional();
export const documentCreate = z.union([
  z
    .object({
      ...common,
      resource: z.object({ kind: z.literal('blocksuite'), id: newId }).strict(),
      primaryMode: z.enum(['page', 'edgeless']).default('page'),
      commands: documentNativeBatch.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      resource: z
        .object({ kind: z.enum(['office', 'file']), id: newId })
        .strict(),
      content: NativeFileContentSchema,
    })
    .strict(),
]);
const documentFileImport = z
  .object({
    ...common,
    resource: z
      .object({ kind: z.enum(['office', 'file']), id: newId })
      .strict(),
    blobId: documentId,
  })
  .strict();

export const documentImport = z.union([
  documentFileImport,
  z
    .object({
      ...common,
      resource: z
        .object({ kind: z.enum(['blocksuite', 'office', 'file']), id: newId })
        .strict(),
      format: z.literal('native-bundle'),
      blobId: documentId,
      proof: z.string().min(1).max(2048),
    })
    .strict(),
]);
