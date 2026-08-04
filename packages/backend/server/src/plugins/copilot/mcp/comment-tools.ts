import { Readable } from 'node:stream';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import type { CommentService } from '../../../core/comment';
import type { CommentResolver } from '../../../core/comment/resolver';
import type { PermissionAccess } from '../../../core/permission';
import { DocMode, type Models } from '../../../models';
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

const MAX_COMMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_COMMENT_ATTACHMENT_BYTES * 4) / 3) + 8;
const jsonObject = z.record(z.string(), z.unknown());

type CommentToolDependencies = {
  ac: PermissionAccess;
  service: CommentService;
  resolver: CommentResolver;
  models: Models;
  logger: Logger;
};

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createCommentMcpTools(
  dependencies: CommentToolDependencies,
  userId: string,
  workspaceId: string
) {
  const { ac, logger, models, resolver, service } = dependencies;
  const currentUser = async () => {
    const user = await models.user.get(userId);
    if (!user) throw new Error('MCP credential user was not found.');
    return user as never;
  };
  const executeWrite = async (operation: () => Promise<unknown>) => {
    try {
      return toolResult(jsonSafe(await operation()));
    } catch (error) {
      logger.warn(
        `Comment operation failed in ${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return toolError(
        error instanceof Error
          ? `Comment operation rejected: ${error.message}`
          : 'Comment operation rejected.'
      );
    }
  };

  const readTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'list_document_comments',
      title: 'List Document Comments',
      description:
        'List comments and replies for an authorized document with author, resolution, and timestamp metadata.',
      parser: z
        .object({
          docId: z.string().min(1),
          afterSid: z.number().int().min(0).optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ docId, afterSid, limit }) => {
        const allowed = await ac
          .user(userId)
          .workspace(workspaceId)
          .doc(docId)
          .can('Doc.Comments.Read');
        if (!allowed) return toolError(`Doc with id ${docId} not found.`);
        const [total, comments] = await Promise.all([
          service.getCommentCount(workspaceId, docId),
          service.listComments(workspaceId, docId, {
            sid: afterSid,
            take: limit,
          }),
        ]);
        return toolResult(jsonSafe({ docId, total, comments }));
      },
    }),
  ];

  const writeTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'create_document_comment',
      title: 'Create Document Comment',
      description:
        'Create a document comment through the existing permission, mention notification, and realtime publication path.',
      parser: z
        .object({
          docId: z.string().min(1),
          docTitle: z.string().max(1024),
          docMode: z.enum(['page', 'edgeless']).default('page'),
          content: jsonObject,
          mentions: z.array(z.string().min(1)).max(100).optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ docId, docTitle, docMode, content, mentions }) =>
        executeWrite(async () =>
          resolver.createComment(await currentUser(), {
            workspaceId,
            docId,
            docTitle,
            docMode: docMode as DocMode,
            content,
            mentions,
          })
        ),
    }),
    defineTool({
      name: 'update_document_comment',
      title: 'Update Document Comment',
      description:
        'Update an existing comment through LocalMind comment permissions.',
      parser: z.object({ id: z.string().min(1), content: jsonObject }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ id, content }) =>
        executeWrite(async () =>
          resolver.updateComment(await currentUser(), { id, content })
        ),
    }),
    defineTool({
      name: 'resolve_document_comment',
      title: 'Resolve Document Comment',
      description: 'Resolve or reopen an existing document comment.',
      parser: z
        .object({ id: z.string().min(1), resolved: z.boolean() })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ id, resolved }) =>
        executeWrite(async () =>
          resolver.resolveComment(await currentUser(), { id, resolved })
        ),
    }),
    defineTool({
      name: 'delete_document_comment',
      title: 'Delete Document Comment',
      description:
        'Delete an existing document comment and publish the change.',
      parser: z.object({ id: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ id }) =>
        executeWrite(async () =>
          resolver.deleteComment(await currentUser(), id)
        ),
    }),
    defineTool({
      name: 'create_comment_reply',
      title: 'Create Comment Reply',
      description:
        'Create a reply through the existing permission, mention notification, and realtime publication path.',
      parser: z
        .object({
          commentId: z.string().min(1),
          docTitle: z.string().max(1024),
          docMode: z.enum(['page', 'edgeless']).default('page'),
          content: jsonObject,
          mentions: z.array(z.string().min(1)).max(100).optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ commentId, docTitle, docMode, content, mentions }) =>
        executeWrite(async () =>
          resolver.createReply(await currentUser(), {
            commentId,
            docTitle,
            docMode: docMode as DocMode,
            content,
            mentions,
          })
        ),
    }),
    defineTool({
      name: 'update_comment_reply',
      title: 'Update Comment Reply',
      description: 'Update an existing comment reply.',
      parser: z.object({ id: z.string().min(1), content: jsonObject }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ id, content }) =>
        executeWrite(async () =>
          resolver.updateReply(await currentUser(), { id, content })
        ),
    }),
    defineTool({
      name: 'delete_comment_reply',
      title: 'Delete Comment Reply',
      description: 'Delete an existing comment reply and publish the change.',
      parser: z.object({ id: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ id }) =>
        executeWrite(async () => resolver.deleteReply(await currentUser(), id)),
    }),
    defineTool({
      name: 'upload_comment_attachment',
      title: 'Upload Comment Attachment',
      description:
        'Upload a bounded comment attachment from base64 through the existing document permission, quota, and attachment storage path.',
      parser: z
        .object({
          docId: z.string().min(1),
          filename: z.string().min(1).max(1024),
          mime: z.string().min(1).max(256).default('application/octet-stream'),
          base64: z.string().min(1).max(MAX_BASE64_LENGTH),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ docId, filename, mime, base64 }) =>
        executeWrite(async () => {
          const buffer = Buffer.from(base64, 'base64');
          if (!buffer.length || buffer.length > MAX_COMMENT_ATTACHMENT_BYTES) {
            throw new Error(
              `Decoded attachment must be between 1 and ${MAX_COMMENT_ATTACHMENT_BYTES} bytes.`
            );
          }
          const url = await resolver.uploadCommentAttachment(
            await currentUser(),
            workspaceId,
            docId,
            {
              filename,
              mimetype: mime,
              encoding: 'base64',
              createReadStream: () => Readable.from(buffer),
            }
          );
          return { url, filename, mime, size: buffer.length };
        }),
    }),
  ];

  return { readTools, writeTools };
}
