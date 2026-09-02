import {
  Args,
  Field,
  ID,
  InputType,
  Mutation,
  ObjectType,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { SafeIntResolver } from 'graphql-scalars';

import { Throttle } from '../../../base';
import { CurrentUser } from '../../../core/auth';
import { Admin } from '../../../core/common';
import { WorkspaceType } from '../../../core/workspaces';
import { ByokKeyConfig, ByokService } from './service';
import { ByokKeyStorage, ByokKeyTestStatus, ByokProvider } from './types';

@ObjectType()
export class WorkspaceByokKeyConfigType implements ByokKeyConfig {
  @Field(() => ID)
  id!: string;

  @Field(() => ByokProvider)
  provider!: ByokProvider;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description!: string | null;

  @Field(() => ByokKeyStorage)
  storage!: ByokKeyStorage;

  @Field(() => Boolean)
  configured!: boolean;

  @Field(() => Boolean)
  enabled!: boolean;

  @Field(() => String, { nullable: true })
  endpoint!: string | null;

  @Field(() => String, { nullable: true })
  modelId!: string | null;

  @Field(() => Boolean)
  endpointEditable!: boolean;

  @Field(() => SafeIntResolver)
  sortOrder!: number;

  @Field(() => [String])
  capabilities!: string[];

  @Field(() => ByokKeyTestStatus)
  testStatus!: ByokKeyTestStatus;

  @Field(() => String, { nullable: true })
  disabledReason!: string | null;

  @Field(() => Date, { nullable: true })
  lastTestedAt!: Date | null;

  @Field(() => String, { nullable: true })
  lastTestError!: string | null;

  @Field(() => Date, { nullable: true })
  lastUsedAt!: Date | null;

  @Field(() => Date, { nullable: true })
  lastErrorAt!: Date | null;

  @Field(() => String, { nullable: true })
  lastError!: string | null;
}

@ObjectType()
class WorkspaceByokCapabilityWarningType {
  @Field(() => String)
  featureKind!: string;

  @Field(() => String)
  reason!: string;

  @Field(() => [ByokProvider])
  requiredProviders!: ByokProvider[];
}

@ObjectType()
class WorkspaceByokSettingsType {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => Boolean)
  entitled!: boolean;

  @Field(() => Boolean)
  serverEntitled!: boolean;

  @Field(() => Boolean)
  localEntitled!: boolean;

  @Field(() => [String])
  entitlementRequired!: string[];

  @Field(() => [WorkspaceByokKeyConfigType])
  keys!: WorkspaceByokKeyConfigType[];

  @Field(() => [ByokProvider])
  allowedProviders!: ByokProvider[];

  @Field(() => Boolean)
  localStorageSupported!: boolean;

  @Field(() => Boolean)
  customEndpointSupported!: boolean;

  @Field(() => Boolean)
  privateEndpointSupported!: boolean;

  @Field(() => Boolean)
  hasAiPlan!: boolean;

  @Field(() => [WorkspaceByokCapabilityWarningType])
  warnings!: WorkspaceByokCapabilityWarningType[];
}

@ObjectType()
class WorkspaceByokUsagePointType {
  @Field(() => Date)
  date!: Date;

  @Field(() => String)
  featureKind!: string;

  @Field(() => SafeIntResolver)
  totalTokens!: number;
}

@ObjectType()
class TestWorkspaceByokConfigResultType {
  @Field(() => Boolean)
  ok!: boolean;

  @Field(() => ByokKeyTestStatus)
  status!: ByokKeyTestStatus;

  @Field(() => String, { nullable: true })
  message!: string | null;
}

@ObjectType()
class AdminWorkspaceByokScopeType {
  @Field(() => ID)
  id!: string;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => Boolean)
  enableAi!: boolean;

  @Field(() => SafeIntResolver)
  memberCount!: number;
}

@InputType()
class UpsertWorkspaceByokConfigInput {
  @Field(() => ID, { nullable: true })
  id?: string;

  @Field(() => String)
  workspaceId!: string;

  @Field(() => ByokProvider)
  provider!: ByokProvider;

