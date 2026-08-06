import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Config, OnJob, URLHelper } from '../../base';
import { ClaimedNotificationDelivery, DocMode, Models } from '../../models';
import { generateDocPath } from '../utils/doc';
import { IscpControllerClient } from './client';

declare global {
  interface Jobs {
    'notification.deliverSparkClaw': Record<string, never>;
  }
}

@Injectable()
export class IscpDeliveryJob {
  private readonly logger = new Logger(IscpDeliveryJob.name);
  private readonly workerId = `iscp-delivery-${process.pid}-${randomUUID()}`;

  constructor(
    private readonly config: Config,
    private readonly models: Models,
    private readonly url: URLHelper,
    private readonly controller: IscpControllerClient
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scanPendingDeliveries() {
    await this.processPendingDeliveries();
  }

  @OnJob('notification.deliverSparkClaw')
  async onDeliverySignal() {
    await this.processPendingDeliveries();
  }

  async processPendingDeliveries(batchSize = 20) {
    if (!this.config.iscp.enabled) return 0;
    const deliveries = await this.models.iscp.claimReadyDeliveries(
      this.workerId,
      { batchSize, leaseMs: 60_000 }
    );
    await Promise.all(
      deliveries.map(delivery => this.processDelivery(delivery))
    );
    return deliveries.length;
  }

  private async processDelivery(delivery: ClaimedNotificationDelivery) {
    const settings = await this.models.userSettings.get(
      delivery.notification.userId
    );
    if (!settings.receiveSparkClawNotifications) {
      await this.models.iscp.markDeliveryTerminal(
        delivery.id,
        this.workerId,
        'skipped',
        'recipient_disabled'
      );
      return;
    }
    const content = this.notificationContent(delivery);
    if (!content) {
      await this.models.iscp.markDeliveryTerminal(
        delivery.id,
        this.workerId,
        'skipped',
        'unsupported_notification'
      );
      return;
    }
    try {
      const result = await this.controller.deliver({
        delivery_id: delivery.id,
        device_id: delivery.endpoint.deviceId,
        session_id: delivery.endpoint.sparkSessionId ?? undefined,
        content,
      });
      if (!result.accepted)
        throw new Error('SparkClaw did not accept delivery');
      await this.models.iscp.updateEndpointDelivery(delivery.endpoint.id, {
        sparkSessionId: result.session_id,
        lastSeenAt: new Date(),
        status: 'active',
      });
      await this.models.iscp.markDeliveryDelivered(
        delivery.id,
        this.workerId,
        result.operation_id ?? null
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        error instanceof Error &&
        'retryable' in error &&
        error.retryable === false
          ? false
          : true;
      if (!retryable || delivery.attempts >= delivery.maxAttempts) {
        await this.models.iscp.markDeliveryTerminal(
          delivery.id,
          this.workerId,
          'failed',
          message
        );
      } else {
        const delayMs = Math.min(
          60 * 60 * 1000,
          30_000 * 2 ** Math.max(0, delivery.attempts - 1)
        );
        await this.models.iscp.markDeliveryRetry(
          delivery.id,
          this.workerId,
          new Date(Date.now() + delayMs),
          message
        );
      }
      await this.models.iscp.updateEndpointDelivery(delivery.endpoint.id, {
        status: 'offline',
      });
      this.logger.warn(`SparkClaw delivery ${delivery.id} failed: ${message}`);
    }
  }

  private notificationContent(delivery: ClaimedNotificationDelivery) {
    if (
      delivery.notification.type !== 'Mention' &&
      delivery.notification.type !== 'CommentMention'
    ) {
      return null;
    }
    const body = delivery.notification.body as {
      workspaceId?: string;
      commentId?: string;
      replyId?: string;
      doc?: {
        id?: string;
        mode?: DocMode;
        blockId?: string;
        elementId?: string;
      };
    };
    if (!body.workspaceId || !body.doc?.id || !body.doc.mode) return null;
    const link = this.url.link(
      generateDocPath({
        workspaceId: body.workspaceId,
        docId: body.doc.id,
        mode: body.doc.mode,
        blockId: body.doc.blockId,
        elementId: body.doc.elementId,
        commentId: body.commentId,
        replyId: body.replyId,
      })
    );
    const kind =
      delivery.notification.type === 'CommentMention'
        ? 'comment mention'
        : 'document mention';
    return `LocalMind ${kind}: you have a new mention. Open it at ${link}. This is a notification only; do not modify data or call tools.`;
  }
}
