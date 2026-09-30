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
import { GraphQLJSONObject } from 'graphql-scalars';
import { z } from 'zod';

import { Throttle } from '../../base';
import { CurrentUser, type CurrentUser as User } from '../auth';
import { WorkspaceNativeResourceService } from './workspace-resource-service';

@ObjectType()
class WorkspaceNativeResourceType {
  @Field(() => ID) id!: string;
  @Field(() => ID) workspaceId!: string;
  @Field() kind!: string;
  @Field() title!: string;
  @Field() fileName!: string;
  @Field() mimeType!: string;
  @Field(() => Int) byteSize!: number;
  @Field(() => Int) metadataVersion!: number;
  @Field(() => Int) contentVersion!: number;
  @Field(() => ID) revisionId!: string;
  @Field() searchStatus!: string;
  @Field(() => Boolean, { nullable: true }) canEdit?: boolean;
  @Field(() => Boolean, { nullable: true }) canManage?: boolean;
  @Field(() => Boolean, { nullable: true }) canRename?: boolean;
  @Field(() => Boolean, { nullable: true }) canMove?: boolean;
  @Field(() => Boolean, { nullable: true }) canCopy?: boolean;
  @Field(() => Boolean, { nullable: true }) canTrash?: boolean;
  @Field(() => Boolean, { nullable: true }) canRestore?: boolean;
  @Field(() => Boolean, { nullable: true }) canDeletePermanently?: boolean;
  @Field(() => [ID], { nullable: true }) folderIds?: string[];
  @Field(() => [String], { nullable: true }) folderPaths?: string[];
  @Field(() => Boolean, { nullable: true }) atRoot?: boolean;
  @Field(() => Date) createdAt!: Date;
  @Field(() => Date) updatedAt!: Date;
  @Field(() => Date, { nullable: true }) trashedAt!: Date | null;
  @Field(() => Date, { nullable: true }) deletedAt!: Date | null;
}

@ObjectType()
class WorkspaceNativePageType {
  @Field(() => [WorkspaceNativeResourceType])
  items!: WorkspaceNativeResourceType[];
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
}

@ObjectType()
class WorkspaceNativeTextType extends WorkspaceNativeResourceType {
  @Field() text!: string;
}

@ObjectType()
class WorkspaceNativeRevisionType {
  @Field(() => ID) id!: string;
  @Field(() => Int) sequence!: number;
  @Field(() => Date) createdAt!: Date;
  @Field(() => ID) actorId!: string;
  @Field(() => Int) byteSize!: number;
}

@InputType()
class WorkspaceNativeIdentityInput {
  @Field(() => ID) workspaceId!: string;
  @Field(() => ID) resourceId!: string;
  @Field() kind!: string;
}

@InputType()
class CreateWorkspaceNativeResourceInput {
  @Field(() => ID) workspaceId!: string;
  @Field() title!: string;
  @Field() requestKey!: string;
  @Field(() => ID, { nullable: true }) folderId?: string | null;
  @Field(() => String, { nullable: true }) blobKey?: string;
  @Field(() => GraphQLJSONObject, { nullable: true }) content?: object;
}

@InputType()
class SaveWorkspaceNativeFileInput extends WorkspaceNativeIdentityInput {
  @Field(() => Int) expectedContentVersion!: number;
  @Field() requestKey!: string;
  @Field(() => String, { nullable: true }) text?: string;
  @Field(() => String, { nullable: true }) blobKey?: string;
}

@InputType()
class ChangeWorkspaceNativeResourceInput extends WorkspaceNativeIdentityInput {
  @Field(() => Int) expectedVersion!: number;
  @Field() requestKey!: string;
  @Field() action!: string;
  @Field(() => String, { nullable: true }) title?: string;
  @Field(() => ID, { nullable: true }) folderId?: string | null;
  @Field(() => String, { nullable: true }) expectedDirectoryVersion?: string;
}

@InputType()
class RestoreWorkspaceNativeVersionInput extends WorkspaceNativeIdentityInput {
  @Field(() => Int) expectedContentVersion!: number;
  @Field(() => Int) sequence!: number;
  @Field() requestKey!: string;
}

