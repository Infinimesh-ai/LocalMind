import { Injectable } from '@nestjs/common';
import {
  Args,
  Field,
  ID,
  InputType,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { z } from 'zod';

import { BadRequest, NotFound, ResourceConflict, Throttle } from '../../base';
import { Models } from '../../models';
import { nativeOperationHash } from '../../models/workspace-native-resource';
import { CurrentUser, type CurrentUser as User } from '../auth/session';
import { PermissionAccess } from '../permission';
import { WorkspaceNativeResourceAccess } from './native-resource-access';
import { WorkspaceOrganizationService } from './workspace-organization';
import { WorkspaceResourceService } from './workspace-resource';

const identitySchema = z.object({
  workspaceId: z.string().min(1).max(256),
  resourceId: z.string().min(1).max(256),
  kind: z.enum(['doc', 'folder']),
});
const changeSchema = identitySchema.extend({
  action: z.enum(['trash', 'restore', 'delete']),
  expectedVersion: z.string().min(1).max(256),
  requestKey: z.string().min(1).max(256),
});
@ObjectType()
class WorkspaceLifecycleChild {
  @Field(() => ID) id!: string;
  @Field() kind!: string;
  @Field() title!: string;
}
@ObjectType()
class WorkspaceLifecycleResource {
  @Field(() => ID) id!: string;
  @Field() kind!: string;
  @Field() title!: string;
  @Field() version!: string;
  @Field() trashed!: boolean;
  @Field(() => String, { nullable: true }) trashedAt!: string | null;
  @Field(() => [WorkspaceLifecycleChild]) children!: WorkspaceLifecycleChild[];
  @Field() childrenTruncated!: boolean;
  @Field(() => [String]) originalPaths!: string[];
  @Field() canTrash!: boolean;
  @Field() canRestore!: boolean;
  @Field() canDeletePermanently!: boolean;
}
@InputType()
class WorkspaceLifecycleIdentityInput {
  @Field(() => ID) workspaceId!: string;
  @Field(() => ID) resourceId!: string;
  @Field() kind!: string;
}
@InputType()
class ChangeWorkspaceLifecycleInput extends WorkspaceLifecycleIdentityInput {
  @Field() action!: string;
  @Field() expectedVersion!: string;
  @Field() requestKey!: string;
}
@ObjectType()
class WorkspaceLifecycleResult {
  @Field() success!: boolean;
  @Field(() => ID) resourceId!: string;
  @Field() action!: string;
}
const resultSchema = z.object({
  success: z.boolean(),
  resourceId: z.string(),
  action: z.string(),
});
@Injectable()
export class WorkspaceLifecycleService {
  constructor(
    private readonly organization: WorkspaceOrganizationService,
    private readonly resources: WorkspaceResourceService,
    private readonly models: Models,
    private readonly nativeAccess: WorkspaceNativeResourceAccess,
    private readonly ac: PermissionAccess
  ) {}
  private async snapshot(workspaceId: string, actorId: string) {
    await this.ac
      .user(actorId)
      .workspace(workspaceId)
      .assert('Workspace.Organize.Read');
    return this.organization.lifecycleSnapshot(workspaceId, actorId);
  }
  async listFolders(workspaceId: string, actorId: string) {
    const snapshot = await this.snapshot(workspaceId, actorId);
    const result: WorkspaceLifecycleResource[] = [];
    for (const row of snapshot.folders) {
      if (
        row.type !== 'folder' ||
        row.$$DELETED !== true ||
        row.$localmindTrashRoot !== true
      )
        continue;
      try {
        result.push(
          await this.describe(
            {
              workspaceId,
              actorId,
              resourceId: String(row.id),
              kind: 'folder',
            },
            snapshot
          )
        );
      } catch (error) {
        if (!(error instanceof NotFound)) throw error;
      }
    }
    return result;
  }
  private async describe(
    input: z.infer<typeof identitySchema> & { actorId: string },
    snapshot: Awaited<
      ReturnType<WorkspaceOrganizationService['lifecycleSnapshot']>
    >
  ) {
    const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
    const row =
      input.kind === 'doc'
        ? snapshot.documents.find(row => row.id === input.resourceId)
        : snapshot.folders.find(
            row => row.id === input.resourceId && row.type === 'folder'
          );
    if (!row) throw new NotFound('Resource unavailable');
    const trashed =
      input.kind === 'doc' ? row.trash === true : row.$$DELETED === true;
    let canTrash: boolean, canRestore: boolean, canDelete: boolean;
    if (input.kind === 'doc') {
      if (!(await acl.doc(input.resourceId).can('Doc.Read')))
        throw new NotFound('Resource unavailable');
      [canTrash, canRestore, canDelete] = await Promise.all([
        acl.doc(input.resourceId).can('Doc.Trash'),
        acl.doc(input.resourceId).can('Doc.Restore'),
        acl.doc(input.resourceId).can('Doc.Delete'),
      ]);
    } else {
      const path: string[] = [];
      let current: typeof row | undefined = row;
      while (current) {
        const id = String(current.id);
        if (path.includes(id) || path.length >= 64)
          throw new NotFound('Resource unavailable');
        path.push(id);
        const parentId: string | null =
          typeof current.parentId === 'string' ? current.parentId : null;
        current = parentId
          ? snapshot.folders.find(item => item.id === parentId)
          : undefined;
        if (parentId && !current) throw new NotFound('Resource unavailable');
      }
      const rights = await this.models.workspaceDirectoryGrant.rights({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        directoryIds: path,
      });
      if (!rights.canRead) throw new NotFound('Resource unavailable');
      canTrash = canRestore =
        rights.canWrite &&
        rights.canOrganize &&
        (await acl.can('Workspace.Sync'));
      canDelete = canTrash && (await acl.can('Workspace.Delete'));
    }
    const originalPaths: string[] = [];
    const placements =
      input.kind === 'doc'
        ? snapshot.folders.filter(
            item =>
              item.type === 'doc' &&
              item.data === input.resourceId &&
              (item.$$DELETED !== true || item.$localmindTrashOperationId)
          )
        : [row];
    if (!placements.length) originalPaths.push('');
    for (const placement of placements) {
      const path: string[] = [],
        names: string[] = [];
      let parent: string | null =
        typeof placement.parentId === 'string' ? placement.parentId : null;
      while (parent) {
        if (path.includes(parent) || path.length >= 64)
          throw new NotFound('Resource unavailable');
        path.push(parent);
        const folder = snapshot.folders.find(
          item => item.type === 'folder' && item.id === parent
        );
        names.unshift(String(folder?.data ?? '…'));
        parent = typeof folder?.parentId === 'string' ? folder.parentId : null;
      }
      const rights = await this.models.workspaceDirectoryGrant.rights({
        ...input,
        directoryIds: path,
      });
      if (rights.canRead) originalPaths.push(names.join(' / '));
    }
    const children: WorkspaceLifecycleChild[] = [];
    let childrenTruncated = false;
    if (input.kind === 'folder' && trashed) {
      const descendants = new Set([input.resourceId]);
      for (let changed = true; changed; ) {
        changed = false;
        for (const item of snapshot.folders)
          if (
            item.type === 'folder' &&
            descendants.has(String(item.parentId)) &&
            !descendants.has(String(item.id))
          ) {
            descendants.add(String(item.id));
            changed = true;
          }
      }
      for (const item of snapshot.folders) {
        if (!descendants.has(String(item.parentId))) continue;
        if (children.length >= 200) {
          childrenTruncated = true;
          break;
        }
        if (item.type === 'doc') {
          if (!(await acl.doc(String(item.data)).can('Doc.Read'))) continue;
          const doc = snapshot.documents.find(doc => doc.id === item.data);
          if (doc)
            children.push({
              id: String(item.data),
              kind: 'doc',
              title: String(doc.title ?? ''),
            });
        } else if (item.type === 'file' || item.type === 'office') {
          try {
            const resource = await this.nativeAccess.assert(
              { ...input, resourceId: String(item.data), kind: item.type },
              { trash: true }
            );
            children.push({
              id: resource.resourceId,
              kind: resource.kind,
              title: resource.title,
            });
          } catch {
            /* Inaccessible or permanently removed children stay undisclosed. */
          }
        }
      }
    }
    const rawDate =
      input.kind === 'doc' ? row.trashDate : row.$localmindTrashedAt;
    return {
      children,
      childrenTruncated,
      originalPaths,
      id: input.resourceId,
      kind: input.kind,
      title: String(
        input.kind === 'doc' ? (row.title ?? '') : (row.data ?? '')
      ),
      version: nativeOperationHash({
        row,
        ...(input.kind === 'folder'
          ? {
              folders: snapshot.folders,
              documents: snapshot.documents.map(item => ({
                id: item.id,
                trash: item.trash,
              })),
            }
          : {}),
      }),
      trashed,
      trashedAt: rawDate
        ? new Date(
            typeof rawDate === 'number' ? rawDate : String(rawDate)
          ).toISOString()
        : null,
      canTrash: !trashed && canTrash,
      canRestore: trashed && canRestore,
      canDeletePermanently: trashed && canDelete,
    };
  }
  async get(input: z.infer<typeof identitySchema> & { actorId: string }) {
    return this.describe(
      input,
      await this.snapshot(input.workspaceId, input.actorId)
    );
  }
  async change(input: z.infer<typeof changeSchema> & { actorId: string }) {
    return this.resources.snapshot(input, async () => {
      const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
      await acl.assert('Workspace.Sync');
      if (input.action === 'delete' && input.kind === 'folder')
        await acl.assert('Workspace.Delete');
      const action =
        input.action === 'trash'
          ? 'Doc.Trash'
          : input.action === 'restore'
            ? 'Doc.Restore'
            : 'Doc.Delete';
      if (input.kind === 'doc') await acl.doc(input.resourceId).assert(action);
      const hash = nativeOperationHash(input);
      const replay = await this.models.workspaceLifecycle.receipt(
        {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          requestKey: input.requestKey,
        },
        hash
      );
      if (replay) {
        // Replays carry no content but still require the actor's current authority.
        const evidence = z
          .object({
            directoryIds: z.array(z.string()),
            documentIds: z.array(z.string()),
          })
          .parse((replay.result as Record<string, unknown>).authorization);
        if (input.kind === 'folder') {
          const rights = await this.models.workspaceDirectoryGrant.rights({
            ...input,
            directoryIds: evidence.directoryIds,
          });
          if (!rights.canRead || !rights.canWrite || !rights.canOrganize)
            throw new NotFound('Resource unavailable');
          for (const id of evidence.documentIds)
            await acl.doc(id).assert(action);
        }
        return resultSchema.parse(replay.result);
      }
      const snapshot = await this.snapshot(input.workspaceId, input.actorId);
      const directoryIds = new Set<string>();
      const documentIds = new Set<string>();
      if (input.kind === 'folder') {
        directoryIds.add(input.resourceId);
        for (let changed = true; changed; ) {
          changed = false;
          for (const row of snapshot.folders) {
            if (
              row.type === 'folder' &&
              directoryIds.has(String(row.parentId)) &&
              !directoryIds.has(String(row.id))
            ) {
              directoryIds.add(String(row.id));
              changed = true;
            }
          }
        }
        for (const row of snapshot.folders)
          if (row.type === 'doc' && directoryIds.has(String(row.parentId)))
            documentIds.add(String(row.data));
        let ancestor = snapshot.folders.find(
          row => row.id === input.resourceId
        )?.parentId;
        for (let depth = 0; ancestor; depth++) {
          if (depth > 64) throw new NotFound('Resource unavailable');
          directoryIds.add(String(ancestor));
          ancestor = snapshot.folders.find(
            row => row.id === ancestor
          )?.parentId;
        }
      }
      const current = await this.get(input);
      if (current.version !== input.expectedVersion)
        throw new ResourceConflict('Resource changed; refresh before editing');
      const can =
        input.action === 'trash'
          ? current.canTrash
          : input.action === 'restore'
            ? current.canRestore
            : current.canDeletePermanently;
      if (!can) throw new BadRequest('This lifecycle action is unavailable');
      if (input.kind === 'doc') {
        await acl.doc(input.resourceId).assert(action);
        if (input.action === 'delete')
          await this.organization.deleteDocumentPermanently({
            ...input,
            userId: input.actorId,
            editorId: input.actorId,
            documentId: input.resourceId,
            expectedTitle: current.title,
          });
        else {
          const changed = await this.organization.setDocumentTrashed({
            ...input,
            editorId: input.actorId,
            documentId: input.resourceId,
            expectedTitle: current.title,
            trashed: input.action === 'trash',
          });
          if (input.action === 'restore' && changed.trashed)
            throw new BadRequest('Restore the containing folder first');
        }
      } else {
        const operation = {
          ...input,
          userId: input.actorId,
          editorId: input.actorId,
          folderId: input.resourceId,
          expectedName: current.title,
          authorizeDocument: (id: string) => acl.doc(id).assert(action),
        };
        if (input.action === 'trash')
          await this.organization.trashFolderTree({
            ...operation,
            recursive: true,
          });
        else if (input.action === 'restore')
          await this.organization.restoreFolderTree(operation);
        else await this.organization.deleteFolderTreePermanently(operation);
      }
      const result = {
        success: true,
        resourceId: input.resourceId,
        action: input.action,
      };
      await this.models.workspaceLifecycle.record({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        resourceId: input.resourceId,
        kind: input.kind,
        action: input.action,
        requestKey: input.requestKey,
        requestHash: hash,
        result: {
          ...result,
          authorization: {
            directoryIds: [...directoryIds],
            documentIds: [...documentIds],
          },
        },
      });
      return result;
    });
  }
}
@Resolver()
@Throttle()
export class WorkspaceLifecycleResolver {
  constructor(private readonly service: WorkspaceLifecycleService) {}
  @Query(() => WorkspaceLifecycleResource)
  workspaceLifecycleResource(
    @CurrentUser() actor: User,
    @Args('input') input: WorkspaceLifecycleIdentityInput
  ) {
    return this.service.get({
      ...identitySchema.parse(input),
      actorId: actor.id,
    });
  }
  @Query(() => [WorkspaceLifecycleResource])
  workspaceTrashedFolders(
    @CurrentUser() actor: User,
    @Args('workspaceId') workspaceId: string
  ) {
    return this.service.listFolders(
      z.string().min(1).max(256).parse(workspaceId),
      actor.id
    );
  }
  @Mutation(() => WorkspaceLifecycleResult)
  changeWorkspaceLifecycle(
    @CurrentUser() actor: User,
    @Args('input') input: ChangeWorkspaceLifecycleInput
  ) {
    return this.service.change({
      ...changeSchema.parse(input),
      actorId: actor.id,
    });
  }
}
