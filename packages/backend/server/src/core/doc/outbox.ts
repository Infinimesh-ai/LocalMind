import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';

import { EventBus, JobQueue } from '../../base';
import { Models } from '../../models';

@Injectable()
export class WorkspaceDocOutboxPublisher {
  private readonly logger = new Logger(WorkspaceDocOutboxPublisher.name);
  constructor(
    private readonly models: Models,
    private readonly events: EventBus,
    private readonly queue: JobQueue,
    private readonly cls: ClsService
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async publish() {
    try {
      await this.models.workspaceDocOutbox.deliverBatch(async row => {
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
      });
    } catch {
      // Rows remain durable for a subsequent tick; no body or raw DB error in logs.
      this.logger.warn('Workspace document outbox delivery deferred');
    }
  }
}
