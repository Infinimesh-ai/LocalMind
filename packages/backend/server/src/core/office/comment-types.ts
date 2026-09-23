import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON, GraphQLJSONObject } from 'graphql-scalars';

import { BadRequest } from '../../base';
import type { OfficeOwner } from '../../models/office-owner';
import { PublicUserType } from '../user';

@ObjectType()
export class OfficeCommentReplyType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  commentId!: string;

  @Field(() => GraphQLJSONObject)
  content!: Record<string, unknown>;

  @Field(() => PublicUserType)
  user!: PublicUserType;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@ObjectType()
export class OfficeCommentType {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLJSONObject)
  content!: Record<string, unknown>;

  @Field()
  resolved!: boolean;

  @Field(() => PublicUserType)
  user!: PublicUserType;

  @Field(() => [OfficeCommentReplyType])
  replies!: OfficeCommentReplyType[];

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@InputType()
export class OfficeCommentOwnerInput {
  @Field(() => ID, { nullable: true })
  workspaceId?: string;

  @Field(() => ID, { nullable: true })
  projectId?: string;
}

export function resolveOfficeCommentOwner(
  workspaceId?: string | null,
  owner?: OfficeCommentOwnerInput | null
): OfficeOwner {
  if (workspaceId != null && owner != null)
    throw new BadRequest('Supply exactly one Office comment owner');
  const scope: OfficeCommentOwnerInput = owner ?? {
    workspaceId: workspaceId ?? undefined,
  };
  const hasWorkspace = scope.workspaceId != null;
  const hasProject = scope.projectId != null;
  if (hasWorkspace === hasProject)
    throw new BadRequest('Office comments require exactly one owner');
  const id = scope.projectId ?? scope.workspaceId;
  if (typeof id !== 'string' || !id.trim() || id.length > 512)
    throw new BadRequest('Invalid Office comment owner');
  return hasProject ? { projectId: id } : id;
}

@InputType()
export class OfficeCommentCreateInput {
  @Field(() => ID, {
    nullable: true,
    deprecationReason: 'Use owner.workspaceId',
  })
  workspaceId?: string;

  @Field(() => OfficeCommentOwnerInput, { nullable: true })
  owner?: OfficeCommentOwnerInput;

  @Field(() => ID)
  artifactId!: string;

  @Field(() => GraphQLJSON)
  content!: unknown;
}

@InputType()
export class OfficeCommentUpdateInput {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLJSON)
  content!: unknown;
}

@InputType()
export class OfficeCommentResolveInput {
  @Field(() => ID)
  id!: string;

  @Field()
  resolved!: boolean;
}

@InputType()
export class OfficeCommentReplyCreateInput {
  @Field(() => ID)
  commentId!: string;

  @Field(() => GraphQLJSON)
  content!: unknown;
}

@InputType()
export class OfficeCommentReplyUpdateInput {
  @Field(() => ID)
  id!: string;

  @Field(() => GraphQLJSON)
  content!: unknown;
}
