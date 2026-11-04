import { OfficeCommandBatchSchema } from '@localmind/office';
import { z } from 'zod';

import { documentFileCommand } from '../../../core/doc/document-file-schema';
import { documentPropertiesPatch } from '../../../core/doc/document-properties';
import {
  DOCUMENT_CONTRACT_VERSION,
  documentId,
  documentNativeBatch,
} from '../../../core/doc/document-schema';
import { documentAccessCommand } from '../../../core/workspaces/document-access-schema';
import {
  documentUploadCommand,
  documentUploadResult,
} from './document-assets-schema';
import { documentCommentCommands } from './document-comments-schema';
import {
  documentCreate,
  documentDestination,
  documentImport,
} from './document-create-schema';

export const documentVersion = z.string().min(1).max(2048);
export const documentResource = z
  .object({
    kind: z.enum(['blocksuite', 'office', 'file']),
    id: documentId,
  })
  .strict();
const edit = { expectedVersion: documentVersion, idempotencyKey: documentId };
export const documentOperationResource = z.union([
  documentResource,
  z.object({ kind: z.literal('workspace'), id: documentId }).strict(),
]);
const companions = {
  metadata: z
    .object({
      expectedMetadataVersion: documentVersion,
      properties: documentPropertiesPatch,
    })
    .strict()
    .optional(),
  comments: z
    .object({
      expectedCommentsVersion: documentVersion,
      commands: documentCommentCommands,
    })
    .strict()
    .optional(),
};
type ApplyBase = {
  expectedVersion: string;
  idempotencyKey: string;
  planDigest?: string;
  metadata?: z.output<typeof companions.metadata>;
  comments?: z.output<typeof companions.comments>;
};
export type DocumentApply = ApplyBase &
  (
    | {
        resource: { kind: 'blocksuite'; id: string };
        commands: z.output<typeof documentNativeBatch>;
      }
    | {
        resource: { kind: 'office'; id: string };
        batch: z.output<typeof OfficeCommandBatchSchema>;
      }
    | {
        resource: { kind: 'file'; id: string };
        commands: z.output<typeof documentFileCommand>[];
      }
  );
type DocumentApplyInput = Omit<ApplyBase, 'metadata' | 'comments'> & {
  metadata?: z.input<typeof companions.metadata>;
  comments?: z.input<typeof companions.comments>;
} & (
    | {
        resource: { kind: 'blocksuite'; id: string };
        commands: z.input<typeof documentNativeBatch>;
      }
    | {
        resource: { kind: 'office'; id: string };
        batch: z.input<typeof OfficeCommandBatchSchema>;
      }
    | {
        resource: { kind: 'file'; id: string };
        commands: z.input<typeof documentFileCommand>[];
      }
  );
const documentApplySchema: z.ZodType<
  DocumentApply,
  z.ZodTypeDef,
  DocumentApplyInput
> = z.union([
  z
    .object({
      ...edit,
      ...companions,
      planDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      resource: z
        .object({ kind: z.literal('blocksuite'), id: documentId })
        .strict(),
      commands: documentNativeBatch,
    })
    .strict(),
  z
    .object({
      ...edit,
      ...companions,
      planDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      resource: z
        .object({ kind: z.literal('office'), id: documentId })
        .strict(),
      batch: OfficeCommandBatchSchema,
    })
    .strict(),
  z
    .object({
      ...edit,
      ...companions,
      planDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      resource: z.object({ kind: z.literal('file'), id: documentId }).strict(),
      commands: z.array(documentFileCommand).min(1).max(1000),
    })
    .strict(),
]);
export const documentApply: z.ZodType<
  DocumentApply,
  z.ZodTypeDef,
  DocumentApplyInput
> = documentApplySchema;

