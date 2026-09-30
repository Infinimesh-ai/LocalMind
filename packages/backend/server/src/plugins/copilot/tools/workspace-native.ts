import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { WorkspaceNativeResourceService } from '../../../core/office/workspace-resource-service';
import type { Models } from '../../../models';
import { requestsExplicitPermanentDelete } from '../mcp/tool-agent-completion';
import type { CopilotChatOptions } from '../providers/types';
import {
  type CopilotToolExecuteOptions,
  type CopilotToolSet,
  defineTool,
} from './tool';

export function createWorkspaceNativeTools(
  models: Models,
  resources: WorkspaceNativeResourceService,
  options: NonNullable<CopilotChatOptions>,
  writes: boolean
): CopilotToolSet {
  if (
    !options.workspace ||
    !options.user ||
    !options.session ||
    options.taskId ||
    options.delegatedExecution
  )
    return {};
  const actor = { workspaceId: options.workspace, actorId: options.user };
  const sessionId = options.session;
  const enabled = new Set(options.tools);
  const proof = new Map<string, number>();
  const identity = z.object({
    resource_id: z.string().min(1).max(512),
    kind: z.enum(['file', 'office']),
  });
  const version = z.number().int().positive();
  const authorize = async () => {
    const session = await models.copilotSession.getMeta(sessionId);
    if (
      !session ||
      session.userId !== actor.actorId ||
      session.workspaceId !== actor.workspaceId ||
      session.selectedContextProjectId ||
      session.scopeType === 'work_order'
    )
      throw new Error('Workspace conversation authorization changed');
  };
  const scope = (input: z.infer<typeof identity>) => ({
    ...actor,
    resourceId: input.resource_id,
    kind: input.kind,
  });
  const write = async <T>(
    resourceId: string,
    execute: CopilotToolExecuteOptions,
    operation: (requestKey: string) => Promise<T>
  ) => {
    await authorize();
    execute.signal?.throwIfAborted();
    if (!execute.toolCallId)
      throw new Error('Native writes require a stable tool call identity');
    const requestKey = createHash('sha256')
      .update(
        JSON.stringify([
          sessionId,
          options.billingUnitId ?? null,
          execute.toolCallId,
        ])
      )
      .digest('hex');
    return models.copilotContext.withWorkspaceWriteAudit(
      {
        ...actor,
        sessionId,
        sink: {
          type: 'tool_write',
          id: resourceId,
          documentId: resourceId,
          workspaceId: actor.workspaceId,
          phase: 'execute',
        },
      },
      () => operation(requestKey)
    );
  };
  const tools: CopilotToolSet = {};
  if (
    enabled.has('docRead') ||
    enabled.has('docKeywordSearch') ||
    enabled.has('workspaceOrganization')
  ) {
    tools.workspace_resource_list = defineTool({
      description:
        'List or keyword-search native Workspace Office and text/binary files, using current content, directory permissions and trash status. Use document tools separately for Page and Edgeless. A cursor continues the same query.',
      sideEffectType: 'read',
      inputSchema: z
        .object({
          query: z.string().max(256).optional(),
          cursor: z.string().max(2048).optional(),
          trash: z.boolean().default(false),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      execute: async input => {
        await authorize();
        return resources.list({ ...actor, ...input });
      },
    });
    tools.workspace_file_read = defineTool({
      description:
        'Read complete UTF-8 TXT, Markdown, CSV or JSON by its native Workspace file ID and return the same immutable content version. Unsupported encoding and over-limit content fail without truncation. Read before updating.',
      sideEffectType: 'read',
      inputSchema: z
        .object({
          resource_id: identity.shape.resource_id,
          sequence: version.optional(),
        })
        .strict(),
      execute: async input => {
        await authorize();
        const result = await resources.readText({
          ...actor,
          resourceId: input.resource_id,
          kind: 'file',
          sequence: input.sequence,
        });
        proof.set(input.resource_id, result.contentVersion);
        return { ...result, complete: true };
      },
    });
    tools.workspace_resource_history = defineTool({
      description:
        'List immutable versions of a native Workspace file or Office artifact. Page and Edgeless use document history.',
      sideEffectType: 'read',
      inputSchema: identity
        .extend({
          before: version.optional(),
          limit: z.number().int().min(1).max(100).default(25),
        })
        .strict(),
      execute: async input => {
        await authorize();
        return resources.history({
          ...scope(input),
          before: input.before,
          limit: input.limit,
        });
      },
    });
  }
  if (writes && enabled.has('docUpdate')) {
    tools.workspace_file_update = defineTool({
      description:
        'Update complete text on the exact native Workspace file ID read in this loop, bound to its expected content version. On conflict reread and merge; do not create a same-name copy. JSON must remain valid.',
      sideEffectType: 'workspace_write',
      inputSchema: z
        .object({
          resource_id: identity.shape.resource_id,
          expected_content_version: version,
          text: z.string().max(1024 * 1024),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.resource_id, execute, requestKey => {
          if (proof.get(input.resource_id) !== input.expected_content_version)
            throw new Error(
              'Read the complete file at this content version before updating'
            );
          return resources.save({
            ...actor,
            resourceId: input.resource_id,
            kind: 'file',
            text: input.text,
            expectedContentVersion: input.expected_content_version,
            requestKey,
            sourceSessionId: sessionId,
            origin: 'ai',
          });
        }),
    });
    tools.workspace_resource_restore_version = defineTool({
      description:
        'Only when requested by the user, restore a selected historical native file or Office version as a new revision. Bind to the current version; never alter old history.',
      sideEffectType: 'workspace_write',
      inputSchema: identity
        .extend({ sequence: version, expected_content_version: version })
        .strict(),
      execute: (input, execute) =>
        write(input.resource_id, execute, requestKey =>
          resources.restoreVersion({
            ...scope(input),
            sequence: input.sequence,
            expectedContentVersion: input.expected_content_version,
            requestKey,
            origin: 'ai',
          })
        ),
    });
  }
  if (
    writes &&
    (enabled.has('docUpdateMeta') || enabled.has('workspaceOrganization'))
  )
    tools.workspace_resource_update_meta = defineTool({
      description:
        'Rename, move, trash, restore or permanently delete a native Workspace file or Office artifact. Use its metadata version; moving also requires the current directory version. Permanent deletion requires an explicit user request and an already trashed resource. Use document tools for Page and Edgeless.',
      sideEffectType: 'workspace_write',
      inputSchema: identity
        .extend({
          action: z.enum(['rename', 'move', 'trash', 'restore', 'delete']),
          confirm_permanent_deletion: z.boolean().optional(),
          expected_version: version,
          title: z.string().trim().min(1).max(480).optional(),
          folder_id: z.string().min(1).max(512).nullish(),
          expected_directory_version: z.string().min(1).max(512).optional(),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.resource_id, execute, requestKey => {
          if (
            input.action === 'delete' &&
            (input.confirm_permanent_deletion !== true ||
              !requestsExplicitPermanentDelete(
                [...(execute.messages ?? [])]
                  .reverse()
                  .find(message => message.role === 'user')?.content ?? ''
              ))
          )
            throw new Error(
              'Permanent deletion requires an explicit user request and confirmation'
            );
          return resources.change({
            ...scope(input),
            action: input.action,
            expectedVersion: input.expected_version,
            title: input.title,
            folderId: input.folder_id,
            expectedDirectoryVersion: input.expected_directory_version,
            requestKey,
          });
        }),
    });
  if (writes && enabled.has('docCreate'))
    tools.workspace_resource_copy = defineTool({
      description:
        'Create an independent native file or Office copy in this Workspace, with a new ID, only when the user asks to copy. Check the source content version and target folder. Never use a copy as a fallback for failed updates.',
      sideEffectType: 'workspace_write',
      inputSchema: identity
        .extend({
          title: z.string().trim().min(1).max(480),
          expected_content_version: version,
          folder_id: z.string().min(1).max(512).nullish(),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.resource_id, execute, requestKey =>
          resources.copy({
            ...scope(input),
            title: input.title,
            expectedContentVersion: input.expected_content_version,
            folderId: input.folder_id,
            requestKey,
          })
        ),
    });
  return tools;
}
