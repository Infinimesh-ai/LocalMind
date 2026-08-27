import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  type AiExternalMcpConnection,
  type AiExternalMcpToolExecution,
  ExternalMcpConnectionStatus,
  ExternalMcpToolExecutionStatus,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

export type ExternalMcpToolRecord = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  risk: ExternalMcpToolRisk;
  requiresExplicitUserRequest: boolean;
};

export type ExternalMcpToolRisk = 'read' | 'write' | 'high';

export type ExternalMcpToolExecutionClaim =
  | {
      state: 'claimed';
      execution: AiExternalMcpToolExecution;
    }
  | {
      state: 'completed' | 'in_progress' | 'remote_pending' | 'terminal';
      execution: AiExternalMcpToolExecution;
    };

const TOOL_EXECUTION_LEASE_MS = 45_000;
const TOOL_EXECUTION_MAX_ATTEMPTS = 3;
const REMOTE_OPERATION_POLL_LEASE_MS = 30_000;
export const REMOTE_OPERATION_MAX_POLL_ATTEMPTS = 20;

@Injectable()
export class CopilotExternalMcpModel extends BaseModel {
  getByWorkspace(workspaceId: string, includeDeleted = false) {
    return this.db.aiExternalMcpConnection
      .findUnique({
        where: { workspaceId },
      })
      .then(connection =>
        !includeDeleted && connection?.deletedAt ? null : connection
      );
  }

  get(id: string, workspaceId: string) {
    return this.db.aiExternalMcpConnection.findFirst({
      where: { id, workspaceId, deletedAt: null },
    });
  }

  async saveInitialized(input: {
    workspaceId: string;
    actorId: string;
    name: string;
    endpoint: string;
    protocolVersion: string;
    encryptedSessionId: string;
    sessionFingerprint: string;
    serverName: string | null;
    serverVersion: string | null;
  }) {
    const now = new Date();
    return await this.db.aiExternalMcpConnection.upsert({
      where: { workspaceId: input.workspaceId },
      create: {
        workspaceId: input.workspaceId,
        createdBy: input.actorId,
        name: input.name,
        endpoint: input.endpoint,
        protocolVersion: input.protocolVersion,
        status: ExternalMcpConnectionStatus.CONNECTING,
        encryptedSessionId: input.encryptedSessionId,
        sessionFingerprint: input.sessionFingerprint,
        serverName: input.serverName,
        serverVersion: input.serverVersion,
        lastConnectedAt: now,
        lastCheckedAt: now,
      },
      update: {
        createdBy: input.actorId,
        name: input.name,
        endpoint: input.endpoint,
        protocolVersion: input.protocolVersion,
        status: ExternalMcpConnectionStatus.CONNECTING,
        encryptedSessionId: input.encryptedSessionId,
        sessionFingerprint: input.sessionFingerprint,
        serverName: input.serverName,
        serverVersion: input.serverVersion,
        toolCatalog: [],
        toolCatalogFingerprint: null,
        enabledToolNames: [],
        lastConnectedAt: now,
        lastCheckedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        deletedAt: null,
      },
    });
  }

