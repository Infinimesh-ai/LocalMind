import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  type AiEnterpriseConnection,
  EnterpriseAuthorizationStatus,
  EnterpriseConnectionStatus,
  EnterpriseConnectionTransport,
  type EnterpriseProvider,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

export type EnterpriseToolCatalogRecord = {
  name: string;
  command: string[];
  description?: string;
  inputSchema: Record<string, unknown>;
  risk: 'read' | 'write' | 'high';
  requiresConfirmation: boolean;
  supportsDryRun: boolean;
};

@Injectable()
export class CopilotEnterpriseConnectionModel extends BaseModel {
  create(input: {
    workspaceId: string;
    userId: string;
    provider: EnterpriseProvider;
    name: string;
    profileKey: string;
  }) {
    return this.db.aiEnterpriseConnection.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        provider: input.provider,
        transport: EnterpriseConnectionTransport.CLI,
        name: input.name,
        profileKey: input.profileKey,
      },
    });
  }

  get(id: string, workspaceId: string, userId: string) {
    return this.db.aiEnterpriseConnection.findFirst({
      where: { id, workspaceId, userId, deletedAt: null },
    });
  }

  listForUser(workspaceId: string, userId: string) {
    return this.db.aiEnterpriseConnection.findMany({
      where: { workspaceId, userId, deletedAt: null },
      orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listActiveForUser(workspaceId: string, userId: string) {
    return this.db.aiEnterpriseConnection.findMany({
      where: {
        workspaceId,
        userId,
        status: EnterpriseConnectionStatus.ACTIVE,
        activeAuthorizationSessionId: null,
        deletedAt: null,
      },
      orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Transactional()
  async saveCatalog(input: {
    id: string;
    authorizationSessionId?: string;
    catalog: EnterpriseToolCatalogRecord[];
    fingerprint: string;
    enabledToolNames: string[];
    externalTenantId?: string;
    externalUserId?: string;
    identityType?: string;
    expiresAt?: Date;
  }) {
    const updated = await this.db.aiEnterpriseConnection.updateMany({
      where: {
        id: input.id,
        status: { not: EnterpriseConnectionStatus.DISABLED },
        activeAuthorizationSessionId: input.authorizationSessionId ?? null,
        deletedAt: null,
      },
      data: {
        status: input.authorizationSessionId
          ? EnterpriseConnectionStatus.CONNECTING
          : EnterpriseConnectionStatus.ACTIVE,
        toolCatalog: input.catalog as Prisma.InputJsonValue,
        toolCatalogFingerprint: input.fingerprint,
        enabledToolNames: input.enabledToolNames,
        externalTenantId: input.externalTenantId,
        externalUserId: input.externalUserId,
        identityType: input.identityType,
        expiresAt: input.expiresAt,
        lastConnectedAt: new Date(),
        lastCheckedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (!updated.count) {
      throw new Error('Enterprise connection was disabled during refresh');
    }
    return await this.db.aiEnterpriseConnection.findUniqueOrThrow({
      where: { id: input.id },
    });
  }

  updateEnabledTools(id: string, enabledToolNames: string[]) {
    return this.db.aiEnterpriseConnection.update({
      where: { id },
      data: { enabledToolNames },
    });
  }

  recordSuccess(id: string, used = false) {
    const now = new Date();
    return this.db.aiEnterpriseConnection.updateMany({
      where: {
        id,
        status: { not: EnterpriseConnectionStatus.DISABLED },
        activeAuthorizationSessionId: null,
        deletedAt: null,
      },
      data: {
        status: EnterpriseConnectionStatus.ACTIVE,
        lastCheckedAt: now,
        ...(used ? { lastUsedAt: now } : {}),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  recordFailure(
    id: string,
    status: EnterpriseConnectionStatus,
    code: string,
    message: string
  ) {
    return this.db.aiEnterpriseConnection.updateMany({
      where: {
        id,
        status: { not: EnterpriseConnectionStatus.DISABLED },
        activeAuthorizationSessionId: null,
        deletedAt: null,
      },
      data: {
        status,
        lastCheckedAt: new Date(),
        lastErrorCode: code,
        lastErrorMessage: message,
      },
    });
  }

  @Transactional()
  async disable(id: string) {
    await this.db.aiEnterpriseAuthorizationSession.updateMany({
      where: {
        connectionId: id,
        status: {
          in: [
            EnterpriseAuthorizationStatus.PENDING,
            EnterpriseAuthorizationStatus.STARTING,
            EnterpriseAuthorizationStatus.WAITING,
          ],
        },
      },
      data: {
        status: EnterpriseAuthorizationStatus.CANCELLED,
        completedAt: new Date(),
      },
    });
    return await this.db.aiEnterpriseConnection.update({
      where: { id },
      data: {
        status: EnterpriseConnectionStatus.DISABLED,
        activeAuthorizationSessionId: null,
        enabledToolNames: [],
      },
    });
  }

  softDelete(id: string) {
    return this.db.aiEnterpriseConnection.update({
      where: { id },
      data: {
        status: EnterpriseConnectionStatus.DISABLED,
        activeAuthorizationSessionId: null,
        enabledToolNames: [],
        deletedAt: new Date(),
      },
    });
  }

  addAudit(input: {
    connection: Pick<AiEnterpriseConnection, 'id' | 'workspaceId'>;
    actorId: string | null;
    eventType: string;
    status: string;
    toolName?: string;
    risk?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.db.aiEnterpriseAuditEvent.create({
      data: {
        connectionId: input.connection.id,
        workspaceId: input.connection.workspaceId,
        actorId: input.actorId,
        eventType: input.eventType,
        status: input.status,
        toolName: input.toolName,
        risk: input.risk,
        idempotencyKey: input.idempotencyKey,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
