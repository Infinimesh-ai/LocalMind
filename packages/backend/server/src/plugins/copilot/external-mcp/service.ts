import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type AiExternalMcpConnection,
  ExternalMcpConnectionStatus,
} from '@prisma/client';

import { Config, CryptoHelper } from '../../../base';
import { Models } from '../../../models';
import { type ExternalMcpToolRecord } from '../../../models/copilot-external-mcp';
import { ExternalMcpTransport, ExternalMcpTransportError } from './transport';

const PROTOCOL_VERSION = '2025-06-18';
const CONVERSATION_TOOL = 'sparkclaw.route.conversation.answer';
const MAX_TOOLS = 128;
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_TEST_RESULT_BYTES = 128 * 1024;

@Injectable()
export class ExternalMcpConnectionService {
  constructor(
    private readonly config: Config,
    private readonly crypto: CryptoHelper,
    private readonly models: Models,
    private readonly transport: ExternalMcpTransport
  ) {}

  get endpoint() {
    return this.config.copilot.externalMcp.endpoint;
  }

  async get(workspaceId: string) {
    return await this.models.copilotExternalMcp.getByWorkspace(workspaceId);
  }

  async connect(input: {
    workspaceId: string;
    actorId: string;
    name: string;
    ticket: string;
  }) {
    const name = input.name.trim();
    const ticket = input.ticket.trim();
    if (!name || name.length > 128) {
      throw new BadRequestException('Connection name is required');
    }
    if (!ticket || ticket.length > 4096) {
      throw new BadRequestException(
        'A valid one-time access ticket is required'
      );
    }

    let initialized: Awaited<ReturnType<ExternalMcpTransport['initialize']>>;
    try {
      initialized = await this.transport.initialize({
        endpoint: this.endpoint,
        ticket,
        protocolVersion: PROTOCOL_VERSION,
      });
    } catch (error) {
      throw this.publicError(error);
    }

    const encryptedSessionId = this.crypto.encrypt(initialized.sessionId);
    const sessionFingerprint = this.fingerprint(initialized.sessionId).slice(
      0,
      12
    );
    const connection = await this.models.copilotExternalMcp.saveInitialized({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      name,
      endpoint: this.endpoint,
      protocolVersion: initialized.protocolVersion,
      encryptedSessionId,
      sessionFingerprint,
      serverName: initialized.serverInfo.name,
      serverVersion: initialized.serverInfo.version,
    });
    await this.audit(connection, input.actorId, 'initialized', 'CONNECTING', {
      endpoint: this.endpoint,
      protocolVersion: connection.protocolVersion,
      serverName: connection.serverName,
      serverVersion: connection.serverVersion,
      sessionFingerprint,
    });

    try {
      let sessionId = await this.transport.initialized({
        endpoint: this.endpoint,
        sessionId: initialized.sessionId,
        protocolVersion: PROTOCOL_VERSION,
      });
      await this.updateSessionIfChanged(
        connection,
        initialized.sessionId,
        sessionId,
        input.actorId
      );
      const listed = await this.transport.listTools({
        endpoint: this.endpoint,
        sessionId,
        protocolVersion: PROTOCOL_VERSION,
      });
      await this.updateSessionIfChanged(
        connection,
        sessionId,
        listed.sessionId,
        input.actorId
      );
      sessionId = listed.sessionId;
      const catalog = this.normalizeCatalog(listed.tools);
      const enabledToolNames = catalog.some(
        tool => tool.name === CONVERSATION_TOOL
      )
        ? [CONVERSATION_TOOL]
        : [];
      const active = await this.models.copilotExternalMcp.saveCatalog({
        id: connection.id,
        toolCatalog: catalog,
        toolCatalogFingerprint: this.fingerprint(this.stableJson(catalog)),
        enabledToolNames,
      });
      await this.audit(active, input.actorId, 'connected', 'ACTIVE', {
        toolCount: catalog.length,
        toolCatalogFingerprint: active.toolCatalogFingerprint,
        enabledToolNames,
      });
      return active;
    } catch (error) {
      await this.recordFailure(
        connection,
        input.actorId,
        error,
        'connect_failed'
      );
      throw this.publicError(error);
    }
  }

  async refresh(connection: AiExternalMcpConnection, actorId: string) {
    this.assertUsable(connection);
    try {
      const sessionId = this.decryptSession(connection);
      const listed = await this.transport.listTools({
        endpoint: this.endpoint,
        sessionId,
        protocolVersion: PROTOCOL_VERSION,
      });
      await this.updateSessionIfChanged(
        connection,
        sessionId,
        listed.sessionId,
        actorId
      );
      const catalog = this.normalizeCatalog(listed.tools);
      const known = new Set(catalog.map(tool => tool.name));
      const enabledToolNames = connection.enabledToolNames.filter(name =>
        known.has(name)
      );
      const updated = await this.models.copilotExternalMcp.saveCatalog({
        id: connection.id,
        toolCatalog: catalog,
        toolCatalogFingerprint: this.fingerprint(this.stableJson(catalog)),
        enabledToolNames,
      });
      await this.audit(updated, actorId, 'tools_refreshed', 'ACTIVE', {
        toolCount: catalog.length,
        toolCatalogFingerprint: updated.toolCatalogFingerprint,
        enabledToolNames,
      });
      return updated;
    } catch (error) {
      await this.recordFailure(connection, actorId, error, 'refresh_failed');
      throw this.publicError(error);
    }
  }

