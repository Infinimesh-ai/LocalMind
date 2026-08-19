import { Injectable, Logger } from '@nestjs/common';
import {
  EnterpriseAuthorizationStatus,
  EnterpriseProvider,
} from '@prisma/client';

import { JOB_SIGNAL, OnJob } from '../../../base';
import { Models } from '../../../models';
import { EnterpriseAuthorizationService } from './authorization-service';
import { EnterpriseCliRuntime, EnterpriseCliRuntimeError } from './cli/runtime';
import { EnterpriseCliDriverRegistry } from './driver-registry';
import { EnterpriseConnectionService } from './service';
import type { EnterpriseAuthorizationChallenge } from './types';

const AUTHORIZATION_MONITOR_INTERVAL_MS = 1_000;
const PNG_FILE_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

@Injectable()
export class EnterpriseAuthorizationWorker {
  private readonly logger = new Logger(EnterpriseAuthorizationWorker.name);

  constructor(
    private readonly models: Models,
    private readonly authorizations: EnterpriseAuthorizationService,
    private readonly connections: EnterpriseConnectionService,
    private readonly drivers: EnterpriseCliDriverRegistry,
    private readonly runtime: EnterpriseCliRuntime
  ) {}

  @OnJob('copilot.enterpriseAuthorization.run')
  async run(params: Jobs['copilot.enterpriseAuthorization.run']) {
    const session =
      await this.models.copilotEnterpriseAuthorization.getWithConnection(
        params.sessionId
      );
    if (
      !session ||
      !this.authorizations.isActive(session.status) ||
      session.connection.deletedAt
    ) {
      return JOB_SIGNAL.Done;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.expire(session);
      return JOB_SIGNAL.Done;
    }

    const claimed =
      await this.models.copilotEnterpriseAuthorization.markStarting(session.id);
    if (!claimed.count) return JOB_SIGNAL.Done;

    const abortController = new AbortController();
    let monitorUpdate = Promise.resolve();
    const monitor = setInterval(() => {
      monitorUpdate = monitorUpdate
        .then(async () => {
          const current =
            await this.models.copilotEnterpriseAuthorization.getWithConnection(
              session.id
            );
          if (!current || current.connection.deletedAt) {
            abortController.abort();
            return;
          }
          if (current.expiresAt.getTime() <= Date.now()) {
            await this.expire(current);
            abortController.abort();
            return;
          }
          if (!this.authorizations.isActive(current.status)) {
            abortController.abort();
          }
        })
        .catch(error => {
          this.logger.error(
            `Failed to monitor enterprise authorization ${session.id}`,
            error
          );
          abortController.abort();
        });
    }, AUTHORIZATION_MONITOR_INTERVAL_MS);
    monitor.unref();

    try {
      const driver = this.drivers.get(session.provider);
      const auth = await driver.authorize(session.connection.profileKey, {
        signal: abortController.signal,
        qrCodePath: this.authorizationQrCodePath(session.id),
        onChallenge: async challenge => {
          await this.publishChallenge(session, challenge);
        },
      });
      if (!auth.authorized) {
        throw new Error('Enterprise CLI authorization was not accepted');
      }

      const current =
        await this.models.copilotEnterpriseAuthorization.getWithConnection(
          session.id
        );
      if (
        !current ||
        !this.authorizations.isActive(current.status) ||
        current.expiresAt.getTime() <= Date.now()
      ) {
        if (current && current.expiresAt.getTime() <= Date.now()) {
          await this.expire(current);
        }
        return JOB_SIGNAL.Done;
      }

      await this.connections.refresh({
        connectionId: session.connectionId,
        workspaceId: session.workspaceId,
        userId: session.userId,
        authorizationSessionId: session.id,
        signal: abortController.signal,
      });
      const completed =
        await this.models.copilotEnterpriseAuthorization.markAuthorized(
          session.id,
          session.connectionId
        );
      if (completed.count) {
        await this.models.copilotEnterpriseConnection.addAudit({
          connection: {
            id: session.connectionId,
            workspaceId: session.workspaceId,
          },
          actorId: session.userId,
          eventType: 'authorization_succeeded',
          status: EnterpriseAuthorizationStatus.AUTHORIZED,
          metadata: { provider: session.provider },
        });
      }
    } catch (error) {
      this.logger.error(
        `Enterprise authorization ${session.id} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
      const current =
        await this.models.copilotEnterpriseAuthorization.getWithConnection(
          session.id
        );
      if (current && this.authorizations.isActive(current.status)) {
        if (current.expiresAt.getTime() <= Date.now()) {
          await this.expire(current);
        } else {
          const failure = this.publicFailure(error);
          const failed =
            await this.models.copilotEnterpriseAuthorization.markFailed(
              current.id,
              current.connectionId,
              failure.code,
              failure.message
            );
          if (!failed.count) return JOB_SIGNAL.Done;
          await this.models.copilotEnterpriseConnection.addAudit({
            connection: {
              id: session.connectionId,
              workspaceId: session.workspaceId,
            },
            actorId: session.userId,
            eventType: 'authorization_failed',
            status: EnterpriseAuthorizationStatus.FAILED,
            metadata: { code: failure.code, provider: session.provider },
          });
        }
      }
    } finally {
      clearInterval(monitor);
      await monitorUpdate;
      await this.removeQrCode(session.id);
    }

    return JOB_SIGNAL.Done;
  }

  async readQrCode(sessionId: string, userId: string) {
    const session = await this.models.copilotEnterpriseAuthorization.getForUser(
      sessionId,
      userId
    );
    if (
      !session ||
      session.status !== EnterpriseAuthorizationStatus.WAITING ||
      session.expiresAt.getTime() <= Date.now() ||
      !session.qrCodePath
    ) {
      return null;
    }
    let data: Buffer;
    try {
      data = await this.runtime.readProfileFile(
        session.provider,
        session.connection.profileKey,
        session.qrCodePath
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (
      data.byteLength < PNG_FILE_SIGNATURE.byteLength ||
      !data
        .subarray(0, PNG_FILE_SIGNATURE.byteLength)
        .equals(PNG_FILE_SIGNATURE)
    ) {
      return null;
    }
    return data;
  }

  private async publishChallenge(
    session: {
      id: string;
      provider: EnterpriseProvider;
      expiresAt: Date;
    },
    challenge: EnterpriseAuthorizationChallenge
  ) {
    if (
      !challenge.authorizationUrl &&
      !challenge.userCode &&
      !challenge.qrCodePath &&
      !challenge.clearPrevious
    ) {
      throw new Error(
        'Enterprise CLI returned an empty authorization challenge'
      );
    }
    const authorizationUrl = challenge.authorizationUrl
      ? this.requireOfficialUrl(session.provider, challenge.authorizationUrl)
      : undefined;
    const qrCodePath = challenge.qrCodePath
      ? this.requireQrCodePath(session, challenge.qrCodePath)
      : undefined;
    const expiresAt = challenge.expiresAt
      ? new Date(
          Math.min(challenge.expiresAt.getTime(), session.expiresAt.getTime())
        )
      : undefined;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new Error('Enterprise authorization challenge already expired');
    }
    const userCode = challenge.userCode?.trim().slice(0, 128);
    const updated =
      await this.models.copilotEnterpriseAuthorization.markWaiting(session.id, {
        authorizationUrl: challenge.clearPrevious ? null : authorizationUrl,
        userCode: challenge.clearPrevious ? null : userCode || undefined,
        qrCodePath: challenge.clearPrevious ? null : qrCodePath,
        expiresAt,
      });
    if (!updated.count) {
      throw new EnterpriseCliRuntimeError(
        'enterprise_cli_aborted',
        'Enterprise CLI execution was cancelled'
      );
    }
  }

  private requireOfficialUrl(provider: EnterpriseProvider, raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('Enterprise CLI returned an invalid authorization URL');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Enterprise CLI returned an invalid authorization URL');
    }
    const roots = this.officialDomains(provider);
    const host = url.hostname.toLowerCase();
    if (!roots.some(root => host === root || host.endsWith(`.${root}`))) {
      throw new Error(
        'Enterprise CLI returned an unofficial authorization URL'
      );
    }
    return url.toString();
  }

  private officialDomains(provider: EnterpriseProvider) {
    switch (provider) {
      case EnterpriseProvider.WECOM:
        return ['work.weixin.qq.com'];
      case EnterpriseProvider.LARK:
        return ['feishu.cn', 'larksuite.com'];
      case EnterpriseProvider.DINGTALK:
        return ['dingtalk.com', 'dingtalk.cn', 'dingtalk.io'];
    }
  }

  private requireQrCodePath(
    session: { id: string; provider: EnterpriseProvider },
    path: string
  ) {
    if (
      session.provider !== EnterpriseProvider.WECOM ||
      path !== this.authorizationQrCodePath(session.id)
    ) {
      throw new Error('Enterprise CLI returned an invalid QR code file');
    }
    return path;
  }

  private authorizationQrCodePath(sessionId: string) {
    return `authorization-${sessionId}.png`;
  }

  private async removeQrCode(sessionId: string) {
    const session =
      await this.models.copilotEnterpriseAuthorization.getWithConnection(
        sessionId
      );
    if (!session?.qrCodePath) return;
    try {
      await this.runtime.removeProfileFile(
        session.provider,
        session.connection.profileKey,
        session.qrCodePath
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.logger.warn(
        `Failed to remove enterprise authorization QR code ${session.id}: ${this.publicFailure(error).code}`
      );
    }
  }

  private async expire(session: { id: string; connectionId: string }) {
    const expired =
      await this.models.copilotEnterpriseAuthorization.markExpired(
        session.id,
        session.connectionId
      );
    if (!expired.count) return;
  }

  private publicFailure(error: unknown) {
    if (error instanceof EnterpriseCliRuntimeError) {
      return { code: error.code, message: error.message.slice(0, 500) };
    }
    const message = error instanceof Error ? error.message : '';
    if (message.includes('authorization URL')) {
      return {
        code: 'enterprise_authorization_url_rejected',
        message: message.slice(0, 500),
      };
    }
    if (
      message.includes(
        'CLI data access is not enabled for this organization'
      ) ||
      message.includes('该组织尚未开启 CLI 数据访问权限')
    ) {
      return {
        code: 'enterprise_cli_org_access_disabled',
        message:
          'A DingTalk organization super admin must enable CLI data access before authorization can complete',
      };
    }
    if (
      message.includes('pat_auth_rejected') ||
      message.includes('用户已拒绝授权')
    ) {
      return {
        code: 'enterprise_authorization_rejected',
        message: 'DingTalk CLI permission authorization was rejected',
      };
    }
    if (message.includes('pat_auth_expired') || message.includes('授权超时')) {
      return {
        code: 'enterprise_authorization_expired',
        message: 'DingTalk CLI permission authorization expired',
      };
    }
    return {
      code: 'enterprise_authorization_failed',
      message: 'Enterprise CLI authorization failed',
    };
  }
}
