import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AiEnterpriseConnection,
  EnterpriseConnectionStatus,
  EnterpriseConnectionTransport,
  EnterpriseProvider,
} from '@prisma/client';

import { Config } from '../../../base';
import { type EnterpriseToolCatalogRecord, Models } from '../../../models';
import { EnterpriseCliRuntime, EnterpriseCliRuntimeError } from './cli/runtime';
import { EnterpriseCliDriverRegistry } from './driver-registry';
import type { EnterpriseToolResult } from './types';

const MAX_CATALOG_TOOLS = 2048;
const MAX_CATALOG_BYTES = 8 * 1024 * 1024;
const MAX_ENABLED_TOOLS = MAX_CATALOG_TOOLS;
const MAX_ARGUMENT_BYTES = 256 * 1024;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const COMMAND_SEGMENT_PATTERN = /^[+a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/;
const AUTHORIZATION_SHUTDOWN_GRACE_MS = 2_500;

@Injectable()
export class EnterpriseConnectionService {
  constructor(
    private readonly models: Models,
    private readonly drivers: EnterpriseCliDriverRegistry,
    private readonly runtime: EnterpriseCliRuntime,
    private readonly config: Config
  ) {}

  policy() {
    const enterpriseCli = this.config.copilot.enterpriseCli;
    return {
      enabled: enterpriseCli.enabled,
      allowedProviders: enterpriseCli.enabled
        ? [...new Set(enterpriseCli.allowedProviders)]
        : [],
    };
  }

  list(workspaceId: string, userId: string) {
    return this.models.copilotEnterpriseConnection.listForUser(
      workspaceId,
      userId
    );
  }

  async create(input: {
    workspaceId: string;
    userId: string;
    provider: EnterpriseProvider;
    name?: string;
  }) {
    this.assertProviderAllowed(input.provider);
    const name =
      input.name?.trim() || this.defaultConnectionName(input.provider);
    if (name.length > 128) {
      throw new BadRequestException(
        'Enterprise connection name must not exceed 128 characters'
      );
    }
    const connection = await this.models.copilotEnterpriseConnection.create({
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.provider,
      name,
      profileKey: randomUUID(),
    });
    await this.audit(connection, input.userId, 'created', 'CONNECTING');
    return connection;
  }

  async refresh(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
    authorizationSessionId?: string;
    signal?: AbortSignal;
  }) {
    const connection = await this.requireConnection(input);
    this.assertCliConnection(connection);
    this.assertProviderAllowed(connection.provider);
    if (
      input.authorizationSessionId &&
      connection.activeAuthorizationSessionId !== input.authorizationSessionId
    ) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_aborted',
        'Enterprise CLI authorization was superseded'
      );
    }
    if (
      !input.authorizationSessionId &&
      connection.activeAuthorizationSessionId
    ) {
      throw new BadRequestException(
        'Enterprise connection authorization is in progress'
      );
    }
    const driver = this.drivers.get(connection.provider);
    try {
      const auth = await driver.authStatus(connection.profileKey, input.signal);
      if (!auth.authorized) {
        if (!input.authorizationSessionId) {
          await this.models.copilotEnterpriseConnection.recordFailure(
            connection.id,
            EnterpriseConnectionStatus.REAUTH_REQUIRED,
            'enterprise_cli_reauth_required',
            'Enterprise CLI authorization is missing or expired'
          );
          await this.audit(
            connection,
            input.userId,
            'authorization_required',
            'REAUTH_REQUIRED'
          );
        }
        throw new BadRequestException(
          'Enterprise connection requires authorization'
        );
      }
      const discoveredCatalog = this.normalizeCatalog(
        await driver.discoverTools(connection.profileKey, input.signal)
      );
      const catalog = this.filterAllowedCatalog(
        connection.provider,
        discoveredCatalog
      );
      if (input.signal?.aborted) {
        throw new EnterpriseCliRuntimeError(
          'enterprise_cli_aborted',
          'Enterprise CLI execution was cancelled'
        );
      }
      const fingerprint = this.fingerprint(this.stableJson(catalog));
      const enabledToolNames = catalog.map(tool => tool.name);
      const updated = await this.models.copilotEnterpriseConnection.saveCatalog(
        {
          id: connection.id,
          authorizationSessionId: input.authorizationSessionId,
          catalog,
          fingerprint,
          enabledToolNames,
          externalTenantId: auth.externalTenantId,
          externalUserId: auth.externalUserId,
          identityType: auth.identityType,
          expiresAt: auth.expiresAt,
        }
      );
      await this.audit(
        updated,
        input.userId,
        'catalog_refreshed',
        updated.status,
        {
          discoveredToolCount: discoveredCatalog.length,
          toolCount: catalog.length,
          catalogFingerprint: fingerprint,
          enabledToolNames,
        }
      );
      return updated;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (input.signal?.aborted) throw error;
      if (input.authorizationSessionId) throw error;
      await this.models.copilotEnterpriseConnection.recordFailure(
        connection.id,
        EnterpriseConnectionStatus.DEGRADED,
        'enterprise_cli_refresh_failed',
        this.publicErrorMessage(error)
      );
      await this.audit(connection, input.userId, 'refresh_failed', 'DEGRADED', {
        error: this.publicErrorMessage(error),
      });
      throw error;
    }
  }

  async updateEnabledTools(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
    toolNames: string[];
  }) {
    const connection = await this.requireConnection(input);
    if (
      connection.status !== EnterpriseConnectionStatus.ACTIVE ||
      connection.activeAuthorizationSessionId
    ) {
      throw new BadRequestException('Enterprise connection is not active');
    }
    const catalog = this.catalog(connection);
    const available = new Set(catalog.map(tool => tool.name));
    const names = [...new Set(input.toolNames.map(name => name.trim()))].filter(
      Boolean
    );
    if (
      names.length > MAX_ENABLED_TOOLS ||
      names.some(name => !available.has(name))
    ) {
      throw new BadRequestException(
        'Enabled enterprise tools must exist in the current catalog'
      );
    }
    const updated =
      await this.models.copilotEnterpriseConnection.updateEnabledTools(
        connection.id,
        names
      );
    await this.audit(
      updated,
      input.userId,
      'tool_allowlist_updated',
      updated.status,
      { enabledToolNames: names }
    );
    return updated;
  }

  async execute(input: {
    connection: AiEnterpriseConnection;
    actorId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    confirmed: boolean;
    signal?: AbortSignal;
  }): Promise<EnterpriseToolResult> {
    const connection = await this.models.copilotEnterpriseConnection.get(
      input.connection.id,
      input.connection.workspaceId,
      input.connection.userId
    );
    if (!connection) {
      throw new BadRequestException('Enterprise connection is unavailable');
    }
    this.assertCliConnection(connection);
    this.assertProviderAllowed(connection.provider);
    this.assertToolAllowed(connection.provider, input.toolName);
    if (
      connection.status !== EnterpriseConnectionStatus.ACTIVE ||
      connection.activeAuthorizationSessionId ||
      !connection.enabledToolNames.includes(input.toolName)
    ) {
      throw new BadRequestException('Enterprise tool is not enabled');
    }
    const tool = this.catalog(connection).find(
      candidate => candidate.name === input.toolName
    );
    if (!tool) throw new BadRequestException('Enterprise tool is unavailable');
    if (tool.requiresConfirmation && !input.confirmed) {
      throw new BadRequestException(
        'Enterprise write tool requires explicit LocalMind confirmation'
      );
    }
    if (
      Buffer.byteLength(this.stableJson(input.arguments)) > MAX_ARGUMENT_BYTES
    ) {
      throw new BadRequestException(
        'Enterprise tool arguments exceeded the size limit'
      );
    }

    const idempotencyKey = randomUUID();
    const argumentsFingerprint = this.fingerprint(
      this.stableJson(input.arguments)
    );
    await this.audit(connection, input.actorId, 'tool_started', 'RUNNING', {
      toolName: tool.name,
      risk: tool.risk,
      idempotencyKey,
      argumentsFingerprint,
    });
    try {
      const result = await this.drivers
        .get(connection.provider)
        .execute(connection.profileKey, {
          tool,
          arguments: input.arguments,
          idempotencyKey,
          confirmed: input.confirmed,
          signal: input.signal,
        });
      await this.models.copilotEnterpriseConnection.recordSuccess(
        connection.id,
        true
      );
      await this.audit(
        connection,
        input.actorId,
        'tool_succeeded',
        'COMPLETED',
        {
          toolName: tool.name,
          risk: tool.risk,
          idempotencyKey,
          argumentsFingerprint,
          resultFingerprint: this.fingerprint(this.stableJson(result.data)),
          resourceCount: result.resources.length,
        }
      );
      return result;
    } catch (error) {
      const failure = await this.executionFailureState(
        connection.profileKey,
        this.drivers.get(connection.provider),
        error,
        input.signal
      );
      if (failure) {
        await this.models.copilotEnterpriseConnection.recordFailure(
          connection.id,
          failure.status,
          failure.code,
          this.publicErrorMessage(error)
        );
      }
      await this.audit(
        connection,
        input.actorId,
        'tool_failed',
        failure ? 'FAILED' : 'CANCELLED',
        {
          toolName: tool.name,
          risk: tool.risk,
          idempotencyKey,
          argumentsFingerprint,
          error: this.publicErrorMessage(error),
          ...(failure ? { connectionStatus: failure.status } : {}),
        }
      );
      throw error;
    }
  }

  private async executionFailureState(
    profileKey: string,
    driver: ReturnType<EnterpriseCliDriverRegistry['get']>,
    error: unknown,
    signal?: AbortSignal
  ): Promise<{
    status: EnterpriseConnectionStatus;
    code: string;
  } | null> {
    if (
      signal?.aborted ||
      (error instanceof EnterpriseCliRuntimeError &&
        error.code === 'enterprise_cli_aborted')
    ) {
      return null;
    }
    if (
      error instanceof EnterpriseCliRuntimeError &&
      error.code !== 'enterprise_cli_invalid_arguments'
    ) {
      return {
        status: EnterpriseConnectionStatus.DEGRADED,
        code: 'enterprise_cli_execution_failed',
      };
    }
    try {
      const auth = await driver.authStatus(profileKey, signal);
      if (signal?.aborted) return null;
      return auth.authorized
        ? {
            status: EnterpriseConnectionStatus.ACTIVE,
            code: 'enterprise_cli_tool_failed',
          }
        : {
            status: EnterpriseConnectionStatus.REAUTH_REQUIRED,
            code: 'enterprise_cli_reauth_required',
          };
    } catch {
      if (signal?.aborted) return null;
      return {
        status: EnterpriseConnectionStatus.DEGRADED,
        code: 'enterprise_cli_execution_failed',
      };
    }
  }

  activeConnections(workspaceId: string, userId: string) {
    return this.models.copilotEnterpriseConnection.listActiveForUser(
      workspaceId,
      userId
    );
  }

  async disable(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
  }) {
    const connection = await this.requireConnection(input);
    const updated = await this.models.copilotEnterpriseConnection.disable(
      connection.id
    );
    await this.audit(updated, input.userId, 'disabled', 'DISABLED');
    return updated;
  }

  async delete(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
  }) {
    const connection = await this.requireConnection(input);
    const activeAuthorization =
      await this.models.copilotEnterpriseAuthorization.active(connection.id);
    await this.models.copilotEnterpriseConnection.disable(connection.id);
    if (activeAuthorization) {
      await delay(AUTHORIZATION_SHUTDOWN_GRACE_MS);
    }
    try {
      await this.runtime.removeProfile(
        connection.provider,
        connection.profileKey
      );
    } catch (error) {
      await this.audit(
        connection,
        input.userId,
        'credential_cleanup_failed',
        'FAILED',
        { error: this.publicErrorMessage(error) }
      );
      throw error;
    }
    await this.audit(connection, input.userId, 'deleted', 'DISABLED');
    await this.models.copilotEnterpriseConnection.softDelete(connection.id);
    return true;
  }

  catalog(connection: AiEnterpriseConnection): EnterpriseToolCatalogRecord[] {
    if (!Array.isArray(connection.toolCatalog)) return [];
    const values: unknown[] = connection.toolCatalog;
    return this.filterAllowedCatalog(
      connection.provider,
      values.filter((tool): tool is EnterpriseToolCatalogRecord => {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
          return false;
        }
        const record = tool as Record<string, unknown>;
        return (
          typeof record.name === 'string' &&
          Array.isArray(record.command) &&
          record.command.every(item => typeof item === 'string') &&
          !!record.inputSchema &&
          typeof record.inputSchema === 'object' &&
          ['read', 'write', 'high'].includes(String(record.risk))
        );
      })
    );
  }

  async assertConnectionAllowed(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
  }) {
    const connection = await this.requireConnection(input);
    this.assertProviderAllowed(connection.provider);
    return connection;
  }

  private async requireConnection(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
  }) {
    const connection = await this.models.copilotEnterpriseConnection.get(
      input.connectionId,
      input.workspaceId,
      input.userId
    );
    if (!connection)
      throw new NotFoundException('Enterprise connection not found');
    return connection;
  }

  private assertCliConnection(connection: AiEnterpriseConnection) {
    if (connection.transport !== EnterpriseConnectionTransport.CLI) {
      throw new BadRequestException(
        'Enterprise connection is not configured for CLI transport'
      );
    }
  }

  private assertProviderAllowed(provider: EnterpriseProvider) {
    const policy = this.policy();
    if (!policy.enabled) {
      throw new BadRequestException(
        'Enterprise CLI integrations are disabled by the instance administrator'
      );
    }
    if (!policy.allowedProviders.includes(provider)) {
      throw new BadRequestException(
        'Enterprise CLI provider is not allowed by the instance administrator'
      );
    }
  }

  private assertToolAllowed(provider: EnterpriseProvider, toolName: string) {
    if (!this.isToolAllowed(provider, toolName)) {
      throw new BadRequestException(
        'Enterprise CLI tool is not allowed by the instance administrator'
      );
    }
  }

  private filterAllowedCatalog(
    provider: EnterpriseProvider,
    catalog: EnterpriseToolCatalogRecord[]
  ) {
    if (!this.policy().allowedProviders.includes(provider)) return [];
    return catalog.filter(tool => this.isToolAllowed(provider, tool.name));
  }

  private isToolAllowed(provider: EnterpriseProvider, toolName: string) {
    const allowed = this.allowedToolNames(provider);
    return allowed.includes('*') || allowed.includes(toolName);
  }

  private allowedToolNames(provider: EnterpriseProvider) {
    const policy = this.config.copilot.enterpriseCli.allowedToolsByProvider;
    switch (provider) {
      case EnterpriseProvider.WECOM:
        return policy.wecom;
      case EnterpriseProvider.LARK:
        return policy.lark;
      case EnterpriseProvider.DINGTALK:
        return policy.dingtalk;
    }
  }

  private normalizeCatalog(catalog: EnterpriseToolCatalogRecord[]) {
    const unique = new Map<string, EnterpriseToolCatalogRecord>();
    for (const tool of catalog) {
      if (unique.size >= MAX_CATALOG_TOOLS) break;
      if (
        !TOOL_NAME_PATTERN.test(tool.name) ||
        !tool.command.length ||
        tool.command.length > 8 ||
        tool.command.some(segment => !COMMAND_SEGMENT_PATTERN.test(segment)) ||
        unique.has(tool.name) ||
        !tool.inputSchema ||
        typeof tool.inputSchema !== 'object' ||
        Array.isArray(tool.inputSchema)
      ) {
        continue;
      }
      unique.set(tool.name, {
        ...tool,
        description: this.sanitizeDescription(tool.description),
      });
    }
    const normalized = [...unique.values()];
    if (Buffer.byteLength(this.stableJson(normalized)) > MAX_CATALOG_BYTES) {
      throw new BadRequestException(
        'Enterprise CLI tool catalog exceeded the size limit'
      );
    }
    return normalized;
  }

  private defaultConnectionName(provider: EnterpriseProvider) {
    switch (provider) {
      case EnterpriseProvider.WECOM:
        return 'WeCom';
      case EnterpriseProvider.LARK:
        return 'Lark';
      case EnterpriseProvider.DINGTALK:
        return 'DingTalk';
    }
  }

  private audit(
    connection: Pick<AiEnterpriseConnection, 'id' | 'workspaceId'>,
    actorId: string | null,
    eventType: string,
    status: string,
    metadata: Record<string, unknown> = {}
  ) {
    return this.models.copilotEnterpriseConnection.addAudit({
      connection,
      actorId,
      eventType,
      status,
      toolName:
        typeof metadata.toolName === 'string' ? metadata.toolName : undefined,
      risk: typeof metadata.risk === 'string' ? metadata.risk : undefined,
      idempotencyKey:
        typeof metadata.idempotencyKey === 'string'
          ? metadata.idempotencyKey
          : undefined,
      metadata,
    });
  }

  private fingerprint(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(item => this.stableJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableJson(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }

  private publicErrorMessage(error: unknown) {
    return error instanceof Error
      ? error.message.slice(0, 1000)
      : 'Enterprise CLI operation failed';
  }

  private sanitizeDescription(value: string | undefined) {
    if (!value) return undefined;
    return [...value]
      .map(character => (character.charCodeAt(0) < 32 ? ' ' : character))
      .join('')
      .slice(0, 2000);
  }
}