@InputType()
class CopyWorkspaceNativeResourceInput extends WorkspaceNativeIdentityInput {
  @Field(() => Int) expectedContentVersion!: number;
  @Field() title!: string;
  @Field() requestKey!: string;
  @Field(() => ID, { nullable: true }) folderId?: string | null;
}

@Resolver()
export class WorkspaceNativeResourceResolver {
  constructor(private readonly resources: WorkspaceNativeResourceService) {}

  private identity(input: WorkspaceNativeIdentityInput, actorId: string) {
    return {
      ...input,
      actorId,
      kind: z.enum(['file', 'office']).parse(input.kind),
    };
  }

  @Query(() => WorkspaceNativePageType)
  workspaceNativeResources(
    @CurrentUser() user: User,
    @Args('workspaceId') workspaceId: string,
    @Args('cursor', { nullable: true }) cursor?: string,
    @Args('query', { nullable: true }) query?: string,
    @Args('trash', { nullable: true }) trash?: boolean,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ) {
    return this.resources.list({
      workspaceId,
      actorId: user.id,
      cursor,
      query,
      trash,
      limit,
    });
  }

  @Query(() => WorkspaceNativeResourceType)
  workspaceNativeResource(
    @CurrentUser() user: User,
    @Args('input') input: WorkspaceNativeIdentityInput,
    @Args('trash', { nullable: true }) trash?: boolean
  ) {
    return this.resources.get(this.identity(input, user.id), trash);
  }

  @Query(() => WorkspaceNativeTextType)
  workspaceNativeFileText(
    @CurrentUser() user: User,
    @Args('input') input: WorkspaceNativeIdentityInput,
    @Args('sequence', { type: () => Int, nullable: true }) sequence?: number
  ) {
    return this.resources.readText({
      ...this.identity(input, user.id),
      sequence,
    });
  }

  @Query(() => [WorkspaceNativeRevisionType])
  workspaceNativeRevisions(
    @CurrentUser() user: User,
    @Args('input') input: WorkspaceNativeIdentityInput,
    @Args('before', { type: () => Int, nullable: true }) before?: number,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number
  ) {
    return this.resources.history({
      ...this.identity(input, user.id),
      before,
      limit,
    });
  }

  @Mutation(() => WorkspaceNativeResourceType)
  @Throttle('strict')
  createWorkspaceNativeResource(
    @CurrentUser() user: User,
    @Args('input') input: CreateWorkspaceNativeResourceInput
  ) {
    return this.resources.create({
      ...input,
      actorId: user.id,
      content: input.content as Parameters<
        WorkspaceNativeResourceService['create']
      >[0]['content'],
    });
  }

  @Mutation(() => WorkspaceNativeResourceType)
  @Throttle('strict')
  saveWorkspaceNativeFile(
    @CurrentUser() user: User,
    @Args('input') input: SaveWorkspaceNativeFileInput
  ) {
    return this.resources.save({ ...input, ...this.identity(input, user.id) });
  }

  @Mutation(() => WorkspaceNativeResourceType)
  @Throttle('strict')
  changeWorkspaceNativeResource(
    @CurrentUser() user: User,
    @Args('input') input: ChangeWorkspaceNativeResourceInput
  ) {
    return this.resources.change({
      ...input,
      ...this.identity(input, user.id),
      action: z
        .enum(['rename', 'move', 'trash', 'restore', 'delete'])
        .parse(input.action),
    });
  }

  @Mutation(() => WorkspaceNativeResourceType)
  @Throttle('strict')
  restoreWorkspaceNativeVersion(
    @CurrentUser() user: User,
    @Args('input') input: RestoreWorkspaceNativeVersionInput
  ) {
    return this.resources.restoreVersion({
      ...input,
      ...this.identity(input, user.id),
    });
  }

  @Mutation(() => WorkspaceNativeResourceType)
  @Throttle('strict')
  copyWorkspaceNativeResource(
    @CurrentUser() user: User,
    @Args('input') input: CopyWorkspaceNativeResourceInput
  ) {
    return this.resources.copy({ ...input, ...this.identity(input, user.id) });
  }
}
