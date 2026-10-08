import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClsService } from 'nestjs-cls';

import { EventBus, JobQueue } from '../../base';
import { Models } from '../../models';

@Injectable()
export class WorkspaceDocOutboxPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceDocOutboxPublisher.name);
  private scheduled?: NodeJS.Immediate;
  private publishing?: Promise<void>;
  private publishAgain = false;
  private stopped = false;
  constructor(
    private readonly models: Models,
    private readonly events: EventBus,
    private readonly queue: JobQueue,
    private readonly cls: ClsService,
    private readonly transactions: TransactionHost
  ) {}

  /** Called after a lifecycle transaction returns, without delaying its response. */
  requestPublish() {
    // A nested caller may still roll back. Its committed rows are picked up by
    // the periodic publisher, never exposed from the caller's transaction.
    if (
      this.stopped ||
      this.transactions.isTransactionActive() ||
      this.scheduled
    )
      return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      this.cls
        .run({ ifNested: 'override' }, () => this.publish())
        .catch(() => {
          this.logger.warn('Workspace document outbox wakeup deferred');
        });
    });
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  publish() {
    if (this.stopped) return Promise.resolve();
    if (this.publishing) {
      this.publishAgain = true;
      return this.publishing;
    }
    this.publishing = this.deliver().finally(() => {
      this.publishing = undefined;
      if (this.publishAgain) {
        this.publishAgain = false;
        this.requestPublish();
      }
    });
    return this.publishing;
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    await this.publishing;
  }

  private async deliver() {
    try {
      const count = await this.models.workspaceDocOutbox.deliverBatch(
        async row => {
          // Handlers must observe committed data, not the outbox delivery transaction.
          await this.cls.run({ ifNested: 'override' }, async () => {
            await this.events.emitAsync('doc.updates.pushed', {
              spaceType: 'workspace',
              spaceId: row.workspaceId,
              docId: row.docId,
              updates: [row.update],
              timestamp: Number(row.timestamp),
              editor: row.editorId ?? undefined,
            });
            await this.queue.add(
              'doc.mergePendingDocUpdates',
              {
                workspaceId: row.workspaceId,
                docId: row.docId,
              },
              {
                jobId: `doc:merge-pending-updates:${row.workspaceId}:${row.docId}`,
                delay: 5000,
                priority: 100,
              }
            );
          });
        }
      );
      // Drain a backlog in bounded batches without waiting for another cron tick.
      if (count === 50) this.publishAgain = true;
    } catch {
      // Rows remain durable for a subsequent tick; no body or raw DB error in logs.
      this.logger.warn('Workspace document outbox delivery deferred');
    }
  }
}
