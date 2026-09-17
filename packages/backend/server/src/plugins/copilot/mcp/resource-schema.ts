import { z } from 'zod';

import {
  RESOURCE_CONTENT_LIMIT,
  RESOURCE_CONTRACT_VERSION,
} from '../../../core/doc/resource-types';

const id = z.string().min(1).max(256);
const version = z.string().min(1).max(2048);
const title = z.string().trim().min(1).max(512);
const key = z.string().min(1).max(256);
const content = z
  .object({
    format: z.literal('markdown'),
    text: z.string().max(RESOURCE_CONTENT_LIMIT),
  })
  .strict();
const page = {
  cursor: z.string().min(1).max(4096).optional(),
  limit: z.number().int().min(1).max(100).default(50),
};

export const RESOURCE_INPUT_SCHEMAS = {
  workspace_doc_list: z
    .object({
      folderId: id.nullable().optional(),
      externalId: key.optional(),
      ...page,
    })
    .strict(),
  workspace_doc_keyword_search: z
    .object({
      query: z.string().trim().min(1).max(128),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  workspace_doc_read: z.object({ documentId: id }).strict(),
  workspace_doc_create: z
    .object({
      title,
      content,
      folderId: id.nullable().default(null),
      externalId: key.optional(),
      idempotencyKey: key,
    })
    .strict(),
  workspace_doc_update: z
    .object({
      documentId: id,
      content,
      expectedVersion: version,
      idempotencyKey: key,
    })
    .strict(),
  workspace_doc_update_meta: z
    .object({
      documentId: id,
      title,
      expectedVersion: version,
      idempotencyKey: key,
    })
    .strict(),
  workspace_folder_list: z
    .object({ parentId: id.nullable().default(null), ...page })
    .strict(),
  workspace_folder_create: z
    .object({
      title,
      parentId: id.nullable().default(null),
      expectedDirectoryVersion: version,
      idempotencyKey: key,
    })
    .strict(),
  workspace_folder_move_document: z
    .object({
      documentId: id,
      folderId: id.nullable(),
      expectedDirectoryVersion: version,
      idempotencyKey: key,
    })
    .strict(),
  workspace_operation_get: z.object({ operationId: id }).strict(),
} as const;
export type ResourceToolName = keyof typeof RESOURCE_INPUT_SCHEMAS;

const base = {
  contractVersion: z.literal(RESOURCE_CONTRACT_VERSION),
  workspaceId: id,
};
const error = z
  .object({
    code: z.enum([
      'invalid_input',
      'capability_denied',
      'resource_not_found',
      'permission_denied',
      'version_conflict',
      'directory_version_conflict',
      'cursor_stale',
      'idempotency_conflict',
      'external_id_conflict',
      'folder_name_conflict',
      'unsupported_document_kind',
      'unsupported_document_structure',
      'content_too_large',
      'quota_exceeded',
      'rate_limited',
      'operation_not_found',
      'temporarily_unavailable',
    ]),
    currentVersion: version.optional(),
  })
  .strict();
export const RESOURCE_FAILURE_SCHEMA = z
  .object({
    ...base,
    status: z.literal('failed'),
    operationId: id.optional(),
    toolName: z.string(),
    writeOutcome: z.literal('none'),
    error,
    replayed: z.boolean().optional(),
  })
  .strict();
const pending = z
  .object({
    ...base,
    status: z.enum(['processing', 'needs_reconciliation']),
    operationId: id,
    toolName: z.string(),
    writeOutcome: z.literal('unknown'),
    pollAfterMs: z.number().int(),
    replayed: z.boolean(),
  })
  .strict();
const locations = z
  .array(z.object({ folderId: id.nullable() }).strict())
  .max(10000);
const success = {
  ...base,
  status: z.literal('succeeded'),
  operationId: id,
  changed: z.boolean(),
  replayed: z.boolean(),
  writeOutcome: z.literal('committed'),
};
export const RESOURCE_RECEIPT_SCHEMA = z.discriminatedUnion('toolName', [
  z
    .object({
      ...success,
      toolName: z.literal('workspace_doc_create'),
      documentId: id,
      folderId: id.nullable(),
      version,
      directoryVersion: version,
      url: z.string(),
    })
    .strict(),
  z
    .object({
      ...success,
      toolName: z.literal('workspace_doc_update'),
      documentId: id,
      locations,
      version,
      url: z.string(),
    })
    .strict(),
  z
    .object({
      ...success,
      toolName: z.literal('workspace_doc_update_meta'),
      documentId: id,
      locations,
      version,
      url: z.string(),
    })
    .strict(),
  z
    .object({
      ...success,
      toolName: z.literal('workspace_folder_create'),
      folderId: id,
      parentId: id.nullable(),
      directoryVersion: version,
    })
    .strict(),
  z
    .object({
      ...success,
      toolName: z.literal('workspace_folder_move_document'),
      documentId: id,
      folderId: id.nullable(),
      directoryVersion: version,
      version,
      url: z.string(),
    })
    .strict(),
]);
export const RESOURCE_OPERATION_SCHEMA = z.union([
  RESOURCE_RECEIPT_SCHEMA,
  RESOURCE_FAILURE_SCHEMA,
  pending,
]);
const document = z
  .object({
    documentId: id,
    title: z.string(),
    documentType: z.enum(['page', 'edgeless', 'office', 'unknown']),
    locations,
    updatedAt: z.string(),
    version,
    url: z.string(),
  })
  .strict();
const readOutputs = {
  workspace_doc_list: z
    .object({
      ...base,
      items: z.array(document).max(100),
      nextCursor: z.string().nullable(),
    })
    .strict(),
  workspace_doc_keyword_search: z
    .object({
      ...base,
      items: z
        .array(
          z
            .object({
              documentId: id,
              title: z.string(),
              summary: z.string().max(512),
              url: z.string(),
            })
            .strict()
        )
        .max(20),
      retrievalMode: z.enum(['index', 'bounded_scan']),
      partial: z.boolean(),
      coverage: z.enum(['indexed', 'bounded']),
      reason: z.enum(['index_may_lag', 'index_unavailable']),
    })
    .strict(),
  workspace_doc_read: document
    .extend({
      ...base,
      content,
      contentWritable: z.boolean(),
      contentWriteReason: z
        .literal('unsupported_document_structure')
        .optional(),
    })
    .strict(),
  workspace_folder_list: z
    .object({
      ...base,
      directoryVersion: version,
      items: z
        .array(
          z
            .object({
              folderId: id,
              title: z.string(),
              parentId: id.nullable(),
              canWrite: z.boolean(),
              canOrganize: z.boolean(),
              canCreateFolder: z.boolean(),
            })
            .strict()
        )
        .max(100),
      nextCursor: z.string().nullable(),
    })
    .strict(),
};
export function resourceOutputSchema(name: ResourceToolName) {
  const output =
    name in readOutputs
      ? readOutputs[name as keyof typeof readOutputs]
      : RESOURCE_OPERATION_SCHEMA;
  return z
    .object({ result: z.union([output, RESOURCE_FAILURE_SCHEMA]) })
    .strict();
}
