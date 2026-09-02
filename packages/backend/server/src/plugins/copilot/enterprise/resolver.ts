import { ForbiddenException } from '@nestjs/common';
import {
  Args,
  Field,
  ID,
  InputType,
  Mutation,
  ObjectType,
  Query,
  registerEnumType,
  Resolver,
} from '@nestjs/graphql';
import {
  type AiEnterpriseAuthorizationSession,
  type AiEnterpriseConnection,
  EnterpriseAuthorizationStatus,
  EnterpriseConnectionStatus,
  EnterpriseConnectionTransport,
  EnterpriseProvider,
} from '@prisma/client';
import { GraphQLJSON } from 'graphql-scalars';

import { Throttle } from '../../../base';
import { CurrentUser } from '../../../core/auth';
import { PermissionAccess } from '../../../core/permission';
import type { EnterpriseToolCatalogRecord } from '../../../models';
import { EnterpriseAuthorizationService } from './authorization-service';
import { EnterpriseConnectionService } from './service';

registerEnumType(EnterpriseProvider, { name: 'EnterpriseProvider' });
registerEnumType(EnterpriseConnectionTransport, {
  name: 'EnterpriseConnectionTransport',
});
registerEnumType(EnterpriseConnectionStatus, {
  name: 'EnterpriseConnectionStatus',
});
registerEnumType(EnterpriseAuthorizationStatus, {
  name: 'EnterpriseAuthorizationStatus',
});

@ObjectType()
class EnterpriseAuthorizationSessionType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  connectionId!: string;

  @Field()
  workspaceId!: string;

  @Field(() => EnterpriseProvider)
  provider!: EnterpriseProvider;

  @Field(() => EnterpriseAuthorizationStatus)
  status!: EnterpriseAuthorizationStatus;

  @Field(() => String, { nullable: true })
  authorizationUrl!: string | null;

  @Field(() => String, { nullable: true })
  userCode!: string | null;

  @Field(() => String, { nullable: true })
  qrCodeUrl!: string | null;

  @Field(() => Date)
  expiresAt!: Date;

  @Field(() => Date, { nullable: true })
  startedAt!: Date | null;

  @Field(() => Date, { nullable: true })
  completedAt!: Date | null;

  @Field(() => String, { nullable: true })
  lastErrorCode!: string | null;

  @Field(() => String, { nullable: true })
  lastErrorMessage!: string | null;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@ObjectType()
class EnterpriseToolType {
  @Field()
  name!: string;

  @Field()
  description!: string;

  @Field(() => GraphQLJSON)
  inputSchema!: Record<string, unknown>;

  @Field()
  risk!: string;

  @Field()
  requiresConfirmation!: boolean;

  @Field()
  supportsDryRun!: boolean;

  @Field()
  enabled!: boolean;
}

@ObjectType()
class EnterpriseConnectionType {
  @Field(() => ID)
  id!: string;

  @Field()
  workspaceId!: string;

  @Field(() => EnterpriseProvider)
  provider!: EnterpriseProvider;

  @Field(() => EnterpriseConnectionTransport)
  transport!: EnterpriseConnectionTransport;

  @Field()
  name!: string;

  @Field(() => EnterpriseConnectionStatus)
  status!: EnterpriseConnectionStatus;

  @Field(() => String, { nullable: true })
  externalTenantId!: string | null;

  @Field(() => String, { nullable: true })
  externalUserId!: string | null;

  @Field(() => String, { nullable: true })
  identityType!: string | null;

  @Field(() => [EnterpriseToolType])
  tools!: EnterpriseToolType[];

  @Field(() => [String])
  enabledToolNames!: string[];

  @Field(() => Date, { nullable: true })
  expiresAt!: Date | null;

  @Field(() => Date, { nullable: true })
  lastConnectedAt!: Date | null;

  @Field(() => Date, { nullable: true })
  lastCheckedAt!: Date | null;

  @Field(() => Date, { nullable: true })
  lastUsedAt!: Date | null;

  @Field(() => String, { nullable: true })
  lastErrorCode!: string | null;

  @Field(() => String, { nullable: true })
  lastErrorMessage!: string | null;

  @Field(() => Date)
  createdAt!: Date;

  @Field(() => Date)
  updatedAt!: Date;
}

@ObjectType()
class EnterpriseConnectionPolicyType {
  @Field()
  enabled!: boolean;

  @Field(() => [EnterpriseProvider])
  allowedProviders!: EnterpriseProvider[];
}

@InputType()
class CreateEnterpriseConnectionInput {
  @Field()
  workspaceId!: string;

  @Field(() => EnterpriseProvider)
  provider!: EnterpriseProvider;

  @Field({ nullable: true })
  name?: string;
}

