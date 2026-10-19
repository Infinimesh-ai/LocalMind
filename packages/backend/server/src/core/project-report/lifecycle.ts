import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { JobQueue, OnEvent, OnJob } from '../../base';
import { Models } from '../../models';
import type { ReportActor } from '../../models/project-report';
import { StorageRuntimeProvider } from '../storage-runtime';

declare global {
  interface Jobs {
    'nightly.purgeProjectReport': { reportId: string };
  }
}

@Injectable()
export class ProjectReportLifecycleService {
  private readonly logger = new Logger(ProjectReportLifecycleService.name);
  constructor(
    private readonly models: Models,
    private readonly queue: JobQueue,
    private readonly storage: StorageRuntimeProvider
  ) {}

  async permanentlyDelete(
    input: ReportActor & { expectedVersion: number; requestKey: string }
  ) {
    const deletion = await this.models.projectReportLifecycle.request(input);
    // The DB is the durable queue authority. A Redis outage must not undo an
    // accepted deletion; the periodic recovery scan will enqueue it again.
    try {
      await this.enqueue(deletion.reportId, deletion.eligibleAt);
    } catch {
      this.logger.warn('Report deletion persisted; queue recovery required');
    }
    return {
      reportId: deletion.reportId,
      status: deletion.status,
      eligibleAt: deletion.eligibleAt,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async recover() {
    for (const row of await this.models.projectReportLifecycle.due()) {
      await this.enqueue(row.reportId);
    }
  }

  private async enqueue(reportId: string, eligibleAt?: Date) {
    await this.queue.add(
      'nightly.purgeProjectReport',
      { reportId },
      {
        jobId: `project-report-purge:${reportId}`,
        delay: eligibleAt ? Math.max(0, eligibleAt.getTime() - Date.now()) : 0,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
      }
    );
  }

  @OnJob('nightly.purgeProjectReport')
  async purge({ reportId }: Jobs['nightly.purgeProjectReport']) {
    const deletion = await this.models.projectReportLifecycle.claim(reportId);
    if (!deletion?.leaseId) return;
    const lease = { reportId, leaseId: deletion.leaseId };
    try {
      if (!(await this.models.projectReportLifecycle.prepare(lease))) return;
      for (let count = 0; count < 100; count++) {
        const changed = await this.models.projectReportLifecycle.deleteNextBlob(
          lease,
          (projectId, key) =>
            this.storage.deleteObject(
              'blob',
              `projects/${encodeURIComponent(projectId)}/${key}`
            )
        );
        if (!changed) break;
      }
      if (!(await this.models.projectReportLifecycle.finish(lease))) {
        await this.models.projectReportLifecycle.retry(lease);
      }
    } catch {
      await this.models.projectReportLifecycle.retry(lease);
      // Do not place source content, storage paths or private provider errors in logs.
      this.logger.warn('Report purge will retry from its durable checkpoint');
    }
  }

  @OnEvent('user.preDelete')
  async pauseDeletedActor({ id }: Events['user.preDelete']) {
    await this.models.projectReportLifecycle.pauseDeletedActor(id);
  }
}
