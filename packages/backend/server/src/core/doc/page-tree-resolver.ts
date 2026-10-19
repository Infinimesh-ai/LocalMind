import { PageTreeError, WORKSPACE_PAGE_TREE_CONTRACT } from '@affine/graphql';
import {
  Args,
  Field,
  ID,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { z } from 'zod';

import { BadRequest, Throttle } from '../../base';
import { type CurrentUser as Actor, CurrentUser } from '../auth/session';
import { WorkspacePageTreeService } from './workspace-page-tree';

@ObjectType()
class WorkspacePageTreeFolderMetadata {
  @Field() title!: string;
  @Field(() => Int) metadataVersion!: number;
  @Field(() => String, { nullable: true }) createdAt!: string | null;
  @Field(() => ID, { nullable: true }) createdBy!: string | null;
  @Field(() => String, { nullable: true }) updatedAt!: string | null;
  @Field(() => ID, { nullable: true }) updatedBy!: string | null;
}
@InputType()
class WorkspacePageTreeFolderInput {
  @Field() title!: string;
  @Field(() => Int) metadataVersion!: number;
  @Field(() => String, { nullable: true }) createdAt!: string | null;
  @Field(() => ID, { nullable: true }) createdBy!: string | null;
  @Field(() => String, { nullable: true }) updatedAt!: string | null;
  @Field(() => ID, { nullable: true }) updatedBy!: string | null;
}
@ObjectType()
class WorkspacePageTreeItem {
  @Field(() => ID) nodeId!: string;
  @Field(() => ID) resourceId!: string;
  @Field() kind!: string;
  @Field(() => String, { nullable: true }) primaryMode!: string | null;
  @Field(() => ID, { nullable: true }) parentNodeId!: string | null;
  @Field() title!: string;
  @Field() documentType!: string;
  @Field() order!: string;
  @Field() trashed!: boolean;
  @Field() canOrganize!: boolean;
  @Field() isContainer!: boolean;
  @Field() canRename!: boolean;
  @Field() canConvertToPage!: boolean;
  @Field(() => WorkspacePageTreeFolderMetadata, { nullable: true })
  folder!: WorkspacePageTreeFolderMetadata | null;
  @Field(() => String, { nullable: true }) defaultSortMode!: string | null;
}
@ObjectType()
class WorkspacePageTreePage {
  @Field() enabled!: boolean;
  @Field(() => String, { nullable: true }) contractVersion!: string | null;
  @Field() canCreateFolder!: boolean;
  @Field() canCreatePage!: boolean;
  @Field(() => Int) revision!: number;
  @Field() authorizationRevision!: string;
  @Field(() => String, { nullable: true }) snapshotRevision!: string | null;
  @Field(() => WorkspacePageTreeItem, { nullable: true })
  parent!: WorkspacePageTreeItem | null;
  @Field(() => [WorkspacePageTreeItem]) ancestors!: WorkspacePageTreeItem[];
  @Field(() => [WorkspacePageTreeItem]) items!: WorkspacePageTreeItem[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}
@ObjectType()
class WorkspacePageTreeImpactItem {
  @Field(() => ID) nodeId!: string;
  @Field() title!: string;
  @Field() documentType!: string;
}
@ObjectType()
class WorkspacePageTreeImpact {
  @Field(() => Int) revision!: number;
  @Field() authorizationRevision!: string;
  @Field(() => ID, { nullable: true }) parentNodeId!: string | null;
  @Field(() => Int) total!: number;
  @Field() truncated!: boolean;
  @Field(() => [WorkspacePageTreeImpactItem])
  items!: WorkspacePageTreeImpactItem[];
}
@ObjectType()
class WorkspacePageTreeConversionPreview {
  @Field(() => ID) nodeId!: string;
  @Field() title!: string;
  @Field(() => Int) revision!: number;
  @Field() authorizationRevision!: string;
  @Field(() => Int) resourceVersion!: number;
  @Field() targetKind!: string;
}
@InputType()
class WorkspacePageTreeCommandInput {
  @Field(() => ID) workspaceId!: string;
  @Field() contractVersion!: string;
  @Field(() => Int) expectedRevision!: number;
  @Field() expectedAuthorizationRevision!: string;
  @Field() requestKey!: string;
  @Field() action!: string;
  @Field(() => Int, { nullable: true }) expectedResourceVersion?: number;
  @Field(() => ID, { nullable: true }) nodeId?: string;
  @Field(() => ID, { nullable: true }) parentNodeId?: string | null;
  @Field(() => ID, { nullable: true }) beforeNodeId?: string;
  @Field(() => [ID], { nullable: true }) siblingOrder?: string[];
  @Field(() => [ID], { nullable: true }) targetSiblingOrder?: string[];
  @Field(() => [ID], { nullable: true }) sourceSiblingOrder?: string[];
  @Field(() => ID, { nullable: true }) expectedParentNodeId?: string | null;
  @Field(() => String, { nullable: true }) title?: string;
  @Field(() => String, { nullable: true }) primaryMode?: string;
  @Field(() => ID, { nullable: true }) insertAfterBlockId?: string;
  @Field(() => ID, { nullable: true }) resourceId?: string;
}
@ObjectType()
class WorkspacePageTreeReceipt {
  @Field(() => ID) operationId!: string;
  @Field(() => ID) nodeId!: string;
  @Field(() => ID) resourceId!: string;
  @Field(() => ID, { nullable: true }) parentNodeId!: string | null;
  @Field(() => Int) revision!: number;
  @Field(() => ID, { nullable: true }) oldParentNodeId!: string | null;
  @Field(() => ID, { nullable: true }) oldBeforeNodeId!: string | null;
  @Field(() => [ID], { nullable: true }) oldSiblingOrder!: string[] | null;
  @Field(() => [ID], { nullable: true }) oldTargetSiblingOrder!:
    | string[]
    | null;
  @Field(() => [ID], { nullable: true }) oldSourceSiblingOrder!:
    | string[]
    | null;
}
@InputType()
class WorkspaceLocalPageTreePosition {
  @Field() kind!: string;
  @Field() trashed!: boolean;
  @Field(() => WorkspacePageTreeFolderInput, { nullable: true })
  folder?: WorkspacePageTreeFolderInput;
  @Field(() => ID) nodeId!: string;
  @Field(() => ID) resourceId!: string;
  @Field(() => ID, { nullable: true }) parentNodeId!: string | null;
  @Field() order!: string;
  @Field(() => String, { nullable: true }) defaultSortMode?: string;
  @Field(() => ID, { nullable: true }) trashRootNodeId?: string;
}
const id = z.string().min(1).max(512);
const base = z.object({
  workspaceId: id,
  contractVersion: z.literal(WORKSPACE_PAGE_TREE_CONTRACT),
  expectedRevision: z.number().int().nonnegative(),
  expectedAuthorizationRevision: z.string().length(64),
  requestKey: z.string().min(1).max(256),
});
const folderSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    metadataVersion: z.number().int().positive(),
    createdAt: z.string().datetime().nullable(),
    createdBy: id.nullable(),
    updatedAt: z.string().datetime().nullable(),
    updatedBy: id.nullable(),
  })
  .strict();
