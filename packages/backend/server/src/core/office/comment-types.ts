import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON, GraphQLJSONObject } from 'graphql-scalars';

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
export class OfficeCommentCreateInput {
  @Field(() => ID)
  workspaceId!: string;

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
