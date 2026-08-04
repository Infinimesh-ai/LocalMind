import { z } from 'zod';

import type { CurrentUser } from '../../../core/auth';
import type { CopilotResolver } from '../resolver';
import {
  defineTool,
  DESTRUCTIVE_WRITE_TOOL,
  READ_ONLY_TOOL,
  RESULT_OUTPUT_SCHEMA,
  toolResult,
  type WorkspaceMcpToolDefinition,
  WRITE_TOOL,
} from './types';

export function createChatMcpTools(
  resolver: CopilotResolver,
  userId: string,
  workspaceId: string
): {
  readTools: WorkspaceMcpToolDefinition[];
  writeTools: WorkspaceMcpToolDefinition[];
} {
  const user = { id: userId } as CurrentUser;
  const copilot = { workspaceId };

  const readTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'get_ai_chat_session',
      title: 'Get AI Chat Session',
      description: 'Get one visible AI chat session by ID.',
      parser: z.object({ sessionId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ sessionId }) =>
        toolResult(await resolver.session(copilot, user, sessionId)),
    }),
    defineTool({
      name: 'list_ai_chats',
      title: 'List AI Chats',
      description:
        'List visible AI chats with optional messages, prompt metadata, and document filter.',
      parser: z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
          docId: z.string().optional(),
          action: z.boolean().optional(),
          fork: z.boolean().optional(),
          pinned: z.boolean().optional(),
          withMessages: z.boolean().default(true),
          withPrompt: z.boolean().default(false),
          messageOrder: z.enum(['asc', 'desc']).default('asc'),
          sessionOrder: z.enum(['asc', 'desc']).default('desc'),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ limit, offset, docId, ...options }) =>
        toolResult(
          await resolver.chats(
            copilot,
            user,
            { first: limit, offset, after: null },
            docId,
            {
              action: options.action,
              fork: options.fork,
              pinned: options.pinned,
              limit,
              skip: offset,
              messageOrder: options.messageOrder,
              sessionOrder: options.sessionOrder,
              sessionId: undefined,
              withMessages: options.withMessages,
              withPrompt: options.withPrompt,
            }
          )
        ),
    }),
  ];

  const writeTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'create_ai_chat_session',
      title: 'Create AI Chat Session',
      description: 'Create an AI chat session and return its full history.',
      parser: z
        .object({
          promptName: z.string().min(1),
          docId: z.string().optional(),
          pinned: z.boolean().optional(),
          reuseLatestChat: z.boolean().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.createCopilotSessionWithHistory(user, {
            workspaceId,
            ...input,
          })
        ),
    }),
    defineTool({
      name: 'update_ai_chat_session',
      title: 'Update AI Chat Session',
      description:
        'Update a session document, selected context project, pin state, or prompt.',
      parser: z
        .object({
          sessionId: z.string().min(1),
          docId: z.string().nullable().optional(),
          selectedContextProjectId: z.string().nullable().optional(),
          pinned: z.boolean().optional(),
          promptName: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: { ...WRITE_TOOL, idempotentHint: true },
      execute: async input =>
        toolResult(
          await resolver.updateCopilotSession(user, {
            sessionId: input.sessionId,
            docId: input.docId,
            selectedContextProjectId: input.selectedContextProjectId,
            pinned: input.pinned,
            promptName: input.promptName as string,
          })
        ),
    }),
    defineTool({
      name: 'fork_ai_chat_session',
      title: 'Fork AI Chat Session',
      description:
        'Fork a document chat, optionally retaining messages through a selected message ID.',
      parser: z
        .object({
          docId: z.string().min(1),
          sessionId: z.string().min(1),
          latestMessageId: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.forkCopilotSession(user, { workspaceId, ...input })
        ),
    }),
    defineTool({
      name: 'delete_ai_chat_sessions',
      title: 'Delete AI Chat Sessions',
      description: 'Delete one or more AI chat sessions.',
      parser: z
        .object({
          sessionIds: z.array(z.string().min(1)).min(1),
          docId: z.string().optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ sessionIds, docId }) =>
        toolResult(
          await resolver.cleanupCopilotSession(user, {
            workspaceId,
            docId,
            sessionIds,
          })
        ),
    }),
    defineTool({
      name: 'send_ai_chat_message',
      title: 'Send AI Chat Message',
      description:
        'Submit a message to an existing AI chat. Existing LocalMind blob IDs may be attached.',
      parser: z
        .object({
          sessionId: z.string().min(1),
          content: z.string().optional(),
          attachments: z.array(z.string()).optional(),
          params: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async input =>
        toolResult(
          await resolver.createCopilotMessage(user, {
            sessionId: input.sessionId,
            content: input.content,
            attachments: input.attachments,
            blob: undefined,
            blobs: undefined,
            params: input.params,
          })
        ),
    }),
  ];

  return { readTools, writeTools };
}