const commandSchema = z.discriminatedUnion('action', [
  base
    .extend({
      action: z.literal('create-folder'),
      parentNodeId: id.nullable(),
      title: z.string().trim().min(1).max(512),
    })
    .strict(),
  base
    .extend({
      action: z.literal('rename-folder'),
      nodeId: id,
      title: z.string().trim().min(1).max(512),
      expectedResourceVersion: z.number().int().positive(),
    })
    .strict(),
  base
    .extend({
      action: z.literal('convert-folder'),
      nodeId: id,
      expectedResourceVersion: z.number().int().positive(),
    })
    .strict(),
  base.extend({
    action: z.literal('create'),
    title: z.string().trim().min(1).max(512),
    parentNodeId: id.nullable(),
    primaryMode: z.enum(['page', 'edgeless']),
    resourceId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .optional(),
    insertAfterBlockId: id.optional(),
  }),
  base.extend({
    action: z.literal('move'),
    nodeId: id,
    parentNodeId: id.nullable(),
    beforeNodeId: id.optional(),
    siblingOrder: z.array(id).min(1).max(10000).optional(),
    targetSiblingOrder: z.array(id).min(1).max(10000).optional(),
    sourceSiblingOrder: z.array(id).max(10000).optional(),
    insertAfterBlockId: id.optional(),
  }),
  base.extend({
    action: z.enum(['trash', 'delete']),
    nodeId: id,
    expectedParentNodeId: id.nullable().optional(),
  }),
  base.extend({
    action: z.literal('restore'),
    nodeId: id,
    parentNodeId: id.nullable().optional(),
  }),
]);
const receiptSchema = z.object({
  nodeId: id,
  resource: z.object({ resourceId: id }),
  parentNodeId: id.nullable(),
  revision: z.number().int(),
  oldParentNodeId: id.nullable(),
  oldBeforeNodeId: id.nullable(),
  oldSiblingOrder: z.array(id).nullable().optional(),
  oldTargetSiblingOrder: z.array(id).nullable().optional(),
  oldSourceSiblingOrder: z.array(id).nullable().optional(),
});