@Resolver()
export class EnterpriseConnectionResolver {
  constructor(
    private readonly connections: EnterpriseConnectionService,
    private readonly authorizations: EnterpriseAuthorizationService,
    private readonly ac: PermissionAccess
  ) {}

  @Query(() => EnterpriseAuthorizationSessionType)
  async enterpriseAuthorizationSession(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    return this.projectAuthorization(
      await this.authorizations.get({
        id: sessionId,
        workspaceId,
        userId: user.id,
      })
    );
  }

  @Query(() => EnterpriseAuthorizationSessionType, { nullable: true })
  async latestEnterpriseAuthorizationSession(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('connectionId', { type: () => ID }) connectionId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    const session = await this.authorizations.latest({
      connectionId,
      workspaceId,
      userId: user.id,
    });
    return session ? this.projectAuthorization(session) : null;
  }

  @Query(() => [EnterpriseConnectionType])
  async enterpriseConnections(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    const connections = await this.connections.list(workspaceId, user.id);
    return connections.map(connection => this.project(connection));
  }

  @Query(() => EnterpriseConnectionPolicyType)
  async enterpriseConnectionPolicy(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    return this.connections.policy();
  }

  @Mutation(() => EnterpriseConnectionType)
  @Throttle('strict')
  async createEnterpriseConnection(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: CreateEnterpriseConnectionInput
  ) {
    await this.assertMember(user.id, input.workspaceId);
    return this.project(
      await this.connections.create({
        workspaceId: input.workspaceId,
        userId: user.id,
        provider: input.provider,
        name: input.name,
      })
    );
  }

  @Mutation(() => EnterpriseAuthorizationSessionType)
  @Throttle('strict')
  async beginEnterpriseAuthorization(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('connectionId', { type: () => ID }) connectionId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    await this.connections.assertConnectionAllowed({
      connectionId,
      workspaceId,
      userId: user.id,
    });
    return this.projectAuthorization(
      await this.authorizations.begin({
        connectionId,
        workspaceId,
        userId: user.id,
      })
    );
  }

  @Mutation(() => EnterpriseAuthorizationSessionType)
  @Throttle('strict')
  async cancelEnterpriseAuthorization(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('sessionId', { type: () => ID }) sessionId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    return this.projectAuthorization(
      await this.authorizations.cancel({
        id: sessionId,
        workspaceId,
        userId: user.id,
      })
    );
  }

  @Mutation(() => EnterpriseConnectionType)
  @Throttle('strict')
  async refreshEnterpriseConnection(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('connectionId') connectionId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    return this.project(
      await this.connections.refresh({
        connectionId,
        workspaceId,
        userId: user.id,
      })
    );
  }

  @Mutation(() => EnterpriseConnectionType)
  @Throttle('strict')
  async updateEnterpriseToolAllowlist(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('connectionId') connectionId: string,
    @Args('enabledToolNames', { type: () => [String] })
    enabledToolNames: string[]
  ) {
    await this.assertMember(user.id, workspaceId);
    void connectionId;
    void enabledToolNames;
    throw new ForbiddenException(
      'Enterprise tool availability is managed by the instance administrator'
    );
  }

  @Mutation(() => EnterpriseConnectionType)
  @Throttle('strict')
  async disableEnterpriseConnection(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('connectionId') connectionId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    return this.project(
      await this.connections.disable({
        connectionId,
        workspaceId,
        userId: user.id,
      })
    );
  }

  @Mutation(() => Boolean)
  @Throttle('strict')
  async deleteEnterpriseConnection(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('connectionId') connectionId: string
  ) {
    await this.assertMember(user.id, workspaceId);
    return await this.connections.delete({
      connectionId,
      workspaceId,
      userId: user.id,
    });
  }

  private assertMember(userId: string, workspaceId: string) {
    return this.ac
      .user(userId)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Read');
  }

  private project(connection: AiEnterpriseConnection) {
    const catalog = this.connections.catalog(connection);
    const enabledToolNames = catalog
      .filter(tool => connection.enabledToolNames.includes(tool.name))
      .map(tool => tool.name);
    const enabled = new Set(enabledToolNames);
    return {
      ...connection,
      enabledToolNames,
      tools: catalog.map((tool: EnterpriseToolCatalogRecord) => ({
        ...tool,
        description: tool.description ?? tool.command.join(' '),
        enabled: enabled.has(tool.name),
      })),
    };
  }

  private projectAuthorization(session: AiEnterpriseAuthorizationSession) {
    return {
      ...session,
      qrCodeUrl:
        session.status === EnterpriseAuthorizationStatus.WAITING &&
        session.qrCodePath
          ? `/api/copilot/enterprise/authorization/${encodeURIComponent(session.id)}/qrcode`
          : null,
    };
  }
}
