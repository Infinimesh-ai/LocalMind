import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';

import { JobQueue, OnEvent, OnJob } from '../../base';
import {
  NativeFileCreateSchema,
  NativeFileCreateService,
} from '../../core/office/create-service';
import { Models } from '../../models';
import { WorkOrderStorage } from './work-order-storage';

declare global {
  interface Jobs {
    'copilot.workOrder.deliverOutbox': { limit?: number };
    'copilot.workOrder.cleanupStagedBlobs': { limit?: number };
    'copilot.workOrder.runPrivateFileGeneration': {
      workOrderId?: string;
      runId?: string;
    };
  }
}

const privateFileCommand = z.object({
  requirementId: z.string().trim().min(1).max(256),
  file: NativeFileCreateSchema,
});

@Injectable()
export class WorkOrderJobs {
  private readonly logger = new Logger(WorkOrderJobs.name);

  constructor(
    private readonly models: Models,
    private readonly queue: JobQueue,
    private readonly storage: WorkOrderStorage,
    private readonly files: NativeFileCreateService
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async scheduleOutboxDelivery() {
    await this.queue.add(
      'copilot.workOrder.deliverOutbox',
      { limit: 100 },
      { jobId: 'copilot-work-order-deliver-outbox' }
    );
    await this.queue.add(
      'copilot.workOrder.runPrivateFileGeneration',
      {},
      { jobId: 'copilot-work-order-private-file-generation' }
    );
  }

  @OnJob('copilot.workOrder.runPrivateFileGeneration')
  async runPrivateFileGeneration(
    input: Jobs['copilot.workOrder.runPrivateFileGeneration']
  ) {
    const candidates =
      input.workOrderId && input.runId
        ? [{ workOrderId: input.workOrderId, id: input.runId }]
        : await this.models.copilotWorkOrderAgentRuntime.pendingPrivateFiles(
            50
          );
    for (const candidate of candidates) {
      if (!candidate.workOrderId) continue;
      const workerLeaseId = `work-order-worker-${randomUUID()}`;
      const run =
        await this.models.copilotWorkOrderAgentRuntime.acquirePrivateFile({
          workOrderId: candidate.workOrderId,
          runId: candidate.id,
          workerLeaseId,
        });
      if (!run) continue;
      const lease = {
        workOrderId: run.workOrderId,
        actorId: run.actorId,
        runId: run.id,
        workerLeaseId,
        workerAttempt: run.workerAttempt,
      };
      try {
        const command = privateFileCommand.parse(
          run.steps.find(step => step.stepKey === 'generate_private_file')
            ?.input
        );
        const generated = this.files.generatePrivate(command.file);
        if (
          !(await this.models.copilotWorkOrderAgentRuntime.renewPrivateFile(
            lease
          ))
        ) {
          continue;
        }
        const blob = await this.storage.stage({
          workOrderId: run.workOrderId,
          actorId: run.actorId,
          requirementId: command.requirementId,
          requestKey: run.sourceId,
          fileName: generated.fileName,
          mimeType: generated.mimeType,
          bytes: generated.bytes,
        });
        await this.models.copilotWorkOrderAgentRuntime.completePrivateFile(
          lease,
          {
            workOrderId: run.workOrderId,
            requirementId: command.requirementId,
            blobId: blob.id,
            fileName: blob.fileName,
            mimeType: blob.mimeType,
            byteSize: blob.byteSize,
            fingerprint: blob.fingerprint,
            status: 'staged',
          }
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.slice(0, 1024)
            : 'Work-order file generation failed';
        this.logger.warn({
          message: 'Work-order private file generation failed',
          runId: run.id,
          error: message,
        });
        await this.models.copilotWorkOrderAgentRuntime.failPrivateFile(
          lease,
          'work_order_file_generation_failed',
          message
        );
      }
    }
  }

  @OnJob('copilot.workOrder.deliverOutbox')
  async deliverOutbox(input: Jobs['copilot.workOrder.deliverOutbox']) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    for (let index = 0; index < limit; index++) {
      try {
        if (!(await this.models.copilotWorkOrder.deliverNextOutboxEvent())) {
          return;
        }
      } catch (error) {
        this.logger.warn('Work-order outbox delivery will retry', error);
        return;
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async scheduleStagedBlobCleanup() {
    await this.queue.add(
      'copilot.workOrder.cleanupStagedBlobs',
      { limit: 100 },
      { jobId: 'daily-copilot-work-order-staged-blob-cleanup' }
    );
  }

  @OnEvent('user.preDelete')
  async cleanupUserWorkOrderDrafts({ id }: Events['user.preDelete']) {
    await this.storage.cleanupUserStagedBlobs(id);
  }

  @OnJob('copilot.workOrder.cleanupStagedBlobs')
  async cleanupStagedBlobs(
    input: Jobs['copilot.workOrder.cleanupStagedBlobs']
  ) {
    await this.storage.cleanupExpired(
      Math.min(Math.max(input.limit ?? 100, 1), 500)
    );
  }
}
