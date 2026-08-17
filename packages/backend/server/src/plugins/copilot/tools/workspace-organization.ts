import { Logger } from '@nestjs/common';
import { generateKeyBetween } from 'fractional-indexing';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import type { WorkspaceOrganizationService } from '../../../core/doc';
import type {
  PermissionAccess,
  PermissionService,
} from '../../../core/permission';
import type { CopilotChatOptions } from '../providers/types';
import { toolError } from './error';
import { type CopilotToolSet, defineTool } from './tool';

const logger = new Logger('WorkspaceOrganizationTool');
const MAX_FOLDER_MUTATIONS = 100;

type FolderNodeType = 'folder' | 'doc' | 'tag' | 'collection';

type FolderNode = {
  id: string;
  parentId: string | null;
  type: FolderNodeType;
  data: string;
  index: string;
};

type WorkspaceEffectOperation =
  | 'create_folder'
  | 'rename_folder'
  | 'move_folder'
  | 'delete_folder'
  | 'add_document'
  | 'move_document';

function asFolderNodes(value: unknown): FolderNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      !['folder', 'doc', 'tag', 'collection'].includes(String(record.type)) ||
      typeof record.data !== 'string' ||
      typeof record.index !== 'string' ||
      (record.parentId !== null && typeof record.parentId !== 'string')
    ) {
      return [];
    }
    return [record as FolderNode];
  });
}

function asObjects(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item)
      )
    : [];
}

function folder(nodes: FolderNode[], folderId: string) {
  const node = nodes.find(node => node.id === folderId);
  return node?.type === 'folder' ? node : null;
}

function requireFolder(nodes: FolderNode[], folderId: string) {
  const node = folder(nodes, folderId);
  if (!node) throw new Error(`Folder ${folderId} was not found.`);
  return node;
}

function nextIndex(nodes: FolderNode[], parentId: string | null) {
  const lastIndex = nodes
    .filter(node => node.parentId === parentId)
    .map(node => node.index)
    .sort((a, b) => a.localeCompare(b))
    .at(-1);
  return generateKeyBetween(lastIndex ?? null, null);
}

function normalizedName(name: string) {
  return name.replace(/[\r\n]+/g, ' ').trim();
}

function workspaceEffect(
  operation: WorkspaceEffectOperation,
  folderId?: string | null
) {
  return {
    kind: 'workspace_organization',
    operation,
    ...(folderId !== undefined ? { folderId } : {}),
  };
}

function descendants(nodes: FolderNode[], folderId: string) {
  const ids = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return nodes.filter(node => ids.has(node.id));
}