  @Field(() => String)
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => ByokKeyStorage)
  storage!: ByokKeyStorage;

  @Field(() => String, { nullable: true })
  apiKey?: string | null;

  @Field(() => String, { nullable: true })
  endpoint?: string | null;

  @Field(() => String, { nullable: true })
  modelId?: string | null;

  @Field(() => SafeIntResolver, { nullable: true })
  sortOrder?: number | null;

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean | null;
}

@InputType()
class TestWorkspaceByokConfigInput {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => ByokProvider)
  provider!: ByokProvider;

  @Field(() => ByokKeyStorage)
  storage!: ByokKeyStorage;

  @Field(() => String, { nullable: true })
  apiKey?: string | null;

  @Field(() => String, { nullable: true })
  endpoint?: string | null;

  @Field(() => String, { nullable: true })
  modelId?: string | null;

  @Field(() => ID, { nullable: true })
  configId?: string | null;
}

@InputType()
class ReorderWorkspaceByokConfigsInput {
  @Field(() => String)
  workspaceId!: string;

  @Field(() => ByokKeyStorage)
  storage!: ByokKeyStorage;

  @Field(() => [ID])
  ids!: string[];
}

@Admin()
@Resolver(() => WorkspaceType)
export class WorkspaceByokResolver {
  constructor(private readonly byok: ByokService) {}

  @Query(() => [AdminWorkspaceByokScopeType])
  async adminWorkspaceByokScopes(
    @CurrentUser() user: CurrentUser,
    @Args('keyword', { type: () => String, nullable: true })
    keyword?: string | null,
    @Args('first', {
      type: () => SafeIntResolver,
      nullable: true,
      defaultValue: 100,
    })
    first?: number | null
  ) {
    return await this.byok.listAdminWorkspaceScopes({
      userId: user.id,
      keyword,
      first,
    });
  }

  @Query(() => WorkspaceByokSettingsType)
  async adminWorkspaceByokSettings(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId', { type: () => String }) workspaceId: string
  ) {
    return await this.byok.getAdminSettings(workspaceId, user.id);
  }

  @ResolveField(() => WorkspaceByokSettingsType, {
    name: 'byokSettings',
    complexity: 2,
  })
  async settings(
    @CurrentUser() user: CurrentUser,
    @Parent() workspace: WorkspaceType
  ) {
    return await this.byok.getAdminSettings(workspace.id, user.id);
  }

  @ResolveField(() => [WorkspaceByokUsagePointType], {
    name: 'byokUsage',
    complexity: 2,
  })
  async usage(
    @CurrentUser() user: CurrentUser,
    @Parent() workspace: WorkspaceType,
    @Args('from', { type: () => Date }) from: Date,
    @Args('to', { type: () => Date }) to: Date
  ) {
    return await this.byok.getAdminUsage(workspace.id, from, to, user.id);
  }

  @Throttle('strict')
  @Mutation(() => TestWorkspaceByokConfigResultType)
  async testWorkspaceByokConfig(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: TestWorkspaceByokConfigInput
  ) {
    return await this.byok.testAdminConfig({ ...input, userId: user.id });
  }

  @Mutation(() => WorkspaceByokKeyConfigType)
  @Throttle('strict')
  async upsertWorkspaceByokConfig(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: UpsertWorkspaceByokConfigInput
  ) {
    return await this.byok.upsertAdminConfig({ ...input, userId: user.id });
  }

  @Mutation(() => [WorkspaceByokKeyConfigType])
  @Throttle('strict')
  async reorderWorkspaceByokConfigs(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: ReorderWorkspaceByokConfigsInput
  ) {
    return await this.byok.reorderAdminConfigs({ ...input, userId: user.id });
  }

  @Mutation(() => Boolean)
  @Throttle('strict')
  async deleteWorkspaceByokConfig(
    @CurrentUser() user: CurrentUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('workspaceId', { type: () => String }) workspaceId: string
  ) {
    return await this.byok.deleteAdminConfig(workspaceId, id, user.id);
  }

  @Mutation(() => Boolean)
  @Throttle('strict')
  async clearWorkspaceByokConfigs(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId', { type: () => String }) workspaceId: string,
    @Args('provider', { type: () => ByokProvider, nullable: true })
    provider?: ByokProvider | null
  ) {
    return await this.byok.clearAdminConfigs(workspaceId, provider, user.id);
  }
}
