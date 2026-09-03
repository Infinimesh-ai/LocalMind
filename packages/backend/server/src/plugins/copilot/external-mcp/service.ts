import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type AiExternalMcpConnection,
  type AiExternalMcpToolExecution,
  ExternalMcpConnectionStatus,
  ExternalMcpToolExecutionStatus,
} from '@prisma/client';

import { Config, CryptoHelper, Mutex } from '../../../base';
import { PermissionAccess } from '../../../core/permission';
import { Models } from '../../../models';
import {
  type ExternalMcpToolRecord,
  type ExternalMcpToolRisk,
  REMOTE_OPERATION_MAX_POLL_ATTEMPTS,
} from '../../../models/copilot-external-mcp';
import { llmValidateJsonSchema } from '../../../native';
import { toolSchemaFingerprint } from '../runtime/tool-capability-snapshot';
import { ExternalMcpTransport, ExternalMcpTransportError } from './transport';

const PROTOCOL_VERSION = '2025-06-18';
export const SPARKCLAW_CONVERSATION_TOOL = 'sparkclaw.conversation.send';
const SPARKCLAW_OPERATION_GET_TOOL = 'sparkclaw.operation.get';
const SPARKCLAW_OPERATION_RESULT_TOOL = 'sparkclaw.operation.result';
const SPARKCLAW_OPERATION_CANCEL_TOOL = 'sparkclaw.operation.cancel';
const SPARKCLAW_OPERATION_TOOLS = new Set([
  SPARKCLAW_OPERATION_GET_TOOL,
  SPARKCLAW_OPERATION_RESULT_TOOL,
  SPARKCLAW_OPERATION_CANCEL_TOOL,
]);
const REQUIRED_SPARKCLAW_TOOLS = new Set([
  SPARKCLAW_CONVERSATION_TOOL,
  ...SPARKCLAW_OPERATION_TOOLS,
]);
const MAX_TOOLS = 128;
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_TEST_RESULT_BYTES = 128 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const REMOTE_OPERATION_POLL_DELAY_MS = 15_000;
const REMOTE_OPERATION_DEFAULT_TTL_MS = 15 * 60_000;
const REMOTE_OPERATION_BATCH_SIZE = 25;

type SparkClawOperationState =
  | 'running'
  | 'approval_required'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'revoked';

type ParsedSparkClawResult =
  | { kind: 'completed'; operationId: string; result: unknown }
  | {
      kind: 'pending';
      operationId: string;
      state: 'running' | 'approval_required';
      deadlineAt: Date | null;
    }
  | {
      kind: 'failed';
      operationId: string;
      state: 'failed' | 'cancelled' | 'revoked';
      errorCode: string;
    };

export type ExternalMcpToolExecutionResult = {
  toolName: string;
  risk: ExternalMcpToolRisk;
  result: unknown;
  idempotentReplay: boolean;
  sideEffectApplied: boolean;
  remoteOperationId?: string;
  remoteState?: SparkClawOperationState;
};