export function createWorkspaceOrganizationTools(
  ac: PermissionAccess,
  permission: PermissionService,
  organization: WorkspaceOrganizationService,
  options: CopilotChatOptions
): CopilotToolSet {
  const context = () => {
    if (!options?.user || !options.workspace) {
      throw new Error('Missing user or workspace context.');
    }
    return { userId: options.user, workspaceId: options.workspace };
  };

  const readOrganization = async () => {
    const { userId, workspaceId } = context();
    const result = await organization.readOrganization(workspaceId, userId);
    return { result, nodes: asFolderNodes(result.folders) };
  };

  const assertRead = async () => {
    const { userId, workspaceId } = context();
    await ac
      .user(userId)
      .workspace(workspaceId)
      .assert('Workspace.Organize.Read');
  };

  const assertWrite = async () => {
    const { userId, workspaceId } = context();
    await ac.user(userId).workspace(workspaceId).assert('Workspace.Sync');
  };

  const assertReadableDocument = async (documentId: string) => {
    const { userId, workspaceId } = context();
    const readable = await ac
      .user(userId)
      .doc({ workspaceId, docId: documentId })
      .allowLocal()
      .can('Doc.Read');
    if (!readable) throw new Error(`Document ${documentId} is not readable.`);
  };

  const apply = async (
    operations: Parameters<
      WorkspaceOrganizationService['applyDataOperations']
    >[4]
  ) => {
    if (operations.length > MAX_FOLDER_MUTATIONS) {
      throw new Error(
        `The folder operation exceeds the ${MAX_FOLDER_MUTATIONS}-record safety limit.`
      );
    }
    const { userId, workspaceId } = context();
    await organization.applyDataOperations(
      workspaceId,
      userId,
      userId,
      'folders',
      operations
    );
  };

  const execute = async <T>(name: string, operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`${name} rejected: ${message}`);
      return toolError('Workspace Folder Operation Failed', message);
    }
  };

  return {
    workspace_folder_list: defineTool({
      description:
        'List the workspace folder hierarchy and readable document placements. Call this before changing or deleting folders so you use current IDs and names.',
      inputSchema: z.object({}).strict(),
      execute: async () =>
        execute('list', async () => {
          await assertRead();
          const { userId, workspaceId } = context();
          const [{ result, nodes }, readableDocumentIds] = await Promise.all([
            readOrganization(),
            permission.listReadableDocIds({ userId, workspaceId }),
          ]);
          const readable = new Set(readableDocumentIds);
          const titles = new Map(
            asObjects(result.documents).flatMap(document =>
              typeof document.id === 'string'
                ? [
                    [
                      document.id,
                      typeof document.title === 'string'
                        ? document.title
                        : null,
                    ] as const,
                  ]
                : []
            )
          );
          return {
            success: true,
            folders: nodes
              .filter(node => node.type === 'folder')
              .map(node => ({
                folderId: node.id,
                name: node.data,
                parentFolderId: node.parentId,
                index: node.index,
              })),
            documents: nodes.flatMap(node =>
              node.type === 'doc' && readable.has(node.data)
                ? [
                    {
                      placementId: node.id,
                      documentId: node.data,
                      title: titles.get(node.data) ?? null,
                      folderId: node.parentId,
                      index: node.index,
                    },
                  ]
                : []
            ),
          };
        }),
    }),

    workspace_folder_create: defineTool({
      description:
        'Create a folder at the workspace root or inside another folder. Creating the same sibling name again returns the existing folder.',
      inputSchema: z
        .object({
          name: z.string().min(1).max(256).describe('Folder name'),
          parent_folder_id: z
            .string()
            .trim()
            .min(1)
            .nullable()
            .optional()
            .describe('Parent folder ID, or null for a root folder'),
        })
        .strict(),
      execute: async ({ name, parent_folder_id }) =>
        execute('create', async () => {
          await assertWrite();
          const { nodes } = await readOrganization();
          const parentId = parent_folder_id ?? null;
          if (parentId) requireFolder(nodes, parentId);
          const folderName = normalizedName(name);
          if (!folderName) throw new Error('Folder name cannot be empty.');
          const existing = nodes.find(
            node =>
              node.type === 'folder' &&
              node.parentId === parentId &&
              node.data === folderName
          );
          if (existing) {
            return {
              success: true,
              folderId: existing.id,
              name: existing.data,
              parentFolderId: existing.parentId,
              idempotentReplay: true,
              workspaceEffect: workspaceEffect('create_folder', existing.id),
            };
          }
          const folderId = nanoid();
          await apply([
            {
              op: 'upsert',
              key: folderId,
              values: {
                parentId,
                type: 'folder',
                data: folderName,
                index: nextIndex(nodes, parentId),
              },
            },
          ]);
          return {
            success: true,
            folderId,
            name: folderName,
            parentFolderId: parentId,
            idempotentReplay: false,
            workspaceEffect: workspaceEffect('create_folder', folderId),
          };
        }),
    }),

    workspace_folder_rename: defineTool({
      description:
        'Rename a folder after listing folders to obtain its current ID.',
      inputSchema: z
        .object({
          folder_id: z.string().trim().min(1),
          name: z.string().min(1).max(256),
        })
        .strict(),
      execute: async ({ folder_id, name }) =>
        execute('rename', async () => {
          await assertWrite();
          const { nodes } = await readOrganization();
          const target = requireFolder(nodes, folder_id);
          const folderName = normalizedName(name);
          if (!folderName) throw new Error('Folder name cannot be empty.');
          if (target.data === folderName) {
            return {
              success: true,
              folderId: target.id,
              name: target.data,
              idempotentReplay: true,
              workspaceEffect: workspaceEffect('rename_folder', target.id),
            };
          }
          const duplicate = nodes.some(
            node =>
              node.id !== target.id &&
              node.type === 'folder' &&
              node.parentId === target.parentId &&
              node.data === folderName
          );
          if (duplicate) {
            throw new Error(
              `A folder named "${folderName}" already exists in that location.`
            );
          }
          await apply([
            { op: 'upsert', key: target.id, values: { data: folderName } },
          ]);
          return {
            success: true,
            folderId: target.id,
            name: folderName,
            idempotentReplay: false,
            workspaceEffect: workspaceEffect('rename_folder', target.id),
          };
        }),
    }),

    workspace_folder_move: defineTool({
      description:
        'Move a folder to the workspace root or into another folder. Folder cycles are rejected.',
      inputSchema: z
        .object({
          folder_id: z.string().trim().min(1),
          parent_folder_id: z.string().trim().min(1).nullable(),
        })
        .strict(),
      execute: async ({ folder_id, parent_folder_id }) =>
        execute('move', async () => {
          await assertWrite();
          const { nodes } = await readOrganization();
          const target = requireFolder(nodes, folder_id);
          if (parent_folder_id) requireFolder(nodes, parent_folder_id);
          if (target.id === parent_folder_id) {
            throw new Error('A folder cannot be moved into itself.');
          }
          const childIds = new Set(
            descendants(nodes, target.id).map(x => x.id)
          );
          if (parent_folder_id && childIds.has(parent_folder_id)) {
            throw new Error('A folder cannot be moved into its descendant.');
          }
          if (target.parentId === parent_folder_id) {
            return {
              success: true,
              folderId: target.id,
              parentFolderId: target.parentId,
              idempotentReplay: true,
              workspaceEffect: workspaceEffect('move_folder', target.id),
            };
          }
          await apply([
            {
              op: 'upsert',
              key: target.id,
              values: {
                parentId: parent_folder_id,
                index: nextIndex(nodes, parent_folder_id),
              },
            },
          ]);
          return {
            success: true,
            folderId: target.id,
            parentFolderId: parent_folder_id,
            idempotentReplay: false,
            workspaceEffect: workspaceEffect('move_folder', target.id),
          };
        }),
    }),

    workspace_folder_delete: defineTool({
      description:
        'Delete a folder after listing folders. expected_name must exactly match the current name. Non-empty folders require recursive=true; documents themselves are never deleted.',
      inputSchema: z
        .object({
          folder_id: z.string().trim().min(1),
          expected_name: z.string().min(1).max(256),
          recursive: z.boolean().default(false),
        })
        .strict(),
      execute: async ({ folder_id, expected_name, recursive }) =>
        execute('delete', async () => {
          await assertWrite();
          const { nodes } = await readOrganization();
          const target = folder(nodes, folder_id);
          if (!target) {
            return {
              success: true,
              folderId: folder_id,
              alreadyAbsent: true,
              idempotentReplay: true,
              workspaceEffect: workspaceEffect('delete_folder', folder_id),
            };
          }
          if (target.data !== expected_name) {
            throw new Error(
              'expected_name does not match the current folder name.'
            );
          }
          const subtree = descendants(nodes, target.id);
          if (subtree.length > 1 && !recursive) {
            throw new Error(
              'The folder is not empty. Set recursive=true to remove the folder tree and its placements.'
            );
          }
          await apply(subtree.map(node => ({ op: 'delete', key: node.id })));
          return {
            success: true,
            folderId: target.id,
            deletedFolderCount: subtree.filter(node => node.type === 'folder')
              .length,
            removedPlacementCount: subtree.filter(
              node => node.type !== 'folder'
            ).length,
            documentsDeleted: 0,
            alreadyAbsent: false,
            idempotentReplay: false,
            workspaceEffect: workspaceEffect('delete_folder', target.id),
          };
        }),
    }),

    workspace_folder_add_document: defineTool({
      description:
        'Add a readable document to a folder while keeping any existing placements in other folders.',
      inputSchema: z
        .object({
          folder_id: z.string().trim().min(1),
          document_id: z.string().trim().min(1),
        })
        .strict(),
      execute: async ({ folder_id, document_id }) =>
        execute('add document', async () => {
          await assertWrite();
          await assertReadableDocument(document_id);
          const { nodes } = await readOrganization();
          requireFolder(nodes, folder_id);
          const existing = nodes.find(
            node =>
              node.type === 'doc' &&
              node.parentId === folder_id &&
              node.data === document_id
          );
          if (existing) {
            return {
              success: true,
              placementId: existing.id,
              documentId: document_id,
              folderId: folder_id,
              idempotentReplay: true,
              workspaceEffect: workspaceEffect('add_document', folder_id),
            };
          }
          const placementId = nanoid();
          await apply([
            {
              op: 'upsert',
              key: placementId,
              values: {
                parentId: folder_id,
                type: 'doc',
                data: document_id,
                index: nextIndex(nodes, folder_id),
              },
            },
          ]);
          return {
            success: true,
            placementId,
            documentId: document_id,
            folderId: folder_id,
            idempotentReplay: false,
            workspaceEffect: workspaceEffect('add_document', folder_id),
          };
        }),
    }),

    workspace_folder_move_document: defineTool({
      description:
        'Move a readable document to exactly one folder, or pass folder_id=null to remove all folder placements. The document itself is never deleted.',
      inputSchema: z
        .object({
          document_id: z.string().trim().min(1),
          folder_id: z.string().trim().min(1).nullable(),
        })
        .strict(),
      execute: async ({ document_id, folder_id }) =>
        execute('move document', async () => {
          await assertWrite();
          await assertReadableDocument(document_id);
          const { nodes } = await readOrganization();
          if (folder_id) requireFolder(nodes, folder_id);
          const placements = nodes.filter(
            node => node.type === 'doc' && node.data === document_id
          );
          if (!folder_id) {
            if (!placements.length) {
              return {
                success: true,
                documentId: document_id,
                folderId: null,
                removedPlacementCount: 0,
                idempotentReplay: true,
                workspaceEffect: workspaceEffect('move_document', null),
              };
            }
            await apply(
              placements.map(node => ({ op: 'delete', key: node.id }))
            );
            return {
              success: true,
              documentId: document_id,
              folderId: null,
              removedPlacementCount: placements.length,
              idempotentReplay: false,
              workspaceEffect: workspaceEffect('move_document', null),
            };
          }

          const targetPlacement = placements.find(
            node => node.parentId === folder_id
          );
          if (placements.length === 1 && targetPlacement) {
            return {
              success: true,
              placementId: targetPlacement.id,
              documentId: document_id,
              folderId: folder_id,
              idempotentReplay: true,
              workspaceEffect: workspaceEffect('move_document', folder_id),
            };
          }
          const placementId =
            targetPlacement?.id ?? placements[0]?.id ?? nanoid();
          const operations: Parameters<
            WorkspaceOrganizationService['applyDataOperations']
          >[4] = placements
            .filter(node => node.id !== placementId)
            .map(node => ({ op: 'delete', key: node.id }));
          if (!targetPlacement) {
            operations.push({
              op: 'upsert',
              key: placementId,
              values: {
                parentId: folder_id,
                type: 'doc',
                data: document_id,
                index: nextIndex(nodes, folder_id),
              },
            });
          }
          await apply(operations);
          return {
            success: true,
            placementId,
            documentId: document_id,
            folderId: folder_id,
            removedPlacementCount:
              placements.length - (targetPlacement ? 1 : 0),
            idempotentReplay: false,
            workspaceEffect: workspaceEffect('move_document', folder_id),
          };
        }),
    }),
  };
}
