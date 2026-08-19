import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type AiEnterpriseAuthorizationSession,
  EnterpriseAuthorizationStatus,
  EnterpriseProvider,
  Prisma,
} from '@prisma/client';

import { JobQueue } from '../../../base';
import { Models } from '../../../models';

const AUTHORIZATION_TTL_MS = 20 * 60 * 1000;
const EXTENDED_AUTHORIZATION_TTL_MS = 30 * 60 * 1000;
const ACTIVE_AUTHORIZATION_STATUSES = new Set<EnterpriseAuthorizationStatus>([
  EnterpriseAuthorizationStatus.PENDING,
  EnterpriseAuthorizationStatus.STARTING,
  EnterpriseAuthorizationStatus.WAITING,
]);

declare global {
  interface Jobs {
    'copilot.enterpriseAuthorization.run': {
      sessionId: string;
    };
  }
}

@Injectable()
export class EnterpriseAuthorizationService {
  private readonly logger = new Logger(EnterpriseAuthorizationService.name);

  constructor(
    private readonly models: Models,
    private readonly queue: JobQueue
  ) {}

  async begin(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
  }) {
    const connection = await this.models.copilotEnterpriseConnection.get(
      input.connectionId,
      input.workspaceId,
      input.userId
    );
    if (!connection) {
      throw new NotFoundException('Enterprise connection not found');
    }

    let session: AiEnterpriseAuthorizationSession;
    try {
      session = await this.models.copilotEnterpriseAuthorization.create({
        connectionId: connection.id,
        workspaceId: connection.workspaceId,
        userId: connection.userId,
        provider: connection.provider,
        expiresAt: new Date(
          Date.now() +
            (connection.provider === EnterpriseProvider.LARK ||
            connection.provider === EnterpriseProvider.DINGTALK
              ? EXTENDED_AUTHORIZATION_TTL_MS
              : AUTHORIZATION_TTL_MS)
        ),
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const active = await this.models.copilotEnterpriseAuthorization.active(
        connection.id
      );
      if (!active) throw error;
      session = active;
    }
    try {
      await this.queue.add(
        'copilot.enterpriseAuthorization.run',
        { sessionId: session.id },
        {
          jobId: session.id,
          attempts: 1,
          delay: 1_500,
          removeOnComplete: true,
          removeOnFail: 100,
        }
      );
    } catch (error) {
      await this.models.copilotEnterpriseAuthorization.markFailed(
        session.id,
        connection.id,
        'enterprise_authorization_enqueue_failed',
        'Enterprise authorization could not be started'
      );
      throw error;
    }
    await this.models.copilotEnterpriseConnection.addAudit({
      connection,
      actorId: input.userId,
      eventType: 'authorization_started',
      status: EnterpriseAuthorizationStatus.PENDING,
      metadata: { provider: connection.provider },
    });
    return session;
  }

  async get(input: { id: string; workspaceId: string; userId: string }) {
    const session = await this.models.copilotEnterpriseAuthorization.get(
      input.id,
      input.workspaceId,
      input.userId
    );
    if (!session) {
      throw new NotFoundException('Enterprise authorization session not found');
    }
    return await this.expireIfNeeded(session);
  }

  async latest(input: {
    connectionId: string;
    workspaceId: string;
    userId: string;
  }) {
    const connection = await this.models.copilotEnterpriseConnection.get(
      input.connectionId,
      input.workspaceId,
      input.userId
    );
    if (!connection) {
      throw new NotFoundException('Enterprise connection not found');
    }
    const session = await this.models.copilotEnterpriseAuthorization.latest(
      connection.id,
      input.workspaceId,
      input.userId
    );
    return session ? await this.expireIfNeeded(session) : null;
  }

  async cancel(input: { id: string; workspaceId: string; userId: string }) {
    const session = await this.get(input);
    if (!ACTIVE_AUTHORIZATION_STATUSES.has(session.status)) return session;

    const cancelled = await this.models.copilotEnterpriseAuthorization.cancel(
      session.id,
      input.workspaceId,
      input.userId
    );
    if (!cancelled.count) return await this.get(input);
    try {
      await this.queue.remove(
        session.id,
        'copilot.enterpriseAuthorization.run'
      );
    } catch (error) {
      this.logger.warn(
        `Failed to remove cancelled enterprise authorization job ${session.id}: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
    await this.models.copilotEnterpriseConnection.addAudit({
      connection: {
        id: session.connectionId,
        workspaceId: session.workspaceId,
      },
      actorId: input.userId,
      eventType: 'authorization_cancelled',
      status: EnterpriseAuthorizationStatus.CANCELLED,
    });
    return await this.get(input);
  }

  isActive(status: EnterpriseAuthorizationStatus) {
    return ACTIVE_AUTHORIZATION_STATUSES.has(status);
  }

  private async expireIfNeeded(session: AiEnterpriseAuthorizationSession) {
    if (
      this.isActive(session.status) &&
      session.expiresAt.getTime() <= Date.now()
    ) {
      const expired =
        await this.models.copilotEnterpriseAuthorization.markExpired(
          session.id,
          session.connectionId
        );
      if (!expired.count) {
        return (
          (await this.models.copilotEnterpriseAuthorization.get(
            session.id,
            session.workspaceId,
            session.userId
          )) ?? session
        );
      }
      return (
        (await this.models.copilotEnterpriseAuthorization.get(
          session.id,
          session.workspaceId,
          session.userId
        )) ?? session
      );
    }
    return session;
  }
}
