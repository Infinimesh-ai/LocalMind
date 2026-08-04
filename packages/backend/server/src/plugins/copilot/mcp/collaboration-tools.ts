import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import type { GraphqlContext } from '../../../base/graphql';
import type {
  DocResolver,
  WorkspaceDocResolver,
} from '../../../core/workspaces/resolvers/doc';
import type { WorkspaceMemberResolver } from '../../../core/workspaces/resolvers/member';
import type { WorkspaceResolver } from '../../../core/workspaces/resolvers/workspace';
import { DocRole, PublicDocMode, WorkspaceRole } from '../../../models';
import {
  defineTool,
  DESTRUCTIVE_WRITE_TOOL,
  OPEN_WORLD_DESTRUCTIVE_TOOL,
  OPEN_WORLD_WRITE_TOOL,
  READ_ONLY_TOOL,
  RESULT_OUTPUT_SCHEMA,
  toolError,
  toolResult,
  type WorkspaceMcpToolDefinition,
  WRITE_TOOL,
} from './types';

type CollaborationToolDependencies = {
  workspaceResolver: WorkspaceResolver;
  workspaceDocResolver: WorkspaceDocResolver;
  docResolver: DocResolver;
  memberResolver: WorkspaceMemberResolver;
  request?: Request;
  logger: Logger;
};

const DOC_ROLES: Record<string, DocRole> = {
  external: DocRole.External,
  reader: DocRole.Reader,
  commenter: DocRole.Commenter,
  editor: DocRole.Editor,
  manager: DocRole.Manager,
  owner: DocRole.Owner,
};

const WORKSPACE_ROLES: Record<string, WorkspaceRole> = {
  collaborator: WorkspaceRole.Collaborator,
  admin: WorkspaceRole.Admin,
  owner: WorkspaceRole.Owner,
};