  async saveCatalog(input: {
    id: string;
    toolCatalog: ExternalMcpToolRecord[];
    toolCatalogFingerprint: string;
    enabledToolNames: string[];
  }) {
    return await this.db.aiExternalMcpConnection.update({
      where: { id: input.id },
      data: {
        status: ExternalMcpConnectionStatus.ACTIVE,
        toolCatalog: input.toolCatalog as Prisma.InputJsonValue,
        toolCatalogFingerprint: input.toolCatalogFingerprint,
        enabledToolNames: input.enabledToolNames,
        lastCheckedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  async updateEnabledTools(id: string, enabledToolNames: string[]) {
    return await this.db.aiExternalMcpConnection.update({
      where: { id },
      data: { enabledToolNames },
    });
  }

  async updateSession(
    id: string,
    encryptedSessionId: string,
    sessionFingerprint: string
  ) {
    return await this.db.aiExternalMcpConnection.update({
      where: { id },
      data: { encryptedSessionId, sessionFingerprint },
    });
  }

  async recordSuccess(id: string, used = false) {
    const now = new Date();
    return await this.db.aiExternalMcpConnection.update({
      where: { id },
      data: {
        status: ExternalMcpConnectionStatus.ACTIVE,
        lastCheckedAt: now,
        ...(used ? { lastUsedAt: now } : {}),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  async recordFailure(
    id: string,
    status: ExternalMcpConnectionStatus,
    code: string,
    message: string
  ) {
    return await this.db.aiExternalMcpConnection.update({
      where: { id },
      data: {
        status,
        ...(status === ExternalMcpConnectionStatus.REAUTH_REQUIRED
          ? { encryptedSessionId: null, sessionFingerprint: null }
          : {}),
        lastCheckedAt: new Date(),
        lastErrorCode: code,
        lastErrorMessage: message,
      },
    });
  }

  async disable(id: string) {
    return await this.db.aiExternalMcpConnection.update({
      where: { id },
      data: { status: ExternalMcpConnectionStatus.DISABLED },
    });
  }

  async softDelete(id: string) {
    return await this.db.aiExternalMcpConnection.update({
      where: { id },
      data: {
        status: ExternalMcpConnectionStatus.DISABLED,
        encryptedSessionId: null,
        sessionFingerprint: null,
        enabledToolNames: [],
        deletedAt: new Date(),
      },
    });
  }

  async addAudit(input: {
    connection: Pick<AiExternalMcpConnection, 'id' | 'workspaceId'>;
    actorId: string | null;
    eventType: string;
    status: string;
    metadata?: Record<string, unknown>;
  }) {
    return await this.db.aiExternalMcpAuditEvent.create({
      data: {
        connectionId: input.connection.id,
        workspaceId: input.connection.workspaceId,
        actorId: input.actorId,
        eventType: input.eventType,
        status: input.status,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  getToolExecution(connectionId: string, idempotencyKey: string) {
    return this.db.aiExternalMcpToolExecution.findUnique({
      where: {
        connectionId_idempotencyKey: { connectionId, idempotencyKey },
      },
    });
  }

  async claimToolExecution(input: {
    connection: Pick<AiExternalMcpConnection, 'id' | 'workspaceId'>;
    actorId: string;
    toolName: string;
    risk: ExternalMcpToolRisk;
    idempotencyKey: string;
    argumentsFingerprint: string;
    now?: Date;
  }): Promise<ExternalMcpToolExecutionClaim> {
    const now = input.now ?? new Date();
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + TOOL_EXECUTION_LEASE_MS);
    const executionId = randomUUID();
    const current = await this.db.aiExternalMcpToolExecution.upsert({
      where: {
        connectionId_idempotencyKey: {
          connectionId: input.connection.id,
          idempotencyKey: input.idempotencyKey,
        },
      },
      create: {
        id: executionId,
        connectionId: input.connection.id,
        workspaceId: input.connection.workspaceId,
        actorId: input.actorId,
        toolName: input.toolName,
        risk: input.risk,
        idempotencyKey: input.idempotencyKey,
        argumentsFingerprint: input.argumentsFingerprint,
        leaseId,
        leaseExpiresAt,
        startedAt: now,
      },
      update: {},
    });

    if (current.id === executionId) {
      return { state: 'claimed', execution: current };
    }
    if (
      current.toolName !== input.toolName ||
      current.argumentsFingerprint !== input.argumentsFingerprint
    ) {
      return { state: 'terminal', execution: current };
    }
    if (current.status === ExternalMcpToolExecutionStatus.COMPLETED) {
      return { state: 'completed', execution: current };
    }
    if (
      current.status === ExternalMcpToolExecutionStatus.PENDING ||
      current.status === ExternalMcpToolExecutionStatus.APPROVAL_REQUIRED
    ) {
      return { state: 'remote_pending', execution: current };
    }
    if (current.status === ExternalMcpToolExecutionStatus.CANCELLED) {
      return { state: 'terminal', execution: current };
    }
    if (
      current.status === ExternalMcpToolExecutionStatus.FAILED &&
      current.remoteOperationId
    ) {
      return { state: 'terminal', execution: current };
    }
    if (
      current.status === ExternalMcpToolExecutionStatus.RUNNING &&
      current.leaseExpiresAt &&
      current.leaseExpiresAt > now
    ) {
      return { state: 'in_progress', execution: current };
    }
    if (current.attemptCount >= TOOL_EXECUTION_MAX_ATTEMPTS) {
      return { state: 'terminal', execution: current };
    }

    const reclaimed = await this.db.aiExternalMcpToolExecution.updateMany({
      where: {
        id: current.id,
        attemptCount: current.attemptCount,
        OR: [
          { status: ExternalMcpToolExecutionStatus.FAILED },
          {
            status: ExternalMcpToolExecutionStatus.RUNNING,
            leaseExpiresAt: { lte: now },
          },
        ],
      },
      data: {
        status: ExternalMcpToolExecutionStatus.RUNNING,
        actorId: input.actorId,
        risk: input.risk,
        attemptCount: { increment: 1 },
        leaseId,
        leaseExpiresAt,
        startedAt: now,
        completedAt: null,
        errorCode: null,
        resultFingerprint: null,
        encryptedResult: null,
        remoteOperationId: null,
        remoteState: null,
        remoteDeadlineAt: null,
        nextPollAt: null,
        pollAttemptCount: 0,
      },
    });
    const execution = await this.getToolExecution(
      input.connection.id,
      input.idempotencyKey
    );
    if (!execution) {
      throw new Error('SparkClaw tool execution disappeared while claiming');
    }
    return reclaimed.count === 1
      ? { state: 'claimed', execution }
      : { state: 'in_progress', execution };
  }

  async completeToolExecution(input: {
    id: string;
    leaseId: string;
    resultFingerprint: string;
    encryptedResult: string;
    remoteOperationId?: string;
    remoteState?: string;
  }) {
    const completedAt = new Date();
    const updated = await this.db.aiExternalMcpToolExecution.updateMany({
      where: {
        id: input.id,
        status: ExternalMcpToolExecutionStatus.RUNNING,
        leaseId: input.leaseId,
      },
      data: {
        status: ExternalMcpToolExecutionStatus.COMPLETED,
        resultFingerprint: input.resultFingerprint,
        encryptedResult: input.encryptedResult,
        ...(input.remoteOperationId
          ? { remoteOperationId: input.remoteOperationId }
          : {}),
        ...(input.remoteState ? { remoteState: input.remoteState } : {}),
        nextPollAt: null,
        leaseId: null,
        leaseExpiresAt: null,
        completedAt,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        'SparkClaw tool execution lease changed before completion'
      );
    }
  }

  async failToolExecution(input: {
    id: string;
    leaseId: string;
    status: 'FAILED' | 'CANCELLED';
    errorCode: string;
    remoteOperationId?: string;
    remoteState?: string;
  }) {
    const updated = await this.db.aiExternalMcpToolExecution.updateMany({
      where: {
        id: input.id,
        status: ExternalMcpToolExecutionStatus.RUNNING,
        leaseId: input.leaseId,
      },
      data: {
        status: input.status,
        errorCode: input.errorCode,
        ...(input.remoteOperationId
          ? { remoteOperationId: input.remoteOperationId }
          : {}),
        ...(input.remoteState ? { remoteState: input.remoteState } : {}),
        nextPollAt: null,
        leaseId: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new Error('SparkClaw tool execution lease changed before failure');
    }
  }

  @Transactional()
  async finalizeToolExecutionPending(input: {
    connection: Pick<AiExternalMcpConnection, 'id' | 'workspaceId'>;
    actorId: string;
    id: string;
    leaseId: string;
    remoteOperationId: string;
    remoteState: 'running' | 'approval_required';
    remoteDeadlineAt: Date | null;
    nextPollAt: Date;
    metadata: Record<string, unknown>;
  }) {
    const status =
      input.remoteState === 'approval_required'
        ? ExternalMcpToolExecutionStatus.APPROVAL_REQUIRED
        : ExternalMcpToolExecutionStatus.PENDING;
    const updated = await this.db.aiExternalMcpToolExecution.updateMany({
      where: {
        id: input.id,
        status: ExternalMcpToolExecutionStatus.RUNNING,
        leaseId: input.leaseId,
      },
      data: {
        status,
        remoteOperationId: input.remoteOperationId,
        remoteState: input.remoteState,
        remoteDeadlineAt: input.remoteDeadlineAt,
        nextPollAt: input.nextPollAt,
        leaseId: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        'SparkClaw tool execution lease changed before pending state was saved'
      );
    }
    const connection = await this.recordSuccess(input.connection.id, true);
    await this.addAudit({
      connection,
      actorId: input.actorId,
      eventType:
        input.remoteState === 'approval_required'
          ? 'tool_remote_approval_required'
          : 'tool_remote_pending',
      status,
      metadata: input.metadata,
    });
  }

  listDueRemoteOperations(input: { limit: number; now?: Date }) {
    const now = input.now ?? new Date();
    return this.db.aiExternalMcpToolExecution.findMany({
      where: {
        remoteOperationId: { not: null },
        OR: [
          {
            status: {
              in: [
                ExternalMcpToolExecutionStatus.PENDING,
                ExternalMcpToolExecutionStatus.APPROVAL_REQUIRED,
              ],
            },
            nextPollAt: { lte: now },
          },
          {
            status: ExternalMcpToolExecutionStatus.RUNNING,
            leaseExpiresAt: { lte: now },
          },
        ],
      },
      include: { connection: true },
      orderBy: [{ nextPollAt: 'asc' }, { updatedAt: 'asc' }],
      take: input.limit,
    });
  }

  async claimRemoteOperationPoll(id: string, now = new Date()) {
    const current = await this.db.aiExternalMcpToolExecution.findUnique({
      where: { id },
      include: { connection: true },
    });
    if (!current?.remoteOperationId) {
      return null;
    }
    const awaiting = new Set<ExternalMcpToolExecutionStatus>([
      ExternalMcpToolExecutionStatus.PENDING,
      ExternalMcpToolExecutionStatus.APPROVAL_REQUIRED,
    ]).has(current.status);
    const expiredLease =
      current.status === ExternalMcpToolExecutionStatus.RUNNING &&
      !!current.leaseExpiresAt &&
      current.leaseExpiresAt <= now;
    if (!awaiting && !expiredLease) return null;

    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(
      now.getTime() + REMOTE_OPERATION_POLL_LEASE_MS
    );
    const claimed = await this.db.aiExternalMcpToolExecution.updateMany({
      where: {
        id: current.id,
        status: current.status,
        ...(awaiting
          ? { nextPollAt: { lte: now } }
          : { leaseExpiresAt: current.leaseExpiresAt }),
      },
      data: {
        status: ExternalMcpToolExecutionStatus.RUNNING,
        leaseId,
        leaseExpiresAt,
        nextPollAt: null,
        ...(current.pollAttemptCount < REMOTE_OPERATION_MAX_POLL_ATTEMPTS
          ? { pollAttemptCount: { increment: 1 } }
          : {}),
      },
    });
    if (claimed.count !== 1) return null;
    return await this.db.aiExternalMcpToolExecution.findUnique({
      where: { id: current.id },
      include: { connection: true },
    });
  }

  async rescheduleRemoteOperation(input: {
    id: string;
    leaseId: string;
    remoteState: 'running' | 'approval_required';
    nextPollAt: Date;
  }) {
    const status =
      input.remoteState === 'approval_required'
        ? ExternalMcpToolExecutionStatus.APPROVAL_REQUIRED
        : ExternalMcpToolExecutionStatus.PENDING;
    const updated = await this.db.aiExternalMcpToolExecution.updateMany({
      where: {
        id: input.id,
        status: ExternalMcpToolExecutionStatus.RUNNING,
        leaseId: input.leaseId,
      },
      data: {
        status,
        remoteState: input.remoteState,
        nextPollAt: input.nextPollAt,
        leaseId: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      throw new Error('SparkClaw remote operation poll lease changed');
    }
  }

  @Transactional()
  async finalizeToolExecutionSuccess(input: {
    connection: Pick<AiExternalMcpConnection, 'id' | 'workspaceId'>;
    actorId: string | null;
    id: string;
    leaseId: string;
    resultFingerprint: string;
    encryptedResult: string;
    remoteOperationId?: string;
    remoteState?: string;
    metadata: Record<string, unknown>;
  }) {
    await this.completeToolExecution(input);
    const connection = await this.recordSuccess(input.connection.id, true);
    await this.addAudit({
      connection,
      actorId: input.actorId,
      eventType: 'tool_succeeded',
      status: 'COMPLETED',
      metadata: input.metadata,
    });
  }

  @Transactional()
  async finalizeToolExecutionFailure(input: {
    connection: Pick<AiExternalMcpConnection, 'id' | 'workspaceId'>;
    actorId: string | null;
    id: string;
    leaseId: string;
    status: 'FAILED' | 'CANCELLED';
    errorCode: string;
    errorMessage: string;
    remoteOperationId?: string;
    remoteState?: string;
    connectionStatus?: ExternalMcpConnectionStatus;
    metadata: Record<string, unknown>;
  }) {
    await this.failToolExecution(input);
    const connection = input.connectionStatus
      ? await this.recordFailure(
          input.connection.id,
          input.connectionStatus,
          input.errorCode,
          input.errorMessage
        )
      : input.connection;
    await this.addAudit({
      connection,
      actorId: input.actorId,
      eventType: input.connectionStatus
        ? 'tool_connection_failed'
        : input.status === 'CANCELLED'
          ? 'tool_cancelled'
          : 'tool_failed',
      status: input.connectionStatus ?? input.status,
      metadata: input.metadata,
    });
  }
}