@Injectable()
export class ExternalMcpConnectionService {
  constructor(
    private readonly config: Config,
    private readonly crypto: CryptoHelper,
    private readonly models: Models,
    private readonly transport: ExternalMcpTransport,
    private readonly ac: PermissionAccess,
    private readonly mutex: Mutex
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

    return await this.withConnectionLock(input.workspaceId, async () => {
      await this.assertSettingsUpdate(input.actorId, input.workspaceId);
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
        const sessionId = await this.transport.initialized({
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
        const catalog = this.normalizeCatalog(listed.tools);
        this.assertConversationV2Catalog(catalog);
        const enabledToolNames = catalog.some(
          tool => tool.name === SPARKCLAW_CONVERSATION_TOOL
        )
          ? [SPARKCLAW_CONVERSATION_TOOL]
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
    });
  }

  async refresh(connection: AiExternalMcpConnection, actorId: string) {
    return await this.withConnectionLock(connection.workspaceId, async () => {
      await this.assertSettingsUpdate(actorId, connection.workspaceId);
      const current = await this.requireConnection(connection.workspaceId);
      this.assertUsable(current);
      try {
        const sessionId = this.decryptSession(current);
        const listed = await this.transport.listTools({
          endpoint: this.endpoint,
          sessionId,
          protocolVersion: PROTOCOL_VERSION,
        });
        await this.updateSessionIfChanged(
          current,
          sessionId,
          listed.sessionId,
          actorId
        );
        const catalog = this.normalizeCatalog(listed.tools);
        this.assertConversationV2Catalog(catalog);
        const known = new Set(
          this.businessCatalog(catalog).map(tool => tool.name)
        );
        const enabledToolNames = current.enabledToolNames.filter(name =>
          known.has(name)
        );
        const updated = await this.models.copilotExternalMcp.saveCatalog({
          id: current.id,
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
        await this.recordFailure(current, actorId, error, 'refresh_failed');
        throw this.publicError(error);
      }
    });
  }

  async updateEnabledTools(
    connection: AiExternalMcpConnection,
    actorId: string,
    names: string[]
  ) {
    return await this.withConnectionLock(connection.workspaceId, async () => {
      await this.assertSettingsUpdate(actorId, connection.workspaceId);
      const current = await this.requireConnection(connection.workspaceId);
      this.assertUsable(current);
      const available = new Set(
        this.businessCatalog(this.catalog(current)).map(tool => tool.name)
      );
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
        current.id,
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
    });
  }

  async enabledTools(input: { workspaceId: string; actorId: string }) {
    const allowed = await this.ac
      .user(input.actorId)
      .workspace(input.workspaceId)
      .allowLocal()
      .can('Workspace.Copilot');
    if (!allowed) return [];
    const connection = await this.get(input.workspaceId);
    if (
      !connection ||
      connection.status !== ExternalMcpConnectionStatus.ACTIVE ||
      connection.deletedAt ||
      !connection.encryptedSessionId
    ) {
      return [];
    }
    const enabled = new Set(connection.enabledToolNames);
    return this.businessCatalog(this.catalog(connection)).filter(tool =>
      enabled.has(tool.name)
    );
  }

  async executeTool(input: {
    workspaceId: string;
    actorId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
    confirmed: boolean;
    expectedCapability?: {
      toolName: string;
      risk: ExternalMcpToolRisk;
      schemaFingerprint: string;
      requiresExplicitUserRequest: boolean;
    };
    signal?: AbortSignal;
  }): Promise<ExternalMcpToolExecutionResult> {
    return await this.withConnectionLock(input.workspaceId, async () => {
      await this.ac
        .user(input.actorId)
        .workspace(input.workspaceId)
        .allowLocal()
        .assert('Workspace.Copilot');
      if (input.signal?.aborted) {
        throw new BadRequestException('SparkClaw tool execution was cancelled');
      }
      const connection = await this.get(input.workspaceId);
      if (!connection) {
        throw new BadRequestException('SparkClaw MCP connection not found');
      }
      if (
        connection.status !== ExternalMcpConnectionStatus.ACTIVE ||
        connection.deletedAt ||
        !connection.encryptedSessionId
      ) {
        throw new BadRequestException('SparkClaw MCP connection is not active');
      }
      if (!connection.enabledToolNames.includes(input.toolName)) {
        throw new BadRequestException('SparkClaw MCP tool is not enabled');
      }
      const tool = this.businessCatalog(this.catalog(connection)).find(
        candidate => candidate.name === input.toolName
      );
      if (!tool) {
        throw new BadRequestException('SparkClaw MCP tool is unavailable');
      }
      if (
        input.expectedCapability &&
        (tool.name !== input.expectedCapability.toolName ||
          tool.risk !== input.expectedCapability.risk ||
          tool.requiresExplicitUserRequest !==
            input.expectedCapability.requiresExplicitUserRequest ||
          toolSchemaFingerprint(tool.inputSchema) !==
            input.expectedCapability.schemaFingerprint)
      ) {
        throw new BadRequestException(
          'SparkClaw tool capability changed after the task was queued'
        );
      }
      if (tool.requiresExplicitUserRequest && !input.confirmed) {
        throw new BadRequestException(
          'SparkClaw write or high-risk tools require an explicit user request'
        );
      }
      const idempotencyKey = input.idempotencyKey.trim();
      if (
        !idempotencyKey ||
        idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
      ) {
        throw new BadRequestException(
          'SparkClaw tool idempotency key is invalid'
        );
      }
      const serializedArguments = this.stableJson(input.arguments);
      if (Buffer.byteLength(serializedArguments) > MAX_TOOL_ARGUMENT_BYTES) {
        throw new BadRequestException(
          'SparkClaw tool arguments exceeded the size limit'
        );
      }
      let validatedArguments: Record<string, unknown>;
      try {
        validatedArguments = llmValidateJsonSchema(
          tool.inputSchema,
          input.arguments
        ) as Record<string, unknown>;
      } catch {
        throw new BadRequestException(
          'SparkClaw tool arguments do not match the advertised schema'
        );
      }
      const argumentsFingerprint = this.fingerprint(
        this.stableJson(validatedArguments)
      );
      const claim = await this.models.copilotExternalMcp.claimToolExecution({
        connection,
        actorId: input.actorId,
        toolName: tool.name,
        risk: tool.risk,
        idempotencyKey,
        argumentsFingerprint,
      });
      if (claim.state === 'completed') {
        const encryptedResult = claim.execution.encryptedResult;
        if (!encryptedResult) {
          throw new BadRequestException(
            'SparkClaw tool replay result is unavailable'
          );
        }
        try {
          return {
            toolName: tool.name,
            risk: tool.risk,
            result: JSON.parse(this.crypto.decrypt(encryptedResult)) as unknown,
            idempotentReplay: true,
            sideEffectApplied: false,
          };
        } catch {
          throw new BadRequestException(
            'SparkClaw tool replay result cannot be decrypted'
          );
        }
      }
      if (claim.state === 'remote_pending') {
        if (
          !claim.execution.remoteOperationId ||
          !claim.execution.remoteState
        ) {
          throw new BadRequestException(
            'SparkClaw remote operation state is unavailable'
          );
        }
        return {
          toolName: tool.name,
          risk: tool.risk,
          result: this.pendingResult(
            claim.execution.remoteOperationId,
            claim.execution.remoteState
          ),
          idempotentReplay: true,
          sideEffectApplied: false,
          remoteOperationId: claim.execution.remoteOperationId,
          remoteState: claim.execution.remoteState as SparkClawOperationState,
        };
      }
      if (claim.state === 'in_progress') {
        throw new BadRequestException(
          'SparkClaw tool execution is already in progress'
        );
      }
      if (claim.state === 'terminal') {
        throw new BadRequestException(
          'SparkClaw tool idempotency key cannot be reused'
        );
      }

      const execution = claim.execution;
      const leaseId = execution.leaseId;
      if (!leaseId) {
        throw new Error('SparkClaw tool execution lease is missing');
      }
      await this.audit(connection, input.actorId, 'tool_started', 'RUNNING', {
        executionId: execution.id,
        toolName: tool.name,
        risk: tool.risk,
        attemptCount: execution.attemptCount,
        idempotencyKey,
        argumentsFingerprint,
      });
      let remoteOperationId: string | undefined;
      let remoteState: SparkClawOperationState | undefined;
      try {
        const sessionId = this.decryptSession(connection);
        const called = await this.transport.callTool({
          endpoint: this.endpoint,
          sessionId,
          protocolVersion: PROTOCOL_VERSION,
          name: tool.name,
          arguments: validatedArguments,
          idempotencyKey,
          signal: input.signal,
        });
        await this.updateSessionIfChanged(
          connection,
          sessionId,
          called.sessionId,
          input.actorId
        );
        const parsed = this.parseSparkClawResult(called.result);
        remoteOperationId = parsed.operationId;
        remoteState = parsed.kind === 'completed' ? 'succeeded' : parsed.state;
        if (parsed.kind === 'failed') {
          throw new ExternalMcpTransportError(
            parsed.errorCode,
            `SparkClaw MCP operation ended as ${parsed.state}`
          );
        }
        if (parsed.kind === 'pending') {
          const remoteOperationFingerprint = this.fingerprint(
            parsed.operationId
          ).slice(0, 12);
          await this.models.copilotExternalMcp.finalizeToolExecutionPending({
            connection,
            actorId: input.actorId,
            id: execution.id,
            leaseId,
            remoteOperationId: parsed.operationId,
            remoteState: parsed.state,
            remoteDeadlineAt:
              parsed.deadlineAt ??
              new Date(Date.now() + REMOTE_OPERATION_DEFAULT_TTL_MS),
            nextPollAt: new Date(Date.now() + REMOTE_OPERATION_POLL_DELAY_MS),
            metadata: {
              executionId: execution.id,
              toolName: tool.name,
              risk: tool.risk,
              attemptCount: execution.attemptCount,
              idempotencyKey,
              argumentsFingerprint,
              remoteOperationFingerprint,
              remoteState: parsed.state,
            },
          });
          return {
            toolName: tool.name,
            risk: tool.risk,
            result: this.pendingResult(parsed.operationId, parsed.state),
            idempotentReplay: false,
            sideEffectApplied: true,
            remoteOperationId: parsed.operationId,
            remoteState: parsed.state,
          };
        }
        const result = this.boundJson(parsed.result, MAX_TEST_RESULT_BYTES);
        const serializedResult = JSON.stringify(result);
        const resultFingerprint = this.fingerprint(serializedResult);
        await this.models.copilotExternalMcp.finalizeToolExecutionSuccess({
          connection,
          actorId: input.actorId,
          id: execution.id,
          leaseId,
          resultFingerprint,
          encryptedResult: this.crypto.encrypt(serializedResult),
          remoteOperationId: parsed.operationId,
          remoteState: 'succeeded',
          metadata: {
            executionId: execution.id,
            toolName: tool.name,
            risk: tool.risk,
            attemptCount: execution.attemptCount,
            idempotencyKey,
            argumentsFingerprint,
            resultFingerprint,
          },
        });
        return {
          toolName: tool.name,
          risk: tool.risk,
          result,
          idempotentReplay: false,
          sideEffectApplied: tool.risk !== 'read',
        };
      } catch (error) {
        const cancelled =
          input.signal?.aborted === true ||
          remoteState === 'cancelled' ||
          remoteState === 'revoked';
        const normalized = this.normalizeError(error);
        const connectionStatus =
          !cancelled && this.isConnectionFailure(error)
            ? normalized.reauthenticate
              ? ExternalMcpConnectionStatus.REAUTH_REQUIRED
              : ExternalMcpConnectionStatus.DEGRADED
            : undefined;
        await this.models.copilotExternalMcp.finalizeToolExecutionFailure({
          connection,
          actorId: input.actorId,
          id: execution.id,
          leaseId,
          status: cancelled ? 'CANCELLED' : 'FAILED',
          errorCode: cancelled ? 'mcp_tool_cancelled' : normalized.code,
          errorMessage: cancelled
            ? 'SparkClaw tool execution was cancelled'
            : normalized.message,
          remoteOperationId,
          remoteState,
          connectionStatus,
          metadata: {
            executionId: execution.id,
            toolName: tool.name,
            risk: tool.risk,
            attemptCount: execution.attemptCount,
            idempotencyKey,
            argumentsFingerprint,
            errorCode: cancelled ? 'mcp_tool_cancelled' : normalized.code,
          },
        });
        throw cancelled
          ? new BadRequestException('SparkClaw tool execution was cancelled')
          : this.publicError(error);
      }
    });
  }

  async processPendingOperations(input: { limit?: number } = {}) {
    const limit = Math.min(
      Math.max(input.limit ?? REMOTE_OPERATION_BATCH_SIZE, 1),
      100
    );
    const due = await this.models.copilotExternalMcp.listDueRemoteOperations({
      limit,
    });
    const summary = {
      selectedCount: due.length,
      processedCount: 0,
      completedCount: 0,
      rescheduledCount: 0,
      failedCount: 0,
      cancelledCount: 0,
    };

    for (const candidate of due) {
      try {
        await this.withConnectionLock(candidate.workspaceId, async () => {
          const execution =
            await this.models.copilotExternalMcp.claimRemoteOperationPoll(
              candidate.id
            );
          if (!execution) return;
          summary.processedCount += 1;
          const outcome = await this.processRemoteOperation(execution);
          if (outcome === 'completed') summary.completedCount += 1;
          else if (outcome === 'rescheduled') summary.rescheduledCount += 1;
          else if (outcome === 'cancelled') summary.cancelledCount += 1;
          else summary.failedCount += 1;
        });
      } catch {
        summary.failedCount += 1;
      }
    }

    return summary;
  }

  async testConversation(
    connection: AiExternalMcpConnection,
    actorId: string,
    query: string
  ) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > 2000) {
      throw new BadRequestException(
        'Test query must contain 1 to 2000 characters'
      );
    }
    await this.assertSettingsUpdate(actorId, connection.workspaceId);
    const idempotencyKey = randomUUID();
    const executed = await this.executeTool({
      workspaceId: connection.workspaceId,
      actorId,
      toolName: SPARKCLAW_CONVERSATION_TOOL,
      arguments: { text: normalizedQuery },
      idempotencyKey,
      confirmed: true,
    });
    return { toolName: executed.toolName, result: executed.result };
  }

  async disable(connection: AiExternalMcpConnection, actorId: string) {
    return await this.withConnectionLock(connection.workspaceId, async () => {
      await this.assertSettingsUpdate(actorId, connection.workspaceId);
      const current = await this.requireConnection(connection.workspaceId);
      const updated = await this.models.copilotExternalMcp.disable(current.id);
      await this.audit(updated, actorId, 'disabled', 'DISABLED');
      return updated;
    });
  }

  async delete(connection: AiExternalMcpConnection, actorId: string) {
    return await this.withConnectionLock(connection.workspaceId, async () => {
      await this.assertSettingsUpdate(actorId, connection.workspaceId);
      const current = await this.requireConnection(connection.workspaceId);
      await this.audit(current, actorId, 'deleted', 'DISABLED', {
        sessionFingerprint: current.sessionFingerprint,
      });
      await this.models.copilotExternalMcp.softDelete(current.id);
      return true;
    });
  }

  catalog(connection: AiExternalMcpConnection): ExternalMcpToolRecord[] {
    if (!Array.isArray(connection.toolCatalog)) return [];
    const tools = connection.toolCatalog as unknown[];
    return tools
      .filter(
        (tool): tool is Record<string, unknown> =>
          Boolean(tool) &&
          typeof tool === 'object' &&
          !Array.isArray(tool) &&
          typeof (tool as { name?: unknown }).name === 'string'
      )
      .map(tool => {
        const annotations = this.normalizeAnnotations(tool.annotations);
        const risk = this.normalizeRisk(tool.risk, tool.name, annotations);
        return {
          ...tool,
          name: String(tool.name),
          inputSchema:
            tool.inputSchema &&
            typeof tool.inputSchema === 'object' &&
            !Array.isArray(tool.inputSchema)
              ? (tool.inputSchema as Record<string, unknown>)
              : { type: 'object', properties: {} },
          ...(annotations ? { annotations } : {}),
          risk,
          requiresExplicitUserRequest: risk !== 'read',
        } as ExternalMcpToolRecord;
      });
  }

  businessCatalog(catalog: ExternalMcpToolRecord[]) {
    return catalog.filter(
      tool =>
        tool.name === SPARKCLAW_CONVERSATION_TOOL &&
        !SPARKCLAW_OPERATION_TOOLS.has(tool.name)
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

  private async requireConnection(workspaceId: string) {
    const connection = await this.get(workspaceId);
    if (!connection) {
      throw new BadRequestException('SparkClaw MCP connection not found');
    }
    return connection;
  }

  private assertSettingsUpdate(actorId: string, workspaceId: string) {
    return this.ac
      .user(actorId)
      .workspace(workspaceId)
      .allowLocal()
      .assert('Workspace.Settings.Update');
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
      const annotations = this.normalizeAnnotations(tool.annotations);
      const risk = this.normalizeRisk(undefined, name, annotations);
      return {
        name,
        ...(typeof tool.title === 'string' && tool.title.trim()
          ? { title: tool.title.trim().slice(0, 256) }
          : {}),
        ...(typeof tool.description === 'string' && tool.description.trim()
          ? { description: this.sanitizeCatalogText(tool.description, 2000) }
          : {}),
        inputSchema: inputSchema as Record<string, unknown>,
        ...(annotations ? { annotations } : {}),
        risk,
        requiresExplicitUserRequest: risk !== 'read',
      };
    });
    this.boundJson(tools, MAX_CATALOG_BYTES);
    return tools.sort((left, right) => left.name.localeCompare(right.name));
  }

  private assertConversationV2Catalog(catalog: ExternalMcpToolRecord[]) {
    const names = new Set(catalog.map(tool => tool.name));
    const missing = [...REQUIRED_SPARKCLAW_TOOLS].filter(
      name => !names.has(name)
    );
    if (missing.length) {
      throw new ExternalMcpTransportError(
        'mcp_conversation_v2_mismatch',
        'SparkClaw does not advertise the required conversation-v2 tools'
      );
    }
  }

  private parseSparkClawResult(value: unknown): ParsedSparkClawResult {
    const callResult = this.asRecord(value);
    const structuredContent = this.asRecord(callResult?.structuredContent);
    if (!callResult || !structuredContent || callResult.isError === true) {
      throw new ExternalMcpTransportError(
        'mcp_invalid_response',
        'SparkClaw returned an invalid conversation result'
      );
    }

    const operation = this.asRecord(structuredContent.operation);
    const stateValue = operation?.state ?? structuredContent.state;
    const operationIdValue = operation?.id ?? structuredContent.operation_id;
    const state = this.sparkClawOperationState(stateValue);
    const operationId =
      typeof operationIdValue === 'string' ? operationIdValue.trim() : '';
    if (!state || !operationId || operationId.length > 256) {
      throw new ExternalMcpTransportError(
        'mcp_invalid_response',
        'SparkClaw returned an invalid operation envelope'
      );
    }

    if (state === 'running' || state === 'approval_required') {
      const invocation = this.asRecord(operation?.invocation);
      const deadlineValue =
        invocation?.deadline ?? structuredContent.deadline_at;
      const parsedDeadline =
        typeof deadlineValue === 'string' ? new Date(deadlineValue) : null;
      return {
        kind: 'pending',
        operationId,
        state,
        deadlineAt:
          parsedDeadline && Number.isFinite(parsedDeadline.getTime())
            ? parsedDeadline
            : null,
      };
    }

    if (state === 'succeeded') {
      return {
        kind: 'completed',
        operationId,
        result: this.projectCallToolResult(callResult),
      };
    }

    const remoteErrorCode =
      typeof operation?.error_code === 'string'
        ? operation.error_code
        : typeof structuredContent.error_code === 'string'
          ? structuredContent.error_code
          : `operation_${state}`;
    return {
      kind: 'failed',
      operationId,
      state,
      errorCode: `sparkclaw_${remoteErrorCode
        .replace(/[^a-zA-Z0-9_.-]+/g, '_')
        .slice(0, 96)}`,
    };
  }

  private pendingResult(
    operationId: string,
    state: SparkClawOperationState | string
  ) {
    return {
      content: [
        {
          type: 'text',
          text:
            state === 'approval_required'
              ? 'SparkClaw is waiting for approval in SparkClaw.'
              : 'SparkClaw is still processing this request.',
        },
      ],
      structuredContent: {
        operation_id: operationId,
        state,
        ready: false,
      },
    };
  }

  private async processRemoteOperation(
    execution: AiExternalMcpToolExecution & {
      connection: AiExternalMcpConnection;
    }
  ): Promise<'completed' | 'rescheduled' | 'failed' | 'cancelled'> {
    const leaseId = execution.leaseId;
    const remoteOperationId = execution.remoteOperationId;
    if (!leaseId || !remoteOperationId) {
      throw new Error('SparkClaw remote operation poll lease is incomplete');
    }

    let actorAllowed = false;
    if (execution.actorId) {
      try {
        actorAllowed = await this.ac
          .user(execution.actorId)
          .workspace(execution.workspaceId)
          .allowLocal()
          .can('Workspace.Copilot');
      } catch {
        actorAllowed = false;
      }
    }
    if (!actorAllowed) {
      await this.cancelRemoteOperation(execution);
      await this.finalizeRemoteFailure({
        execution,
        leaseId,
        status: 'CANCELLED',
        errorCode: 'mcp_delegated_acl_revoked',
        errorMessage: 'SparkClaw execution permission was revoked',
        remoteState: 'cancelled',
      });
      return 'cancelled';
    }

    if (
      execution.remoteDeadlineAt &&
      execution.remoteDeadlineAt.getTime() <= Date.now()
    ) {
      await this.cancelRemoteOperation(execution);
      await this.finalizeRemoteFailure({
        execution,
        leaseId,
        status: 'CANCELLED',
        errorCode: 'mcp_remote_deadline_exceeded',
        errorMessage: 'SparkClaw remote operation exceeded its deadline',
        remoteState: 'cancelled',
      });
      return 'cancelled';
    }

    if (
      execution.connection.deletedAt ||
      execution.connection.status === ExternalMcpConnectionStatus.DISABLED ||
      !execution.connection.encryptedSessionId
    ) {
      await this.cancelRemoteOperation(execution);
      await this.finalizeRemoteFailure({
        execution,
        leaseId,
        status: 'CANCELLED',
        errorCode: 'mcp_connection_unavailable',
        errorMessage: 'SparkClaw connection became unavailable',
        remoteState: 'cancelled',
      });
      return 'cancelled';
    }

    try {
      const sessionId = this.decryptSession(execution.connection);
      const called = await this.transport.callTool({
        endpoint: this.endpoint,
        sessionId,
        protocolVersion: PROTOCOL_VERSION,
        name: SPARKCLAW_OPERATION_RESULT_TOOL,
        arguments: { operation_id: remoteOperationId },
        idempotencyKey: this.remoteControlIdempotencyKey(execution, 'result'),
        requestId: 100 + execution.pollAttemptCount,
      });
      await this.updateSessionIfChanged(
        execution.connection,
        sessionId,
        called.sessionId,
        execution.actorId
      );
      const parsed = this.parseSparkClawResult(called.result);
      if (parsed.operationId !== remoteOperationId) {
        throw new ExternalMcpTransportError(
          'mcp_invalid_response',
          'SparkClaw returned a mismatched operation result'
        );
      }
      if (parsed.kind === 'completed') {
        const result = this.boundJson(parsed.result, MAX_TEST_RESULT_BYTES);
        const serializedResult = JSON.stringify(result);
        const resultFingerprint = this.fingerprint(serializedResult);
        await this.models.copilotExternalMcp.finalizeToolExecutionSuccess({
          connection: execution.connection,
          actorId: execution.actorId,
          id: execution.id,
          leaseId,
          resultFingerprint,
          encryptedResult: this.crypto.encrypt(serializedResult),
          remoteState: 'succeeded',
          metadata: this.remoteAuditMetadata(execution, {
            remoteState: 'succeeded',
            resultFingerprint,
          }),
        });
        return 'completed';
      }
      if (parsed.kind === 'failed') {
        const cancelled =
          parsed.state === 'cancelled' || parsed.state === 'revoked';
        await this.finalizeRemoteFailure({
          execution,
          leaseId,
          status: cancelled ? 'CANCELLED' : 'FAILED',
          errorCode: parsed.errorCode,
          errorMessage: `SparkClaw remote operation ended as ${parsed.state}`,
          remoteState: parsed.state,
        });
        return cancelled ? 'cancelled' : 'failed';
      }
      if (execution.pollAttemptCount >= REMOTE_OPERATION_MAX_POLL_ATTEMPTS) {
        await this.cancelRemoteOperation(execution);
        await this.finalizeRemoteFailure({
          execution,
          leaseId,
          status: 'FAILED',
          errorCode: 'mcp_remote_poll_exhausted',
          errorMessage:
            'SparkClaw remote operation exceeded its polling budget',
          remoteState: parsed.state,
        });
        return 'failed';
      }
      await this.models.copilotExternalMcp.rescheduleRemoteOperation({
        id: execution.id,
        leaseId,
        remoteState: parsed.state,
        nextPollAt: new Date(Date.now() + REMOTE_OPERATION_POLL_DELAY_MS),
      });
      if (parsed.state !== execution.remoteState) {
        await this.models.copilotExternalMcp.addAudit({
          connection: execution.connection,
          actorId: execution.actorId,
          eventType: 'tool_remote_state_changed',
          status:
            parsed.state === 'approval_required'
              ? ExternalMcpToolExecutionStatus.APPROVAL_REQUIRED
              : ExternalMcpToolExecutionStatus.PENDING,
          metadata: this.remoteAuditMetadata(execution, {
            remoteState: parsed.state,
          }),
        });
      }
      return 'rescheduled';
    } catch (error) {
      const normalized = this.normalizeError(error);
      const exhausted =
        execution.pollAttemptCount >= REMOTE_OPERATION_MAX_POLL_ATTEMPTS;
      const terminal = normalized.reauthenticate || exhausted;
      if (!terminal && this.isConnectionFailure(error)) {
        const status = normalized.reauthenticate
          ? ExternalMcpConnectionStatus.REAUTH_REQUIRED
          : ExternalMcpConnectionStatus.DEGRADED;
        const connection = await this.models.copilotExternalMcp.recordFailure(
          execution.connection.id,
          status,
          normalized.code,
          normalized.message
        );
        await this.models.copilotExternalMcp.addAudit({
          connection,
          actorId: execution.actorId,
          eventType: 'tool_remote_poll_failed',
          status,
          metadata: this.remoteAuditMetadata(execution, {
            errorCode: normalized.code,
          }),
        });
        await this.models.copilotExternalMcp.rescheduleRemoteOperation({
          id: execution.id,
          leaseId,
          remoteState:
            execution.remoteState === 'approval_required'
              ? 'approval_required'
              : 'running',
          nextPollAt: new Date(Date.now() + REMOTE_OPERATION_POLL_DELAY_MS),
        });
        return 'rescheduled';
      }
      await this.finalizeRemoteFailure({
        execution,
        leaseId,
        status: 'FAILED',
        errorCode: exhausted ? 'mcp_remote_poll_exhausted' : normalized.code,
        errorMessage: normalized.message,
        remoteState:
          execution.remoteState === 'approval_required'
            ? 'approval_required'
            : 'running',
        connectionStatus: normalized.reauthenticate
          ? ExternalMcpConnectionStatus.REAUTH_REQUIRED
          : undefined,
      });
      return 'failed';
    }
  }

  private async cancelRemoteOperation(
    execution: AiExternalMcpToolExecution & {
      connection: AiExternalMcpConnection;
    }
  ) {
    if (
      !execution.remoteOperationId ||
      !execution.connection.encryptedSessionId
    ) {
      return;
    }
    try {
      const sessionId = this.decryptSession(execution.connection);
      const called = await this.transport.callTool({
        endpoint: this.endpoint,
        sessionId,
        protocolVersion: PROTOCOL_VERSION,
        name: SPARKCLAW_OPERATION_CANCEL_TOOL,
        arguments: { operation_id: execution.remoteOperationId },
        idempotencyKey: this.remoteControlIdempotencyKey(execution, 'cancel'),
        requestId: 1000 + execution.pollAttemptCount,
      });
      await this.updateSessionIfChanged(
        execution.connection,
        sessionId,
        called.sessionId,
        execution.actorId
      );
    } catch {
      // Local cancellation remains authoritative when the remote is unavailable.
    }
  }

  private finalizeRemoteFailure(input: {
    execution: AiExternalMcpToolExecution & {
      connection: AiExternalMcpConnection;
    };
    leaseId: string;
    status: 'FAILED' | 'CANCELLED';
    errorCode: string;
    errorMessage: string;
    remoteState: SparkClawOperationState;
    connectionStatus?: ExternalMcpConnectionStatus;
  }) {
    return this.models.copilotExternalMcp.finalizeToolExecutionFailure({
      connection: input.execution.connection,
      actorId: input.execution.actorId,
      id: input.execution.id,
      leaseId: input.leaseId,
      status: input.status,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      remoteState: input.remoteState,
      connectionStatus: input.connectionStatus,
      metadata: this.remoteAuditMetadata(input.execution, {
        remoteState: input.remoteState,
        errorCode: input.errorCode,
      }),
    });
  }

  private remoteAuditMetadata(
    execution: AiExternalMcpToolExecution,
    metadata: Record<string, unknown>
  ) {
    return {
      executionId: execution.id,
      toolName: execution.toolName,
      risk: execution.risk,
      pollAttemptCount: execution.pollAttemptCount,
      remoteOperationFingerprint: this.fingerprint(
        execution.remoteOperationId ?? ''
      ).slice(0, 12),
      ...metadata,
    };
  }

  private remoteControlIdempotencyKey(
    execution: AiExternalMcpToolExecution,
    action: 'result' | 'cancel'
  ) {
    return `localmind-${action}-${this.fingerprint(execution.id).slice(0, 32)}`;
  }

  private projectCallToolResult(value: Record<string, unknown>) {
    const content = Array.isArray(value.content)
      ? value.content.slice(0, 32).map(item => {
          const record = this.asRecord(item);
          const type =
            typeof record?.type === 'string' ? record.type : 'unknown';
          if (type === 'text') {
            return {
              type,
              text:
                typeof record?.text === 'string'
                  ? record.text.slice(0, MAX_TEST_RESULT_BYTES)
                  : '',
            };
          }
          if (type === 'resource') {
            const resource = this.asRecord(record?.resource);
            return {
              type,
              resource: {
                ...(typeof resource?.uri === 'string'
                  ? { uri: resource.uri.slice(0, 2048) }
                  : {}),
                ...(typeof resource?.name === 'string'
                  ? { name: resource.name.slice(0, 512) }
                  : {}),
                ...(typeof resource?.mimeType === 'string'
                  ? { mimeType: resource.mimeType.slice(0, 256) }
                  : {}),
                binaryOmitted: true,
              },
            };
          }
          return {
            type,
            ...(typeof record?.mimeType === 'string'
              ? { mimeType: record.mimeType.slice(0, 256) }
              : {}),
            binaryOmitted: type === 'image' || type === 'audio',
          };
        })
      : [];
    return {
      content,
      structuredContent: this.sanitizeRemoteValue(value.structuredContent, 0),
      ...(value.isError === true ? { isError: true } : {}),
    };
  }

  private sanitizeRemoteValue(value: unknown, depth: number): unknown {
    if (depth > 8 || value === null || value === undefined) return null;
    if (typeof value === 'string') return value.slice(0, 32 * 1024);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value
        .slice(0, 128)
        .map(item => this.sanitizeRemoteValue(item, depth + 1));
    }
    const record = this.asRecord(value);
    if (!record) return null;
    const isBinaryContent = record.type === 'image' || record.type === 'audio';
    return Object.fromEntries(
      Object.entries(record)
        .slice(0, 128)
        .filter(
          ([key]) => key !== 'blob' && !(key === 'data' && isBinaryContent)
        )
        .map(([key, item]) => [
          key.slice(0, 256),
          this.sanitizeRemoteValue(item, depth + 1),
        ])
    );
  }

  private sparkClawOperationState(
    value: unknown
  ): SparkClawOperationState | null {
    return value === 'running' ||
      value === 'approval_required' ||
      value === 'succeeded' ||
      value === 'failed' ||
      value === 'cancelled' ||
      value === 'revoked'
      ? value
      : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
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

  private isConnectionFailure(error: unknown) {
    if (!(error instanceof ExternalMcpTransportError)) return false;
    return (
      error.requiresReauthentication ||
      new Set([
        'mcp_network_error',
        'mcp_request_timeout',
        'mcp_http_error',
        'mcp_invalid_response',
        'mcp_response_too_large',
      ]).has(error.code)
    );
  }

  private normalizeAnnotations(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const annotations: NonNullable<ExternalMcpToolRecord['annotations']> = {};
    if (typeof record.title === 'string' && record.title.trim()) {
      annotations.title = this.sanitizeCatalogText(record.title, 256);
    }
    for (const key of [
      'readOnlyHint',
      'destructiveHint',
      'idempotentHint',
      'openWorldHint',
    ] as const) {
      if (typeof record[key] === 'boolean') annotations[key] = record[key];
    }
    return Object.keys(annotations).length ? annotations : undefined;
  }

  private normalizeRisk(
    value: unknown,
    toolName: unknown,
    annotations?: ExternalMcpToolRecord['annotations']
  ): ExternalMcpToolRisk {
    if (value === 'read' || value === 'write' || value === 'high') return value;
    if (toolName === SPARKCLAW_CONVERSATION_TOOL) return 'write';
    if (
      toolName === SPARKCLAW_OPERATION_GET_TOOL ||
      toolName === SPARKCLAW_OPERATION_RESULT_TOOL
    ) {
      return 'read';
    }
    if (toolName === SPARKCLAW_OPERATION_CANCEL_TOOL) return 'write';
    if (annotations?.destructiveHint === true) return 'high';
    if (annotations?.readOnlyHint === true) return 'read';
    return 'high';
  }

  private sanitizeCatalogText(value: string, maxLength: number) {
    return [...value]
      .map(character => {
        const code = character.charCodeAt(0);
        return code <= 8 ||
          code === 11 ||
          code === 12 ||
          (code >= 14 && code <= 31) ||
          code === 127
          ? ' '
          : character;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private async updateSessionIfChanged(
    connection: AiExternalMcpConnection,
    previousSessionId: string,
    nextSessionId: string,
    actorId: string | null
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

  private async withConnectionLock<T>(
    workspaceId: string,
    callback: () => Promise<T>
  ) {
    await using lock = await this.mutex.acquire(
      `copilot:external-mcp:${workspaceId}`
    );
    if (!lock) {
      throw new BadRequestException(
        'SparkClaw MCP connection is busy; retry the request'
      );
    }
    return await callback();
  }

  private audit(
    connection: AiExternalMcpConnection,
    actorId: string | null,
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
