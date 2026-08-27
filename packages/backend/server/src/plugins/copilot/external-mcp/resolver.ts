import { BadRequestException } from '@nestjs/common';
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
  type AiExternalMcpConnection,
  ExternalMcpConnectionStatus,
} from '@prisma/client';
import { GraphQLJSON } from 'graphql-scalars';

import { Throttle } from '../../../base';
import { CurrentUser } from '../../../core/auth';
import { PermissionAccess } from '../../../core/permission';
import { ExternalMcpConnectionService } from './service';

registerEnumType(ExternalMcpConnectionStatus, {
  name: 'ExternalMcpConnectionStatus',
});

@ObjectType()
class ExternalMcpToolType {
  @Field()
  name!: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => GraphQLJSON)
  inputSchema!: Record<string, unknown>;

  @Field()
  enabled!: boolean;

  @Field()
  risk!: string;

  @Field()
  requiresExplicitUserRequest!: boolean;
}

@ObjectType()
class ExternalMcpConnectionType {
  @Field(() => ID)
  id!: string;

  @Field()
  workspaceId!: string;

  @Field()
  name!: string;

  @Field()
  endpoint!: string;

  @Field()
  protocolVersion!: string;

  @Field(() => ExternalMcpConnectionStatus)
  status!: ExternalMcpConnectionStatus;

  @Field(() => String, { nullable: true })
  sessionFingerprint!: string | null;

  @Field(() => String, { nullable: true })
  serverName!: string | null;

  @Field(() => String, { nullable: true })
  serverVersion!: string | null;

  @Field(() => String, { nullable: true })
  toolCatalogFingerprint!: string | null;

  @Field(() => [ExternalMcpToolType])
  tools!: ExternalMcpToolType[];

  @Field(() => [String])
  enabledToolNames!: string[];

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
class ExternalMcpSettingsType {
  @Field()
  endpoint!: string;

  @Field()
  protocolVersion!: string;

  @Field(() => ExternalMcpConnectionType, { nullable: true })
  connection!: ExternalMcpConnectionType | null;
}

@ObjectType()
class ExternalMcpToolCallResultType {
  @Field()
  toolName!: string;

  @Field(() => GraphQLJSON)
  result!: unknown;
}

@InputType()
class ConnectExternalMcpInput {
  @Field()
  workspaceId!: string;

  @Field({ defaultValue: 'SparkClaw MCP' })
  name!: string;

  @Field()
  accessTicket!: string;
}

@Resolver()
export class ExternalMcpConnectionResolver {
  constructor(
    private readonly connections: ExternalMcpConnectionService,
    private readonly ac: PermissionAccess
  ) {}

  @Query(() => ExternalMcpSettingsType)
  async externalMcpSettings(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string
  ) {
    await this.ac
      .user(user.id)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Read');
    const connection = await this.connections.get(workspaceId);
    return {
      endpoint: this.connections.endpoint,
      protocolVersion: '2025-06-18',
      connection: connection ? this.project(connection) : null,
    };
  }

  @Mutation(() => ExternalMcpConnectionType)
  @Throttle('strict')
  async connectExternalMcp(
    @CurrentUser() user: CurrentUser,
    @Args('input') input: ConnectExternalMcpInput
  ) {
    await this.assertUpdate(user.id, input.workspaceId);
    return this.project(
      await this.connections.connect({
        workspaceId: input.workspaceId,
        actorId: user.id,
        name: input.name,
        ticket: input.accessTicket,
      })
    );
  }

  @Mutation(() => ExternalMcpConnectionType)
  @Throttle('strict')
  async refreshExternalMcpTools(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string
  ) {
    await this.assertUpdate(user.id, workspaceId);
    const connection = await this.requireConnection(workspaceId);
    return this.project(await this.connections.refresh(connection, user.id));
  }

  @Mutation(() => ExternalMcpConnectionType)
  @Throttle('strict')
  async updateExternalMcpToolAllowlist(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('enabledToolNames', { type: () => [String] })
    enabledToolNames: string[]
  ) {
    await this.assertUpdate(user.id, workspaceId);
    const connection = await this.requireConnection(workspaceId);
    return this.project(
      await this.connections.updateEnabledTools(
        connection,
        user.id,
        enabledToolNames
      )
    );
  }

  @Mutation(() => ExternalMcpToolCallResultType)
  @Throttle('strict')
  async testExternalMcpConversation(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string,
    @Args('query') query: string
  ) {
    await this.assertUpdate(user.id, workspaceId);
    const connection = await this.requireConnection(workspaceId);
    return await this.connections.testConversation(connection, user.id, query);
  }

  @Mutation(() => ExternalMcpConnectionType)
  @Throttle('strict')
  async disableExternalMcp(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string
  ) {
    await this.assertUpdate(user.id, workspaceId);
    const connection = await this.requireConnection(workspaceId);
    return this.project(await this.connections.disable(connection, user.id));
  }

  @Mutation(() => Boolean)
  @Throttle('strict')
  async deleteExternalMcp(
    @CurrentUser() user: CurrentUser,
    @Args('workspaceId') workspaceId: string
  ) {
    await this.assertUpdate(user.id, workspaceId);
    const connection = await this.requireConnection(workspaceId);
    return await this.connections.delete(connection, user.id);
  }

  private async requireConnection(workspaceId: string) {
    const connection = await this.connections.get(workspaceId);
    if (!connection) {
      throw new BadRequestException('SparkClaw MCP connection not found');
    }
    return connection;
  }

  private assertUpdate(userId: string, workspaceId: string) {
    return this.ac
      .user(userId)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
  }

  private project(connection: AiExternalMcpConnection) {
    const enabled = new Set(connection.enabledToolNames);
    return {
      ...connection,
      endpoint: this.connections.endpoint,
      protocolVersion: '2025-06-18',
      tools: this.connections
        .businessCatalog(this.connections.catalog(connection))
        .map(tool => ({
          ...tool,
          enabled: enabled.has(tool.name),
        })),
    };
  }
}
