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

import { CurrentUser } from '../../../core/auth';
import { Admin } from '../../../core/common';
import { AiProfileService } from './profile-service';

@ObjectType()
class AdminAiProfileCredentialType {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  provider!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  modelId!: string | null;

  @Field(() => Boolean)
  enabled!: boolean;
}

@ObjectType()
class AdminAiProfileType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  workspaceId!: string;

  @Field(() => String, { nullable: true })
  workspaceName!: string | null;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => Boolean)
  isDefault!: boolean;

  @Field(() => [ID])
  credentialIds!: string[];

  @Field(() => [AdminAiProfileCredentialType])
  credentials!: AdminAiProfileCredentialType[];

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@ObjectType()
class AdminUserAiProfileAssignmentType {
  @Field(() => ID)
  userId!: string;

  @Field(() => ID)
  workspaceId!: string;

  @Field(() => AdminAiProfileType)
  profile!: AdminAiProfileType;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@InputType()
class UpsertAdminAiProfileInput {
  @Field(() => ID, { nullable: true })
  id?: string | null;

  @Field(() => ID)
  workspaceId!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => Boolean)
  isDefault!: boolean;

  @Field(() => [ID])
  credentialIds!: string[];
}

@Admin()
@Resolver()
export class AiProfileResolver {
  constructor(private readonly profiles: AiProfileService) {}

  @Query(() => [AdminAiProfileType])
  async adminAiProfiles(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId', { type: () => ID, nullable: true })
    workspaceId?: string | null
  ) {
    return await this.profiles.listAdminProfiles({
      userId: user.id,
      workspaceId,
    });
  }

  @Query(() => AdminUserAiProfileAssignmentType, { nullable: true })
  async adminUserAiProfileAssignment(
    @CurrentUser() user: CurrentUser,
    @Args('userId', { type: () => ID }) userId: string
  ) {
    return await this.profiles.getAdminUserAssignment(userId, user.id);
  }

  @Mutation(() => AdminAiProfileType)
  async upsertAdminAiProfile(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: UpsertAdminAiProfileInput
  ) {
    return await this.profiles.upsertAdminProfile({
      ...input,
      userId: user.id,
    });
  }

  @Mutation(() => Boolean)
  async deleteAdminAiProfile(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId', { type: () => ID }) workspaceId: string,
    @Args('id', { type: () => ID }) id: string
  ) {
    return await this.profiles.deleteAdminProfile({
      id,
      workspaceId,
      userId: user.id,
    });
  }

  @Mutation(() => AdminUserAiProfileAssignmentType, { nullable: true })
  async setAdminUserAiProfileAssignment(
    @CurrentUser() user: CurrentUser,
    @Args('userId', { type: () => ID }) userId: string,
    @Args('profileId', { type: () => ID, nullable: true })
    profileId?: string | null
  ) {
    return await this.profiles.setAdminUserAssignment({
      userId,
      profileId,
      actorId: user.id,
    });
  }
}
