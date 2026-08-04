import { Readable } from 'node:stream';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import type { PermissionAccess } from '../../../core/permission';
import type { WorkspaceBlobStorage } from '../../../core/storage';
import type { WorkspaceBlobResolver } from '../../../core/workspaces/resolvers/blob';
import {
  defineTool,
  DESTRUCTIVE_WRITE_TOOL,
  READ_ONLY_TOOL,
  RESULT_OUTPUT_SCHEMA,
  toolError,
  toolResult,
  type WorkspaceMcpToolDefinition,
  WRITE_TOOL,
} from './types';

const MAX_INLINE_BLOB_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_INLINE_BLOB_BYTES * 4) / 3) + 8;

type AssetToolDependencies = {
  ac: PermissionAccess;
  resolver: WorkspaceBlobResolver;
  storage: WorkspaceBlobStorage;
  logger: Logger;
};

async function streamToBase64(stream: NodeJS.ReadableStream, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error(
        `Blob exceeds the inline read limit of ${maxBytes} bytes.`
      );
    }
    chunks.push(buffer);
  }
  return { base64: Buffer.concat(chunks).toString('base64'), size };
}

export function createAssetMcpTools(
  dependencies: AssetToolDependencies,
  userId: string,
  workspaceId: string
) {
  const { ac, logger, resolver, storage } = dependencies;
  const user = { id: userId } as never;
  const workspace = { id: workspaceId } as never;

  const readTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'list_workspace_blobs',
      title: 'List Workspace Blobs',
      description:
        'List attachment and image blobs in the workspace with key, MIME type, size, status, and creation metadata.',
      parser: z.object({}).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async () => toolResult(await resolver.blobs(user, workspace)),
    }),
    defineTool({
      name: 'read_workspace_blob',
      title: 'Read Workspace Blob',
      description:
        'Return a signed download URL when supported, otherwise return a bounded blob as base64 with its metadata.',
      parser: z
        .object({
          key: z.string().min(1).max(1024),
          maxBytes: z
            .number()
            .int()
            .min(1)
            .max(MAX_INLINE_BLOB_BYTES)
            .default(MAX_INLINE_BLOB_BYTES),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ key, maxBytes }) => {
        await ac
          .user(userId)
          .workspace(workspaceId)
          .assert('Workspace.Blobs.Read');
        const head = await storage.head(workspaceId, key);
        if (!head) return toolError(`Blob ${key} not found.`);
        const result = await storage.get(workspaceId, key, true);
        if (result.redirectUrl) {
          return toolResult({
            key,
            downloadUrl: result.redirectUrl,
            mime: head.contentType,
            size: head.contentLength,
            expiresAt: null,
          });
        }
        if (!result.body) return toolError(`Blob ${key} not found.`);
        const body = await streamToBase64(result.body, maxBytes);
        return toolResult({
          key,
          ...body,
          mime: result.metadata?.contentType ?? head.contentType,
          lastModified:
            result.metadata?.lastModified.toISOString() ??
            head.lastModified.toISOString(),
        });
      },
    }),
  ];

  const writeTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'upload_workspace_blob',
      title: 'Upload Workspace Blob',
      description:
        'Upload a bounded image or attachment from base64 through the existing quota-checked workspace blob path. Use initialize_workspace_blob_upload for larger files.',
      parser: z
        .object({
          key: z.string().min(1).max(1024),
          mime: z.string().min(1).max(256).default('application/octet-stream'),
          base64: z.string().min(1).max(MAX_BASE64_LENGTH),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ key, mime, base64 }) => {
        try {
          const buffer = Buffer.from(base64, 'base64');
          if (!buffer.length || buffer.length > MAX_INLINE_BLOB_BYTES) {
            return toolError(
              `Decoded blob must be between 1 and ${MAX_INLINE_BLOB_BYTES} bytes.`
            );
          }
          const blobKey = await resolver.setBlob(user, workspaceId, {
            filename: key,
            mimetype: mime,
            encoding: 'base64',
            createReadStream: () => Readable.from(buffer),
          });
          return toolResult({ key: blobKey, mime, size: buffer.length });
        } catch (error) {
          logger.warn(
            `Workspace blob upload failed ${workspaceId}/${key}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return toolError('Workspace blob upload failed.');
        }
      },
    }),
    defineTool({
      name: 'initialize_workspace_blob_upload',
      title: 'Initialize Workspace Blob Upload',
      description:
        'Initialize a quota-checked direct, server-mediated, or multipart workspace blob upload.',
      parser: z
        .object({
          key: z.string().min(1).max(1024),
          size: z.number().int().min(1),
          mime: z.string().max(256).default('application/octet-stream'),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ key, size, mime }) =>
        toolResult(
          await resolver.createBlobUpload(user, workspaceId, key, size, mime)
        ),
    }),
    defineTool({
      name: 'get_workspace_blob_upload_part',
      title: 'Get Workspace Blob Upload Part',
      description:
        'Get the signed URL and headers for one multipart upload part.',
      parser: z
        .object({
          key: z.string().min(1).max(1024),
          uploadId: z.string().min(1),
          partNumber: z.number().int().min(1).max(10000),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ key, uploadId, partNumber }) =>
        toolResult(
          await resolver.blobUploadPartUrl(
            user,
            workspace,
            key,
            uploadId,
            partNumber
          )
        ),
    }),
    defineTool({
      name: 'complete_workspace_blob_upload',
      title: 'Complete Workspace Blob Upload',
      description:
        'Validate and complete a direct or multipart workspace blob upload.',
      parser: z
        .object({
          key: z.string().min(1).max(1024),
          uploadId: z.string().min(1).optional(),
          parts: z
            .array(
              z
                .object({
                  partNumber: z.number().int().min(1),
                  etag: z.string().min(1),
                })
                .strict()
            )
            .max(10000)
            .optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ key, uploadId, parts }) =>
        toolResult({
          key: await resolver.completeBlobUpload(
            user,
            workspaceId,
            key,
            uploadId,
            parts
          ),
        }),
    }),
    defineTool({
      name: 'abort_workspace_blob_upload',
      title: 'Abort Workspace Blob Upload',
      description: 'Abort an in-progress multipart workspace blob upload.',
      parser: z
        .object({
          key: z.string().min(1).max(1024),
          uploadId: z.string().min(1),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ key, uploadId }) =>
        toolResult({
          aborted: await resolver.abortBlobUpload(
            user,
            workspaceId,
            key,
            uploadId
          ),
        }),
    }),
    defineTool({
      name: 'delete_workspace_blob',
      title: 'Delete Workspace Blob',
      description:
        'Mark a workspace blob deleted, or permanently remove it when explicitly requested.',
      parser: z
        .object({
          key: z.string().min(1).max(1024),
          permanently: z.boolean().default(false),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ key, permanently }) =>
        toolResult({
          deleted: await resolver.deleteBlob(
            user,
            workspaceId,
            undefined,
            key,
            permanently
          ),
        }),
    }),
    defineTool({
      name: 'release_deleted_workspace_blobs',
      title: 'Release Deleted Workspace Blobs',
      description:
        'Permanently release all workspace blobs already marked deleted.',
      parser: z.object({ confirm: z.literal(true) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async () =>
        toolResult({
          released: await resolver.releaseDeletedBlobs(user, workspaceId),
        }),
    }),
  ];

  return { readTools, writeTools };
}