  async updateEnabledTools(
    connection: AiExternalMcpConnection,
    actorId: string,
    names: string[]
  ) {
    this.assertUsable(connection);
    const available = new Set(this.catalog(connection).map(tool => tool.name));
    const enabled = [
      ...new Set(names.map(name => name.trim()).filter(Boolean)),
    ];
    if (
      enabled.length > MAX_TOOLS ||
      enabled.some(name => !available.has(name))
    ) {
      throw new BadRequestException(
        'Enabled tools must exist in the current catalog'
      );
    }
    const updated = await this.models.copilotExternalMcp.updateEnabledTools(
      connection.id,
      enabled
    );
    await this.audit(
      updated,
      actorId,
      'tool_allowlist_updated',
      updated.status,
      {
        enabledToolNames: enabled,
      }
    );
    return updated;
  }

  async testConversation(
    connection: AiExternalMcpConnection,
    actorId: string,
    query: string
  ) {
    this.assertUsable(connection);
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > 2000) {
      throw new BadRequestException(
        'Test query must contain 1 to 2000 characters'
      );
    }
    if (!connection.enabledToolNames.includes(CONVERSATION_TOOL)) {
      throw new BadRequestException(
        'The SparkClaw conversation tool is disabled'
      );
    }
    const idempotencyKey = randomUUID();
    try {
      const sessionId = this.decryptSession(connection);
      const called = await this.transport.callTool({
        endpoint: this.endpoint,
        sessionId,
        protocolVersion: PROTOCOL_VERSION,
        name: CONVERSATION_TOOL,
        arguments: { query: normalizedQuery },
        idempotencyKey,
      });
      await this.updateSessionIfChanged(
        connection,
        sessionId,
        called.sessionId,
        actorId
      );
      const result = this.boundJson(called.result, MAX_TEST_RESULT_BYTES);
      const updated = await this.models.copilotExternalMcp.recordSuccess(
        connection.id,
        true
      );
      await this.audit(updated, actorId, 'test_call_succeeded', 'ACTIVE', {
        toolName: CONVERSATION_TOOL,
        queryFingerprint: this.fingerprint(normalizedQuery),
        resultFingerprint: this.fingerprint(this.stableJson(result)),
        idempotencyKey,
      });
      return { toolName: CONVERSATION_TOOL, result };
    } catch (error) {
      await this.recordFailure(connection, actorId, error, 'test_call_failed', {
        toolName: CONVERSATION_TOOL,
        queryFingerprint: this.fingerprint(normalizedQuery),
        idempotencyKey,
      });
      throw this.publicError(error);
    }
  }

  async disable(connection: AiExternalMcpConnection, actorId: string) {
    const updated = await this.models.copilotExternalMcp.disable(connection.id);
    await this.audit(updated, actorId, 'disabled', 'DISABLED');
    return updated;
  }

  async delete(connection: AiExternalMcpConnection, actorId: string) {
    await this.audit(connection, actorId, 'deleted', 'DISABLED', {
      sessionFingerprint: connection.sessionFingerprint,
    });
    await this.models.copilotExternalMcp.softDelete(connection.id);
    return true;
  }

  catalog(connection: AiExternalMcpConnection): ExternalMcpToolRecord[] {
    if (!Array.isArray(connection.toolCatalog)) return [];
    const tools = connection.toolCatalog as unknown[];
    return tools.filter(
      (tool): tool is ExternalMcpToolRecord =>
        Boolean(tool) &&
        typeof tool === 'object' &&
        !Array.isArray(tool) &&
        typeof (tool as { name?: unknown }).name === 'string'
    );
  }

  private assertUsable(connection: AiExternalMcpConnection) {
    if (
      connection.status === ExternalMcpConnectionStatus.DISABLED ||
      connection.deletedAt
    ) {
      throw new BadRequestException('SparkClaw MCP connection is disabled');
    }
    if (
      connection.status === ExternalMcpConnectionStatus.REAUTH_REQUIRED ||
      !connection.encryptedSessionId
    ) {
      throw new BadRequestException(
        'SparkClaw MCP connection requires reauthentication'
      );
    }
  }

  private decryptSession(connection: AiExternalMcpConnection) {
    if (!connection.encryptedSessionId) {
      throw new BadRequestException(
        'SparkClaw MCP connection requires reauthentication'
      );
    }
    try {
      return this.crypto.decrypt(connection.encryptedSessionId);
    } catch {
      throw new ExternalMcpTransportError(
        'mcp_session_decrypt_failed',
        'SparkClaw MCP session cannot be decrypted'
      );
    }
  }

  private normalizeCatalog(rawTools: unknown[]) {
    if (rawTools.length > MAX_TOOLS) {
      throw new ExternalMcpTransportError(
        'mcp_tool_catalog_too_large',
        'SparkClaw returned too many MCP tools'
      );
    }
    const names = new Set<string>();
    const tools: ExternalMcpToolRecord[] = rawTools.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ExternalMcpTransportError(
          'mcp_invalid_tool_catalog',
          'SparkClaw returned an invalid tool catalog'
        );
      }
      const tool = raw as Record<string, unknown>;
      const name = typeof tool.name === 'string' ? tool.name.trim() : '';
      if (!name || name.length > 256 || names.has(name)) {
        throw new ExternalMcpTransportError(
          'mcp_invalid_tool_catalog',
          'SparkClaw returned an invalid tool catalog'
        );
      }
      names.add(name);
      const inputSchema = this.boundJson(tool.inputSchema ?? {}, 32 * 1024);
      if (
        !inputSchema ||
        typeof inputSchema !== 'object' ||
        Array.isArray(inputSchema)
      ) {
        throw new ExternalMcpTransportError(
          'mcp_invalid_tool_catalog',
          'SparkClaw returned an invalid tool schema'
        );
      }
      return {
        name,
        ...(typeof tool.title === 'string' && tool.title.trim()
          ? { title: tool.title.trim().slice(0, 256) }
          : {}),
        ...(typeof tool.description === 'string' && tool.description.trim()
          ? { description: tool.description.trim().slice(0, 2000) }
          : {}),
        inputSchema: inputSchema as Record<string, unknown>,
      };
    });
    this.boundJson(tools, MAX_CATALOG_BYTES);
    return tools.sort((left, right) => left.name.localeCompare(right.name));
  }

  private boundJson(value: unknown, maxBytes: number): unknown {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized) > maxBytes) {
      throw new ExternalMcpTransportError(
        'mcp_response_too_large',
        'SparkClaw MCP response exceeded the size limit'
      );
    }
    return JSON.parse(serialized) as unknown;
  }

  private async recordFailure(
    connection: AiExternalMcpConnection,
    actorId: string,
    error: unknown,
    eventType: string,
    metadata: Record<string, unknown> = {}
  ) {
    const normalized = this.normalizeError(error);
    const status = normalized.reauthenticate
      ? ExternalMcpConnectionStatus.REAUTH_REQUIRED
      : ExternalMcpConnectionStatus.DEGRADED;
    const updated = await this.models.copilotExternalMcp.recordFailure(
      connection.id,
      status,
      normalized.code,
      normalized.message
    );
    await this.audit(updated, actorId, eventType, status, {
      ...metadata,
      errorCode: normalized.code,
    });
  }

  private normalizeError(error: unknown) {
    if (error instanceof ExternalMcpTransportError) {
      return {
        code: error.code.slice(0, 128),
        message: error.message.slice(0, 500),
        reauthenticate: error.requiresReauthentication,
      };
    }
    return {
      code: 'mcp_internal_error',
      message: 'SparkClaw MCP operation failed',
      reauthenticate: false,
    };
  }

  private async updateSessionIfChanged(
    connection: AiExternalMcpConnection,
    previousSessionId: string,
    nextSessionId: string,
    actorId: string
  ) {
    if (nextSessionId === previousSessionId) return;
    const sessionFingerprint = this.fingerprint(nextSessionId).slice(0, 12);
    const updated = await this.models.copilotExternalMcp.updateSession(
      connection.id,
      this.crypto.encrypt(nextSessionId),
      sessionFingerprint
    );
    await this.audit(updated, actorId, 'session_rotated', updated.status, {
      previousSessionFingerprint: this.fingerprint(previousSessionId).slice(
        0,
        12
      ),
      sessionFingerprint,
    });
  }

  private publicError(error: unknown) {
    const normalized = this.normalizeError(error);
    return new BadRequestException(normalized.message);
  }

  private audit(
    connection: AiExternalMcpConnection,
    actorId: string,
    eventType: string,
    status: string,
    metadata?: Record<string, unknown>
  ) {
    return this.models.copilotExternalMcp.addAudit({
      connection,
      actorId,
      eventType,
      status,
      metadata,
    });
  }

  private fingerprint(value: string) {
    return this.crypto.sha256(value).toString('hex');
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map(item => this.stableJson(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map(key => `${JSON.stringify(key)}:${this.stableJson(object[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