const INVITE_EXPIRATIONS = {
  one_day: 24 * 60 * 60 * 1000,
  three_days: 3 * 24 * 60 * 60 * 1000,
  one_week: 7 * 24 * 60 * 60 * 1000,
  one_month: 30 * 24 * 60 * 60 * 1000,
} as const;

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createCollaborationMcpTools(
  dependencies: CollaborationToolDependencies,
  userId: string,
  workspaceId: string
) {
  const {
    docResolver,
    logger,
    memberResolver,
    request,
    workspaceDocResolver,
    workspaceResolver,
  } = dependencies;
  const user = { id: userId } as never;
  const workspace = { id: workspaceId } as never;
  const execute = async (operation: () => Promise<unknown>) => {
    try {
      return toolResult(jsonSafe(await operation()));
    } catch (error) {
      logger.warn(
        `Collaboration operation failed in ${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return toolError(
        error instanceof Error
          ? `Collaboration operation rejected: ${error.message}`
          : 'Collaboration operation rejected.'
      );
    }
  };

  const readTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'read_document_collaboration',
      title: 'Read Document Collaboration',
      description:
        'Read document public state, default role, effective permissions, and explicitly granted users.',
      parser: z
        .object({
          docId: z.string().min(1),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ docId, offset, limit }) =>
        execute(async () => {
          const doc = await workspaceDocResolver.doc(user, workspace, docId);
          const [permissions, grantedUsers] = await Promise.all([
            docResolver.permissions(user, doc),
            docResolver.grantedUsersList(user, doc, {
              first: limit,
              offset,
            }),
          ]);
          return { doc, permissions, grantedUsers };
        }),
    }),
    defineTool({
      name: 'list_workspace_members',
      title: 'List Workspace Members',
      description:
        'List or search workspace members and pending membership records visible to the credential user.',
      parser: z
        .object({
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(50),
          query: z.string().max(255).optional(),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async ({ offset, limit, query }) =>
        execute(async () => ({
          members: await memberResolver.members(
            user,
            workspace,
            offset,
            limit,
            query
          ),
        })),
    }),
    defineTool({
      name: 'read_workspace_invite_link',
      title: 'Read Workspace Invite Link',
      description:
        'Read the active workspace invite link and expiration, if any.',
      parser: z.object({}).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: READ_ONLY_TOOL,
      execute: async () =>
        execute(async () => ({
          inviteLink: await memberResolver.inviteLink(workspace, user),
        })),
    }),
  ];

  const writeTools: WorkspaceMcpToolDefinition[] = [
    defineTool({
      name: 'publish_document',
      title: 'Publish Document',
      description:
        'Publish a document through the existing document permission and share-abuse guard path.',
      parser: z
        .object({
          docId: z.string().min(1),
          mode: z.enum(['page', 'edgeless']).default('page'),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: OPEN_WORLD_WRITE_TOOL,
      execute: async ({ docId, mode }) =>
        execute(() =>
          workspaceDocResolver.publishDoc(
            user,
            workspaceId,
            docId,
            mode === 'edgeless' ? PublicDocMode.Edgeless : PublicDocMode.Page
          )
        ),
    }),
    defineTool({
      name: 'unpublish_document',
      title: 'Unpublish Document',
      description: 'Revoke public access to a published document.',
      parser: z.object({ docId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: OPEN_WORLD_DESTRUCTIVE_TOOL,
      execute: async ({ docId }) =>
        execute(() =>
          workspaceDocResolver.revokePublicDoc(user, workspaceId, docId)
        ),
    }),
    defineTool({
      name: 'grant_document_roles',
      title: 'Grant Document Roles',
      description: 'Grant a document role to one or more workspace users.',
      parser: z
        .object({
          docId: z.string().min(1),
          userIds: z.array(z.string().min(1)).min(1).max(100),
          role: z.enum([
            'external',
            'reader',
            'commenter',
            'editor',
            'manager',
          ]),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ docId, userIds, role }) =>
        execute(() =>
          docResolver.grantDocUserRoles(user, {
            workspaceId,
            docId,
            userIds,
            role: DOC_ROLES[role],
          })
        ),
    }),
    defineTool({
      name: 'update_document_user_role',
      title: 'Update Document User Role',
      description:
        'Update one user document role, including ownership transfer when authorized.',
      parser: z
        .object({
          docId: z.string().min(1),
          targetUserId: z.string().min(1),
          role: z.enum([
            'external',
            'reader',
            'commenter',
            'editor',
            'manager',
            'owner',
          ]),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ docId, targetUserId, role }) =>
        execute(() =>
          docResolver.updateDocUserRole(user, {
            workspaceId,
            docId,
            userId: targetUserId,
            role: DOC_ROLES[role],
          })
        ),
    }),
    defineTool({
      name: 'revoke_document_user_role',
      title: 'Revoke Document User Role',
      description: 'Revoke one user explicit document role.',
      parser: z
        .object({
          docId: z.string().min(1),
          targetUserId: z.string().min(1),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ docId, targetUserId }) =>
        execute(() =>
          docResolver.revokeDocUserRoles(user, {
            workspaceId,
            docId,
            userId: targetUserId,
          })
        ),
    }),
    defineTool({
      name: 'update_document_default_role',
      title: 'Update Document Default Role',
      description: 'Set the default role for users who can reach the document.',
      parser: z
        .object({
          docId: z.string().min(1),
          role: z.enum([
            'external',
            'reader',
            'commenter',
            'editor',
            'manager',
          ]),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ docId, role }) =>
        execute(() =>
          docResolver.updateDocDefaultRole(user, {
            workspaceId,
            docId,
            role: DOC_ROLES[role],
          })
        ),
    }),
    defineTool({
      name: 'invite_workspace_members',
      title: 'Invite Workspace Members',
      description:
        'Invite members by email through existing validation, abuse controls, seat quota, and notification paths.',
      parser: z
        .object({ emails: z.array(z.string().email()).min(1).max(100) })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: OPEN_WORLD_WRITE_TOOL,
      execute: async ({ emails }) => {
        if (!request) return toolError('HTTP request context is unavailable.');
        return execute(() =>
          memberResolver.inviteMembers(
            user,
            { req: request } as GraphqlContext,
            workspaceId,
            emails
          )
        );
      },
    }),
    defineTool({
      name: 'create_workspace_invite_link',
      title: 'Create Workspace Invite Link',
      description:
        'Create or reuse a share-abuse-checked workspace invite link with bounded expiration.',
      parser: z
        .object({
          expiration: z
            .enum(['one_day', 'three_days', 'one_week', 'one_month'])
            .default('one_week'),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: OPEN_WORLD_WRITE_TOOL,
      execute: async ({ expiration }) =>
        execute(() =>
          memberResolver.createInviteLink(
            user,
            workspaceId,
            INVITE_EXPIRATIONS[expiration]
          )
        ),
    }),
    defineTool({
      name: 'revoke_workspace_invite_link',
      title: 'Revoke Workspace Invite Link',
      description: 'Revoke the active workspace invite link.',
      parser: z.object({}).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: OPEN_WORLD_DESTRUCTIVE_TOOL,
      execute: async () =>
        execute(() => memberResolver.revokeInviteLink(user, workspaceId)),
    }),
    defineTool({
      name: 'update_workspace_member_role',
      title: 'Update Workspace Member Role',
      description:
        'Update a workspace member role or transfer workspace ownership when authorized.',
      parser: z
        .object({
          targetUserId: z.string().min(1),
          role: z.enum(['collaborator', 'admin', 'owner']),
        })
        .strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ targetUserId, role }) =>
        execute(() =>
          memberResolver.grantMember(
            user,
            workspaceId,
            targetUserId,
            WORKSPACE_ROLES[role]
          )
        ),
    }),
    defineTool({
      name: 'approve_workspace_member',
      title: 'Approve Workspace Member',
      description: 'Approve a workspace membership record under review.',
      parser: z.object({ targetUserId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async ({ targetUserId }) =>
        execute(() =>
          memberResolver.approveMember(user, workspaceId, targetUserId)
        ),
    }),
    defineTool({
      name: 'remove_workspace_member',
      title: 'Remove Workspace Member',
      description: 'Remove a workspace member or decline a pending membership.',
      parser: z.object({ targetUserId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: OPEN_WORLD_DESTRUCTIVE_TOOL,
      execute: async ({ targetUserId }) =>
        execute(() =>
          memberResolver.revokeMember(user, workspaceId, targetUserId)
        ),
    }),
    defineTool({
      name: 'update_workspace_settings',
      title: 'Update Workspace Settings',
      description:
        'Update user-facing workspace sharing, AI, URL preview, document embedding, or public settings.',
      parser: z
        .object({
          public: z.boolean().optional(),
          enableAi: z.boolean().optional(),
          enableSharing: z.boolean().optional(),
          enableUrlPreview: z.boolean().optional(),
          enableDocEmbedding: z.boolean().optional(),
        })
        .strict()
        .refine(input => Object.keys(input).length > 0, {
          message: 'At least one setting is required',
        }),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: WRITE_TOOL,
      execute: async settings =>
        execute(() =>
          workspaceResolver.updateWorkspace(user, {
            id: workspaceId,
            ...settings,
          })
        ),
    }),
    defineTool({
      name: 'delete_workspace',
      title: 'Delete Workspace',
      description:
        'Permanently delete the MCP-bound workspace and its owned data. Requires exact workspace id confirmation.',
      parser: z.object({ confirmWorkspaceId: z.string().min(1) }).strict(),
      outputSchema: RESULT_OUTPUT_SCHEMA,
      annotations: DESTRUCTIVE_WRITE_TOOL,
      execute: async ({ confirmWorkspaceId }) => {
        if (confirmWorkspaceId !== workspaceId) {
          return toolError('Workspace id confirmation does not match.');
        }
        return execute(async () => ({
          deleted: await workspaceResolver.deleteWorkspace(user, workspaceId),
          workspaceId,
        }));
      },
    }),
  ];

  return { readTools, writeTools };
}
