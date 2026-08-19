import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  EnterpriseAuthorizationStatus,
  EnterpriseConnectionStatus,
  type EnterpriseProvider,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

const ACTIVE_STATUSES = [
  EnterpriseAuthorizationStatus.PENDING,
  EnterpriseAuthorizationStatus.STARTING,
  EnterpriseAuthorizationStatus.WAITING,
];

@Injectable()
export class CopilotEnterpriseAuthorizationModel extends BaseModel {
  @Transactional()
  async create(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
    provider: EnterpriseProvider;
    expiresAt: Date;
  }) {
    await this.db.aiEnterpriseAuthorizationSession.updateMany({
      where: {
        connectionId: input.connectionId,
        status: { in: ACTIVE_STATUSES },
      },
      data: {
        status: EnterpriseAuthorizationStatus.CANCELLED,
        completedAt: new Date(),
      },
    });
    const session = await this.db.aiEnterpriseAuthorizationSession.create({
      data: input,
    });
    const connection = await this.db.aiEnterpriseConnection.updateMany({
      where: {
        id: input.connectionId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        provider: input.provider,
        deletedAt: null,
      },
      data: {
        status: EnterpriseConnectionStatus.CONNECTING,
        activeAuthorizationSessionId: session.id,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    if (!connection.count) {
      throw new Error('Enterprise connection is unavailable for authorization');
    }
    return session;
  }

  get(id: string, workspaceId: string, userId: string) {
    return this.db.aiEnterpriseAuthorizationSession.findFirst({
      where: { id, workspaceId, userId },
    });
  }

  getForUser(id: string, userId: string) {
    return this.db.aiEnterpriseAuthorizationSession.findFirst({
      where: { id, userId },
      include: { connection: true },
    });
  }

  getWithConnection(id: string) {
    return this.db.aiEnterpriseAuthorizationSession.findUnique({
      where: { id },
      include: { connection: true },
    });
  }

  latest(connectionId: string, workspaceId: string, userId: string) {
    return this.db.aiEnterpriseAuthorizationSession.findFirst({
      where: { connectionId, workspaceId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  active(connectionId: string) {
    return this.db.aiEnterpriseAuthorizationSession.findFirst({
      where: { connectionId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
  }

  markStarting(id: string) {
    return this.transition(id, [EnterpriseAuthorizationStatus.PENDING], {
      status: EnterpriseAuthorizationStatus.STARTING,
      startedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  }

  markWaiting(
    id: string,
    input: {
      authorizationUrl?: string | null;
      userCode?: string | null;
      qrCodePath?: string | null;
      expiresAt?: Date;
    }
  ) {
    return this.transition(id, ACTIVE_STATUSES, {
      status: EnterpriseAuthorizationStatus.WAITING,
      authorizationUrl: input.authorizationUrl,
      userCode: input.userCode,
      qrCodePath: input.qrCodePath,
      expiresAt: input.expiresAt,
    });
  }

  @Transactional()
  async markAuthorized(id: string, connectionId: string) {
    const session = await this.transition(id, ACTIVE_STATUSES, {
      status: EnterpriseAuthorizationStatus.AUTHORIZED,
      completedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    if (!session.count) return session;
    return await this.db.aiEnterpriseConnection.updateMany({
      where: {
        id: connectionId,
        activeAuthorizationSessionId: id,
        status: EnterpriseConnectionStatus.CONNECTING,
        deletedAt: null,
      },
      data: {
        status: EnterpriseConnectionStatus.ACTIVE,
        activeAuthorizationSessionId: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  @Transactional()
  async markFailed(
    id: string,
    connectionId: string,
    code: string,
    message: string
  ) {
    const session = await this.transition(id, ACTIVE_STATUSES, {
      status: EnterpriseAuthorizationStatus.FAILED,
      completedAt: new Date(),
      lastErrorCode: code,
      lastErrorMessage: message,
    });
    if (!session.count) return session;
    await this.failConnection(id, connectionId, code, message);
    return session;
  }

  @Transactional()
  async markExpired(id: string, connectionId: string) {
    const session = await this.transition(id, ACTIVE_STATUSES, {
      status: EnterpriseAuthorizationStatus.EXPIRED,
      completedAt: new Date(),
    });
    if (!session.count) return session;
    await this.failConnection(
      id,
      connectionId,
      'enterprise_authorization_expired',
      'Enterprise authorization expired'
    );
    return session;
  }

  @Transactional()
  async cancel(id: string, workspaceId: string, userId: string) {
    const session = await this.db.aiEnterpriseAuthorizationSession.updateMany({
      where: {
        id,
        workspaceId,
        userId,
        status: { in: ACTIVE_STATUSES },
      },
      data: {
        status: EnterpriseAuthorizationStatus.CANCELLED,
        completedAt: new Date(),
      },
    });
    if (!session.count) return session;
    await this.db.aiEnterpriseConnection.updateMany({
      where: {
        activeAuthorizationSessionId: id,
        status: { not: EnterpriseConnectionStatus.DISABLED },
        deletedAt: null,
      },
      data: {
        status: EnterpriseConnectionStatus.REAUTH_REQUIRED,
        activeAuthorizationSessionId: null,
        lastCheckedAt: new Date(),
        lastErrorCode: 'enterprise_authorization_cancelled',
        lastErrorMessage: 'Enterprise authorization was cancelled',
      },
    });
    return session;
  }

  private failConnection(
    sessionId: string,
    connectionId: string,
    code: string,
    message: string
  ) {
    return this.db.aiEnterpriseConnection.updateMany({
      where: {
        id: connectionId,
        activeAuthorizationSessionId: sessionId,
        status: { not: EnterpriseConnectionStatus.DISABLED },
        deletedAt: null,
      },
      data: {
        status: EnterpriseConnectionStatus.REAUTH_REQUIRED,
        activeAuthorizationSessionId: null,
        lastCheckedAt: new Date(),
        lastErrorCode: code,
        lastErrorMessage: message,
      },
    });
  }

  private transition(
    id: string,
    from: EnterpriseAuthorizationStatus[],
    data: Prisma.AiEnterpriseAuthorizationSessionUpdateManyMutationInput
  ) {
    return this.db.aiEnterpriseAuthorizationSession.updateMany({
      where: { id, status: { in: from } },
      data,
    });
  }
}