@Throttle()
@Resolver()
export class WorkspacePageTreeResolver {
  constructor(private readonly service: WorkspacePageTreeService) {}
  @Query(() => WorkspacePageTreeConversionPreview)
  async workspacePageTreeConversionPreview(
    @CurrentUser() actor: Actor,
    @Args('workspaceId', { type: () => ID }) workspaceId: string,
    @Args('nodeId', { type: () => ID }) nodeId: string
  ) {
    if (!id.safeParse(workspaceId).success || !id.safeParse(nodeId).success)
      throw new BadRequest('Invalid conversion preview');
    return this.service.conversionPreview(
      { workspaceId, actorId: actor.id },
      nodeId
    );
  }
  @Query(() => WorkspacePageTreeImpact)
  async workspacePageTreeImpact(
    @CurrentUser() actor: Actor,
    @Args('workspaceId', { type: () => ID }) workspaceId: string,
    @Args('nodeId', { type: () => ID }) nodeId: string,
    @Args('action') action: string
  ) {
    const parsed = z
      .object({
        workspaceId: id,
        nodeId: id,
        action: z.enum(['trash', 'restore', 'delete']),
      })
      .safeParse({ workspaceId, nodeId, action });
    if (!parsed.success) throw new BadRequest('Invalid page tree preview');
    return this.service.lifecyclePreview(
      { workspaceId, actorId: actor.id },
      nodeId,
      parsed.data.action
    );
  }
  @Mutation(() => Boolean)
  async adoptWorkspaceLocalPageTree(
    @CurrentUser() actor: Actor,
    @Args('workspaceId', { type: () => ID }) workspaceId: string,
    @Args('contractVersion') contractVersion: string,
    @Args('positions', { type: () => [WorkspaceLocalPageTreePosition] })
    positions: WorkspaceLocalPageTreePosition[]
  ) {
    const parsed = z
      .object({
        workspaceId: id,
        contractVersion: z.literal(WORKSPACE_PAGE_TREE_CONTRACT),
        positions: z
          .array(
            z
              .object({
                nodeId: id,
                kind: z.enum(['doc', 'folder']),
                trashed: z.boolean(),
                folder: folderSchema.optional(),
                resourceId: id,
                parentNodeId: id.nullable(),
                order: z.string().min(1).max(512),
                defaultSortMode: z.literal('name-desc').optional(),
                trashRootNodeId: id.optional(),
              })
              .strict()
          )
          .max(10000),
      })
      .safeParse({ workspaceId, contractVersion, positions });
    if (!parsed.success)
      throw new BadRequest(
        'Invalid local page tree upload; at most 10000 resources are supported'
      );
    const result = await this.service.adoptLocalTree(
      { workspaceId, actorId: actor.id },
      parsed.data.positions
    );
    return result?.phase === 'switched';
  }
  @Query(() => WorkspacePageTreePage)
  @Throttle('default', { bucket: 'workspace-tree-read' })
  async workspacePageTree(
    @CurrentUser() actor: Actor,
    @Args('workspaceId', { type: () => ID }) workspaceId: string,
    @Args('parentNodeId', { type: () => ID, nullable: true })
    parentNodeId?: string | null,
    @Args('after', { type: () => String, nullable: true }) after?: string,
    @Args('trash', { type: () => Boolean, nullable: true }) trash?: boolean,
    @Args('resourceId', { type: () => ID, nullable: true }) resourceId?: string,
    @Args('clientContract', { type: () => String, nullable: true })
    clientContract?: string,
    @Args('resourceKind', { type: () => String, nullable: true })
    resourceKind?: string
  ) {
    if (clientContract !== WORKSPACE_PAGE_TREE_CONTRACT)
      throw new BadRequest('page_tree_client_upgrade_required');
    if (
      !id.safeParse(workspaceId).success ||
      (parentNodeId != null && !id.safeParse(parentNodeId).success) ||
      (after?.length ?? 0) > 1024
    )
      throw new BadRequest('Invalid page tree request');
    if (
      (resourceId || resourceKind) &&
      (!resourceId ||
        !id.safeParse(resourceId).success ||
        !['doc', 'office', 'file', 'folder'].includes(resourceKind ?? ''))
    )
      throw new BadRequest('Invalid resource identity');
    const result = await this.service.list(
      { workspaceId, actorId: actor.id },
      parentNodeId ?? null,
      after,
      100,
      {
        trash,
        ...(resourceId
          ? {
              resource: {
                kind: resourceKind as 'doc' | 'office' | 'file' | 'folder',
                resourceId,
              },
            }
          : {}),
      }
    );
    const describe = (node: (typeof result.items)[number]) => ({
      nodeId: node.nodeId,
      resourceId: node.resource.resourceId,
      kind: node.resource.kind,
      primaryMode: node.resource.primaryMode ?? null,
      parentNodeId: node.parentNodeId,
      title: node.title,
      documentType: node.documentType,
      order: node.order,
      trashed: node.resource.trashed,
      canOrganize: node.rights.canWrite && node.rights.canOrganize,
      isContainer: node.isContainer,
      canRename:
        node.resource.kind === 'folder' &&
        !node.resource.trashed &&
        node.rights.canWrite &&
        node.rights.canOrganize,
      canConvertToPage: node.canConvertToPage,
      folder: node.folder ?? null,
      defaultSortMode: node.defaultSortMode ?? null,
    });
    return {
      ...result,
      items: result.items.map(describe),
      parent: result.parent ? describe(result.parent) : null,
      ancestors: result.ancestors.map(describe),
    };
  }
  @Mutation(() => WorkspacePageTreeReceipt)
  async mutateWorkspacePageTree(
    @CurrentUser() actor: Actor,
    @Args('input') input: WorkspacePageTreeCommandInput
  ) {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new BadRequest('Invalid page tree command');
    const { workspaceId, ...command } = parsed.data;
    const result = await this.service
      .execute({ workspaceId, actorId: actor.id }, command)
      .catch(error => {
        if (error instanceof PageTreeError)
          throw new BadRequest(`page_tree_${error.code}`);
        throw error;
      });
    const receipt = receiptSchema.parse(result.result);
    return {
      operationId: result.id,
      nodeId: receipt.nodeId,
      resourceId: receipt.resource.resourceId,
      parentNodeId: receipt.parentNodeId,
      revision: receipt.revision,
      oldParentNodeId: receipt.oldParentNodeId,
      oldBeforeNodeId: receipt.oldBeforeNodeId,
      oldSiblingOrder: receipt.oldSiblingOrder ?? null,
      oldTargetSiblingOrder: receipt.oldTargetSiblingOrder ?? null,
      oldSourceSiblingOrder: receipt.oldSourceSiblingOrder ?? null,
    };
  }
}
