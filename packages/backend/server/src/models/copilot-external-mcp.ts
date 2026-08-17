import { Injectable } from '@nestjs/common';
import {
  type AiExternalMcpConnection,
  ExternalMcpConnectionStatus,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

export type ExternalMcpToolRecord = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

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
}
