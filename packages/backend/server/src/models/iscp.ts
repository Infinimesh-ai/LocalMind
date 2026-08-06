import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BaseModel } from './base';

export interface ClaimedNotificationDelivery {
  id: string;
  notificationId: string;
  endpointId: string;
  attempts: number;
  maxAttempts: number;
  notification: {
    id: string;
    type: string;
    body: unknown;
    userId: string;
  };
  endpoint: {
    id: string;
    deviceId: string;
    sparkSessionId: string | null;
    userId: string;
  };
}

@Injectable()
export class IscpModel extends BaseModel {
  @Transactional()
  async createEnrollment(input: {
    userId: string;
    pairingTokenHash: string;
    deviceId: string;
    expiresAt: Date;
  }) {
    await this.db.iscpEnrollment.updateMany({
      where: { userId: input.userId, status: 'pending' },
      data: { status: 'revoked' },
    });
    return await this.db.iscpEnrollment.create({ data: input });
  }

  async getEnrollmentByTokenHash(pairingTokenHash: string) {
    return await this.db.iscpEnrollment.findUnique({
      where: { pairingTokenHash },
    });
  }

  @Transactional()
  async completeEnrollment(input: {
    enrollmentId: string;
    userId: string;
    deviceId: string;
    domainId: string;
    identity: Prisma.InputJsonValue;
    thumbprint: string;
    request: Prisma.InputJsonValue;
  }) {
    const consumed = await this.db.iscpEnrollment.updateMany({
      where: {
        id: input.enrollmentId,
        userId: input.userId,
        deviceId: input.deviceId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      data: {
        status: 'enrolled',
        request: input.request,
        bundleDownloadedAt: new Date(),
      },
    });
    if (consumed.count !== 1) {
      throw new Error('Pairing token is invalid, expired, or already used');
    }
    const endpoint = await this.db.iscpAgentEndpoint.upsert({
      where: { deviceId: input.deviceId },
      create: {
        userId: input.userId,
        deviceId: input.deviceId,
        domainId: input.domainId,
        identity: input.identity,
        thumbprint: input.thumbprint,
        status: 'active',
      },
      update: {
        userId: input.userId,
        domainId: input.domainId,
        identity: input.identity,
        thumbprint: input.thumbprint,
        status: 'active',
        revokedAt: null,
      },
    });
    return endpoint;
  }

  async listEndpoints(userId: string) {
    return await this.db.iscpAgentEndpoint.findMany({
      where: { userId, status: { not: 'revoked' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEndpoint(userId: string, endpointId: string) {
    return await this.db.iscpAgentEndpoint.findFirst({
      where: { id: endpointId, userId },
    });
  }

  @Transactional()
  async revokeEndpoint(userId: string, endpointId: string) {
    const endpoint = await this.db.iscpAgentEndpoint.update({
      where: { id: endpointId, userId },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    await this.db.notificationDelivery.updateMany({
      where: {
        endpointId,
        status: { in: ['pending', 'processing', 'retrying'] },
      },
      data: {
        status: 'skipped',
        lockedBy: null,
        lockedUntil: null,
        lastError: 'endpoint_revoked',
      },
    });
    return endpoint;
  }

  async updateEndpointDelivery(
    endpointId: string,
    input: { sparkSessionId?: string; lastSeenAt?: Date; status?: string }
  ) {
    return await this.db.iscpAgentEndpoint.updateMany({
      where: { id: endpointId, status: { not: 'revoked' } },
      data: input,
    });
  }

  async claimReadyDeliveries(
    workerId: string,
    options: { batchSize: number; leaseMs: number }
  ): Promise<ClaimedNotificationDelivery[]> {
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE notification_deliveries
      SET status = 'processing',
          attempts = attempts + CASE WHEN status = 'processing' THEN 0 ELSE 1 END,
          locked_by = ${workerId},
          locked_until = now() + (${options.leaseMs}::text || ' milliseconds')::interval,
          updated_at = now()
      WHERE id IN (
        SELECT id
        FROM notification_deliveries
        WHERE (
            (status IN ('pending', 'retrying') AND attempts < max_attempts)
            OR (status = 'processing' AND locked_until < now() AND attempts <= max_attempts)
          )
          AND next_attempt_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY next_attempt_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${options.batchSize}
      )
      RETURNING id
    `;
    if (!rows.length) return [];
    return (await this.db.notificationDelivery.findMany({
      where: { id: { in: rows.map(row => row.id) } },
      include: {
        notification: {
          select: { id: true, type: true, body: true, userId: true },
        },
        endpoint: {
          select: {
            id: true,
            deviceId: true,
            sparkSessionId: true,
            userId: true,
          },
        },
      },
    })) as ClaimedNotificationDelivery[];
  }

  async markDeliveryDelivered(
    id: string,
    workerId: string,
    operationId: string | null
  ) {
    await this.db.notificationDelivery.updateMany({
      where: { id, status: 'processing', lockedBy: workerId },
      data: {
        status: 'delivered',
        operationId,
        deliveredAt: new Date(),
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
      },
    });
  }

  async markDeliveryRetry(
    id: string,
    workerId: string,
    nextAttemptAt: Date,
    error: string
  ) {
    await this.db.notificationDelivery.updateMany({
      where: { id, status: 'processing', lockedBy: workerId },
      data: {
        status: 'retrying',
        nextAttemptAt,
        lockedBy: null,
        lockedUntil: null,
        lastError: error.slice(0, 2000),
      },
    });
  }

  async markDeliveryTerminal(
    id: string,
    workerId: string,
    status: 'failed' | 'skipped',
    error: string
  ) {
    await this.db.notificationDelivery.updateMany({
      where: { id, status: 'processing', lockedBy: workerId },
      data: {
        status,
        lockedBy: null,
        lockedUntil: null,
        lastError: error.slice(0, 2000),
      },
    });
  }
}
