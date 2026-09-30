import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { JOB_SIGNAL, JobQueue, OnJob } from '../../base';
import { Models } from '../../models';
import { OfficeArtifactService } from './artifact-service';
import { nativeFileSearchText } from './file-content';
import {
  OFFICE_FORMATS,
  officePackageSearchText,
  readNativeOfficeState,
} from './formats';
import { WorkspaceNativeResourceService } from './workspace-resource-service';

declare global {
  interface Jobs {
    'indexer.workspaceNativeResources.index': { after?: string };
  }
}

@Injectable()
export class WorkspaceNativeResourceIndexer {
  private readonly logger = new Logger(WorkspaceNativeResourceIndexer.name);
  constructor(
    private readonly models: Models,
    private readonly files: WorkspaceNativeResourceService,
    private readonly office: OfficeArtifactService,
    private readonly jobs: JobQueue
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async schedule() {
    await this.jobs.add(
      'indexer.workspaceNativeResources.index',
      {},
      { jobId: 'workspace-native-index', removeOnComplete: true }
    );
  }

  @OnJob('indexer.workspaceNativeResources.index')
  async run(input: Jobs['indexer.workspaceNativeResources.index']) {
    const rows = await this.models.workspaceNativeResource.pendingIndexes(
      input.after
    );
    for (const row of rows) {
      try {
        if (row.kind === 'file') {
          const file = await this.files.read(row);
          await this.models.workspaceNativeResource.index({
            ...row,
            sequence: file.contentVersion,
            text: nativeFileSearchText(file.bytes, file.title),
          });
        } else {
          const artifact = await this.office.get(
            row.workspaceId,
            row.actorId,
            row.resourceId
          );
          const asset = await this.office.readRevisionAsset(
            row.workspaceId,
            row.actorId,
            row.resourceId,
            artifact.revision.id,
            'package'
          );
          const format = Object.values(OFFICE_FORMATS).find(
            format => format.kind === artifact.artifact.kind
          );
          if (!format) throw new Error('Unsupported native Office kind');
          const text = await officePackageSearchText(
            await readNativeOfficeState(format, asset.bytes),
            asset.bytes
          );
          await this.models.workspaceNativeResource.index({
            ...row,
            sequence: artifact.revision.sequence,
            text,
          });
        }
      } catch {
        // Keep the revision pending. Continuation visits later rows before the next retry scan.
        this.logger.warn('Workspace native content indexing deferred');
      }
    }
    if (rows.length === 20)
      await this.jobs.add('indexer.workspaceNativeResources.index', {
        after: rows[19].cursor,
      });
    return JOB_SIGNAL.Done;
  }
}