export const DOCUMENT_INPUT_SCHEMAS = {
  workspace_doc_duplicate: z
    .object({
      ...edit,
      source: documentResource,
      targetId: documentId.regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
      title: z.string().trim().min(1).max(480),
      destination: documentDestination,
      comments: z.enum(['copy', 'omit']),
      expectedCommentsVersion: documentVersion.optional(),
      expectedMetadataVersion: documentVersion.optional(),
    })
    .strict(),
  workspace_doc_access_read: z
    .object({
      resource: documentResource,
      expectedVersion: documentVersion,
      expectedAccessVersion: documentVersion.optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  workspace_doc_access_update: z
    .object({
      ...edit,
      resource: documentResource,
      expectedAccessVersion: documentVersion,
      command: documentAccessCommand,
    })
    .strict(),
  workspace_doc_comments_read: z
    .object({
      resource: documentResource,
      expectedVersion: documentVersion,
      expectedCommentsVersion: documentVersion.optional(),
      commentId: documentId.optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  workspace_doc_comments_apply: z
    .object({
      ...edit,
      resource: documentResource,
      expectedCommentsVersion: documentVersion,
      commands: documentCommentCommands,
    })
    .strict(),
  workspace_doc_lifecycle: z
    .object({
      ...edit,
      resource: documentResource,
      action: z.enum(['trash', 'restore', 'delete']),
      includeDescendants: z.boolean().default(false),
    })
    .strict(),
  workspace_doc_create_native: documentCreate,
  workspace_doc_import: documentImport,
  workspace_doc_asset_read: z
    .object({
      resource: documentResource,
      expectedVersion: documentVersion,
      blobId: documentId,
      offset: z.number().int().nonnegative().default(0),
      limit: z
        .number()
        .int()
        .min(1)
        .max(512 * 1024)
        .default(64 * 1024),
    })
    .strict(),
  workspace_doc_asset_upload: z
    .object({
      ...edit,
      resource: documentOperationResource,
      upload: documentUploadCommand,
    })
    .strict(),
  workspace_doc_inspect: z
    .object({
      resource: documentResource,
      view: z.enum(['content', 'lifecycle']).default('content'),
      lifecycleAction: z.enum(['trash', 'restore', 'delete']).default('trash'),
      expectedVersion: documentVersion.optional(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(200).default(100),
    })
    .strict(),
  workspace_doc_properties_update: z
    .object({
      ...edit,
      resource: documentResource,
      expectedMetadataVersion: documentVersion,
      properties: documentPropertiesPatch,
    })
    .strict(),
  workspace_doc_history_list: z
    .object({
      resource: documentResource,
      before: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  workspace_doc_history_read: z
    .object({
      resource: documentResource,
      revision: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative().default(0),
      limit: z
        .number()
        .int()
        .min(1)
        .max(512 * 1024)
        .default(64 * 1024),
    })
    .strict(),
  workspace_doc_history_restore: z
    .object({
      ...edit,
      resource: documentResource,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  workspace_doc_export: z
    .object({
      resource: documentResource,
      expectedVersion: documentVersion,
      format: z.enum(['native-content', 'native-bundle']),
      expectedBundleVersion: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      additionalBlobIds: z.array(documentId).max(256).default([]),
      offset: z.number().int().nonnegative().default(0),
      limit: z
        .number()
        .int()
        .min(1)
        .max(512 * 1024)
        .default(64 * 1024),
    })
    .strict(),
  workspace_doc_edit_preview: documentApply,
  workspace_doc_apply: documentApply,
} as const;
export type DocumentToolName = keyof typeof DOCUMENT_INPUT_SCHEMAS;
export const DOCUMENT_TOOL_NAMES = Object.keys(
  DOCUMENT_INPUT_SCHEMAS
) as DocumentToolName[];

const base = {
  contractVersion: z.literal(DOCUMENT_CONTRACT_VERSION),
  workspaceId: documentId,
};
const failure = z
  .object({
    ...base,
    status: z.literal('failed'),
    toolName: z.string().max(64),
    operationId: documentId.optional(),
    writeOutcome: z.literal('none'),
    replayed: z.boolean().optional(),
    error: z
      .object({
        code: z.string().max(64),
        stage: z.enum([
          'authorization',
          'validation',
          'concurrency',
          'preservation',
          'execution',
          'availability',
        ]),
        nextAction: z.enum([
          'request_access',
          'refresh_resource',
          'correct_input',
          'retry_same_request',
          'reduce_request',
          'contact_support',
        ]),
        currentVersion: documentVersion.optional(),
        detail: z
          .object({
            opId: documentId.optional(),
            objectId: documentId.optional(),
            field: z.string().max(512).optional(),
            reason: z.string().max(256),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
const pending = z
  .object({
    ...base,
    status: z.enum(['processing', 'needs_reconciliation']),
    operationId: documentId,
    toolName: z.string().max(64),
    writeOutcome: z.literal('unknown'),
    pollAfterMs: z.number().int().positive(),
    replayed: z.literal(true),
  })
  .strict();
const changes = {
  preservationVerified: z.literal(true).optional(),
  preservation: z
    .object({
      checks: z.array(z.string().max(64)).max(16),
      survivingTexts: z.number().int().nonnegative().optional(),
      opaqueBlocks: z.number().int().nonnegative().optional(),
    })
    .strict()
    .optional(),
  archive: z
    .object({
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      blobId: documentId,
      identityScope: z.literal('document'),
    })
    .strict()
    .optional(),
  source: z
    .object({
      resource: documentResource,
      version: documentVersion,
      commentsVersion: documentVersion.optional(),
      metadataVersion: documentVersion.optional(),
      identityScope: z.literal('document'),
    })
    .strict()
    .optional(),
  resource: documentOperationResource,
  beforeVersion: documentVersion,
  afterVersion: documentVersion,
  changed: z.boolean(),
  changedIds: z.array(documentId).max(10000),
  identities: z.record(documentId, documentId),
  textMappings: z
    .array(
      z
        .object({
          opId: documentId,
          source: z
            .object({
              blockId: documentId,
              offset: z.number().int().nonnegative(),
              length: z.number().int().nonnegative(),
            })
            .strict(),
          target: z
            .object({
              blockId: documentId,
              offset: z.number().int().nonnegative(),
            })
            .strict(),
        })
        .strict()
    )
    .max(1000)
    .optional(),
  metadataVersion: documentVersion.optional(),
  commentsVersion: documentVersion.optional(),
  accessVersion: documentVersion.optional(),
  upload: documentUploadResult.optional(),
  lifecycle: z.enum(['trashed', 'active', 'deleted']).optional(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
};
const receipt = z
  .object({
    ...base,
    ...changes,
    status: z.literal('succeeded'),
    operationId: documentId,
    toolName: z.string().max(64),
    writeOutcome: z.literal('committed'),
    replayed: z.boolean(),
  })
  .strict();
export const DOCUMENT_OPERATION_SCHEMA = z.union([receipt, failure, pending]);
export const DOCUMENT_FAILURE_SCHEMA = failure;
export const DOCUMENT_RECEIPT_SCHEMA = receipt;
export function documentOutputSchema(name: DocumentToolName) {
  const success = [
    'workspace_doc_access_read',
    'workspace_doc_comments_read',
    'workspace_doc_history_list',
    'workspace_doc_history_read',
    'workspace_doc_export',
    'workspace_doc_asset_read',
  ].includes(name)
    ? z
        .object({
          ...base,
          resource: documentResource,
          version: documentVersion,
          data: z.unknown(),
        })
        .strict()
    : name === 'workspace_doc_inspect'
      ? z
          .object({
            ...base,
            resource: documentResource,
            version: documentVersion,
            title: z.string(),
            format: z.enum([
              'blocksuite/native',
              'office/native',
              'file/base64',
              'lifecycle/native',
            ]),
            // Native JSON is read-only, version-bound data. It is never accepted as a patch.
            items: z.array(z.unknown()).max(200),
            offset: z.number().int().nonnegative(),
            nextOffset: z.number().int().nonnegative().nullable(),
            total: z.number().int().nonnegative(),
            metadata: z.unknown().optional(),
            coverage: z.literal('native'),
            scopeCoverage: z.enum(['complete', 'paginated']),
            representationFidelity: z.enum([
              'native',
              'native-with-opaque-data',
            ]),
            adapterVersion: z.literal('native-adapters/1'),
            adapterManifest: z.unknown().optional(),
            diagnostics: z
              .object({
                items: z
                  .array(
                    z
                      .object({
                        objectId: documentId,
                        field: z.string().optional(),
                        reason: z.string(),
                      })
                      .strict()
                  )
                  .max(100),
                total: z.number().int().nonnegative(),
                truncated: z.boolean(),
                scope: z.literal('returned-page'),
              })
              .strict()
              .optional(),
            textCoordinates: z.literal('utf16-grapheme-boundaries'),
            externalReferences: z.literal('references-only'),
          })
          .strict()
      : name === 'workspace_doc_edit_preview'
        ? z
            .object({
              ...base,
              ...changes,
              status: z.literal('preview'),
              writeOutcome: z.literal('none'),
            })
            .strict()
        : DOCUMENT_OPERATION_SCHEMA;
  return z.object({ result: z.union([success, failure, pending]) }).strict();
}
