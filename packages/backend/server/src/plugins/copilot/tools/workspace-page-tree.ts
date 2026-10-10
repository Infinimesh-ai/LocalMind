import { createHash } from 'node:crypto';

import { WORKSPACE_PAGE_TREE_CONTRACT } from '@affine/graphql';
import { z } from 'zod';

import type { WorkspacePageTreeService } from '../../../core/doc/workspace-page-tree';
import type { WorkspaceNativeResourceService } from '../../../core/office/workspace-resource-service';
import type { Models } from '../../../models';
import { requestsExplicitPermanentDelete } from '../mcp/tool-agent-completion';
import type { CopilotChatOptions } from '../providers/types';
import { NativeFileCreateToolSchema } from './file-create-input';
import {
  type CopilotToolExecuteOptions,
  type CopilotToolSet,
  defineTool,
} from './tool';

/** New names deliberately have no alias to the old multi-placement contract. */
export function createWorkspacePageTreeTools(
  models: Models,
  service: WorkspacePageTreeService,
  native: WorkspaceNativeResourceService | undefined,
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
  const actor = { workspaceId: options.workspace, actorId: options.user },
    sessionId = options.session;
  const id = z.string().min(1).max(512);
  const base = z.object({
    contract_version: z.literal(WORKSPACE_PAGE_TREE_CONTRACT),
    expected_revision: z.number().int().nonnegative(),
    expected_authorization_revision: z.string().length(64),
  });
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
  const write = async <T>(
    target: string,
    execute: CopilotToolExecuteOptions,
    operation: (key: string) => Promise<T>
  ) => {
    await authorize();
    execute.signal?.throwIfAborted();
    if (!execute.toolCallId || execute.toolCallId.length > 512)
      throw new Error('A stable tool call identity is required');
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
          id: target,
          documentId: target,
          workspaceId: actor.workspaceId,
          phase: 'execute',
        },
      },
      () => operation(requestKey)
    );
  };
  const version = (input: z.infer<typeof base>, requestKey: string) => ({
    contractVersion: input.contract_version,
    expectedRevision: input.expected_revision,
    expectedAuthorizationRevision: input.expected_authorization_revision,
    requestKey,
  });
  const tools: CopilotToolSet = {
    workspace_page_tree_list: defineTool({
      description:
        'Read the authoritative Workspace page tree with typed resource identities, real parents, ACL-filtered ancestors and a version. Folders and native pages are containers; whiteboards, Office and files are leaves. Body links do not determine ownership. Use the returned revision for writes; continue nextCursor until empty.',
      sideEffectType: 'read',
      inputSchema: z
        .object({
          parent_node_id: id.nullable().default(null),
          after: z.string().max(1024).optional(),
          trash: z.boolean().default(false),
          resource: z
            .object({
              kind: z.enum(['doc', 'office', 'file', 'folder']),
              resourceId: id,
            })
            .optional(),
        })
        .strict(),
      execute: async input => {
        await authorize();
        return service.list(actor, input.parent_node_id, input.after, 100, {
          trash: input.trash,
          resource: input.resource,
        });
      },
    }),
  };
  if (!writes) return tools;
  if (options.tools?.includes('docCreate'))
    tools.workspace_page_tree_create = defineTool({
      description:
        'Create one real BlockSuite page or whiteboard with one explicit folder or native page parent, or null for Workspace root. Returns an immutable receipt with resource identity, actual parent and committed tree revision. Retry the same call after an unknown result; never make a same-name replacement. Use workspace_doc_update to write its content after creation.',
      sideEffectType: 'workspace_write',
      inputSchema: base
        .extend({
          title: z.string().trim().min(1).max(512),
          parent_node_id: id.nullable(),
          primary_mode: z.enum(['page', 'edgeless']).default('page'),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.parent_node_id ?? actor.workspaceId, execute, key =>
          service.execute(actor, {
            ...version(input, key),
            action: 'create',
            title: input.title,
            primaryMode: input.primary_mode,
            parentNodeId: input.parent_node_id,
          })
        ),
    });
  if (options.tools?.includes('workspaceOrganization')) {
    tools.workspace_folder_create = defineTool({
      description:
        'Create a real folder without document content, at an explicit folder/page parent or null root. Requires directory folder-creation rights independently of document creation. Use current v2 versions and a stable request identity.',
      sideEffectType: 'workspace_write',
      inputSchema: base
        .extend({
          title: z.string().trim().min(1).max(512),
          parent_node_id: id.nullable(),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.parent_node_id ?? actor.workspaceId, execute, key =>
          service.execute(actor, {
            ...version(input, key),
            action: 'create-folder',
            title: input.title,
            parentNodeId: input.parent_node_id,
          })
        ),
    });
    tools.workspace_folder_rename = defineTool({
      description:
        'Rename the exact folder, binding its metadata version and current tree/authorization versions. Converted identities are rejected.',
      sideEffectType: 'workspace_write',
      inputSchema: base
        .extend({
          node_id: id,
          title: z.string().trim().min(1).max(512),
          expected_resource_version: z.number().int().positive(),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.node_id, execute, key =>
          service.execute(actor, {
            ...version(input, key),
            action: 'rename-folder',
            title: input.title,
            nodeId: input.node_id,
            expectedResourceVersion: input.expected_resource_version,
          })
        ),
    });
    if (options.tools?.includes('docCreate'))
      tools.workspace_container_convert = defineTool({
        description:
          'Convert a folder to a real editable page only when the user explicitly requested conversion. Keeps node ID, children and location. Requires equivalent permissions. Reverse conversion is unavailable.',
        sideEffectType: 'workspace_write',
        inputSchema: base
          .extend({
            node_id: id,
            expected_resource_version: z.number().int().positive(),
            target_kind: z.literal('doc'),
            confirm_conversion: z.literal(true),
          })
          .strict(),
        execute: (input, execute) =>
          write(input.node_id, execute, key => {
            const message = [...(execute.messages ?? [])]
              .reverse()
              .find(message => message.role === 'user')?.content;
            if (
              typeof message !== 'string' ||
              !/(转换|轉換|convert)/i.test(message) ||
              /(不要|别|別|不想|暂不|暫不|不需要|不要再|do not|don't|never|not to)\s*.{0,24}(转换|轉換|convert)/i.test(
                message
              ) ||
              !/(文件夹|資料夾|folder)/i.test(message) ||
              !/(页面|頁面|page)/i.test(message)
            )
              throw new Error(
                'Explicit folder to page conversion request required'
              );
            return service.execute(actor, {
              ...version(input, key),
              action: 'convert-folder',
              nodeId: input.node_id,
              expectedResourceVersion: input.expected_resource_version,
            });
          }),
      });
    tools.workspace_page_tree_move = defineTool({
      description:
        'Move or reorder a typed tree node and its whole subtree. This changes its unique real parent. No body reference or extra placement is created. Permissions, cycles, leaf targets and expected versions are checked atomically.',
      sideEffectType: 'workspace_write',
      inputSchema: base
        .extend({
          node_id: id,
          parent_node_id: id.nullable(),
          before_node_id: id.optional(),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.node_id, execute, key =>
          service.execute(actor, {
            ...version(input, key),
            action: 'move',
            nodeId: input.node_id,
            parentNodeId: input.parent_node_id,
            beforeNodeId: input.before_node_id,
          })
        ),
    });
    tools.workspace_page_tree_lifecycle = defineTool({
      description:
        'Trash or restore a whole ownership subtree, preserving prior independent trash. Permanently delete only an already trashed subtree after an explicit user request. Restoration with an unavailable parent requires an explicit new target; never silently move to root.',
      sideEffectType: 'workspace_write',
      inputSchema: base
        .extend({
          node_id: id,
          action: z.enum(['trash', 'restore', 'delete']),
          restore_parent_node_id: id.nullable().optional(),
          confirm_permanent_deletion: z.boolean().optional(),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.node_id, execute, key => {
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
              'Permanent deletion requires an explicit user request'
            );
          return service.execute(actor, {
            ...version(input, key),
            action: input.action,
            nodeId: input.node_id,
            ...(input.action === 'restore' &&
            input.restore_parent_node_id !== undefined
              ? { parentNodeId: input.restore_parent_node_id }
              : {}),
          });
        }),
    });
  }
  if (native && options.tools?.includes('docCreate'))
    tools.workspace_page_tree_file_create = defineTool({
      description:
        'Create a real native Office or text file at a typed folder or native page parent, or null at root, in the same transaction as its unique tree ownership. DOCX/XLSX/PPTX/TXT/Markdown/CSV/JSON use the existing native content formats. Do not substitute a page or retry an update as a new copy.',
      sideEffectType: 'workspace_write',
      inputSchema: base
        .extend({
          title: NativeFileCreateToolSchema.shape.title,
          content: NativeFileCreateToolSchema.shape.content,
          parent_node_id: id.nullable(),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.parent_node_id ?? actor.workspaceId, execute, requestKey =>
          native.create({
            ...actor,
            title: input.title,
            content: input.content,
            requestKey,
            treeContractVersion: input.contract_version,
            expectedTreeRevision: input.expected_revision,
            expectedAuthorizationRevision:
              input.expected_authorization_revision,
            parentNodeId: input.parent_node_id,
          })
        ),
    });
  if (native && options.tools?.includes('docUpdateMeta'))
    tools.workspace_page_tree_resource_rename = defineTool({
      description:
        'Rename the exact native Workspace file or Office identity without changing its unique parent. Bind to the current resource metadata version. Lifecycle and movement require the page tree tools.',
      sideEffectType: 'workspace_write',
      inputSchema: z
        .object({
          resource_id: id,
          kind: z.enum(['file', 'office']),
          expected_version: z.number().int().positive(),
          title: z.string().trim().min(1).max(480),
        })
        .strict(),
      execute: (input, execute) =>
        write(input.resource_id, execute, requestKey =>
          native.change({
            ...actor,
            resourceId: input.resource_id,
            kind: input.kind,
            action: 'rename',
            title: input.title,
            expectedVersion: input.expected_version,
            requestKey,
          })
        ),
    });
  return tools;
}
