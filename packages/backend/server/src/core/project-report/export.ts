import {
  type ReportAudience,
  reportAudienceAssetBindings,
  ReportAudienceSchema,
} from '@localmind/office/report';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { AccessDenied, BadRequest, JobQueue } from '../../base';
import { Models } from '../../models';
import type { ProjectAgentRun } from '../../models/copilot-project-agent-runtime';
import type { ReportActor } from '../../models/project-report';
import {
  reportPage,
  type ReportPageInput,
} from '../../models/project-report-pagination';
import { projectResourceHash } from '../../models/project-resource';
import { OfficeImportService } from '../office';
import { ProjectBlobStorage, ProjectResourceService } from '../project';
import { ProjectReportContentService } from './content';
import type { ReportCommand } from './contracts';
import { renderProjectReport } from './export-renderer';

@Injectable()
export class ProjectReportExportService {
  constructor(
    private readonly models: Models,
    private readonly db: PrismaClient,
    private readonly content: ProjectReportContentService,
    private readonly blobs: ProjectBlobStorage,
    private readonly queue: JobQueue,
    private readonly office: OfficeImportService,
    private readonly resources: ProjectResourceService
  ) {}
  async request(
    input: ReportActor & {
      requestKey: string;
      command: Extract<ReportCommand, { operation: 'export' }>;
    }
  ) {
    const row = await this.models.projectReportExport.request({
      ...input,
      ...input.command,
      fingerprint: projectResourceHash(input.command),
      audience: JSON.parse(JSON.stringify(input.command.audience)),
    });
    if (row.runId && row.status !== 'succeeded')
      await this.queue.add('copilot.projectAgentRuntime.run', {
        projectId: input.projectId,
        runId: row.runId,
      });
    return { exportId: row.id, runId: row.runId };
  }
  async list(input: ReportActor) {
    return (await this.page(input)).items;
  }
  async page(input: ReportPageInput) {
    await this.models.projectReport.get(input);
    const page = reportPage(input, 'exports');
    const rows = await this.db.projectReportExport.findMany({
      where: page.where,
      orderBy: page.orderBy,
      take: page.limit + 1,
    });
    const result = page.finish(rows);
    const runs = await this.db.aiAgentRun.findMany({
      where: { id: { in: rows.flatMap(r => (r.runId ? [r.runId] : [])) } },
      select: { id: true, status: true },
    });
    return {
      ...result,
      items: result.items.map(row => ({
        id: row.id,
        revisionId: row.revisionId,
        format: row.format,
        status:
          row.status === 'succeeded'
            ? row.status
            : (runs.find(run => run.id === row.runId)?.status ?? row.status),
        warnings: Array.isArray(row.compatibility)
          ? row.compatibility.map(item =>
              typeof item === 'string'
                ? item
                : typeof item === 'object' && item && 'message' in item
                  ? String(item.message)
                  : 'Export compatibility note'
            )
          : [],
        resourceId: row.resourceId,
        downloadUrl:
          row.status === 'succeeded'
            ? `/api/projects/${input.projectId}/reports/${input.reportId}/exports/${row.id}`
            : undefined,
      })),
    };
  }
  async render(
    input: ReportActor & {
      revisionId: string;
      audience: ReportAudience;
      format: 'pdf' | 'pptx' | 'offline';
    }
  ) {
    const { document } = await this.content.read(input);
    const assets = new Map<string, { bytes: Uint8Array; mimeType: string }>();
    for (const binding of reportAudienceAssetBindings(
      document,
      input.audience
    )) {
      const { bytes, blob } = await this.blobs.read({
        ...input,
        key: binding.asset.blobKey,
        allowArchivedRead: true,
      });
      assets.set(binding.publicId, { bytes, mimeType: blob.mimeType });
    }
    const result = await renderProjectReport({
      document,
      audience: input.audience,
      format: input.format,
      assets,
    });
    await this.models.projectReport.get(input);
    return result;
  }
  async prepareExecution(run: ProjectAgentRun) {
    const command = z
      .object({ exportId: z.string(), reportId: z.string() })
      .strict()
      .parse(run.steps.find(step => step.stepKey === 'execute')?.input);
    const input = {
      projectId: run.projectId,
      actorId: run.actorId,
      reportId: command.reportId,
    };
    const row = await this.db.projectReportExport.findFirst({
      where: {
        id: command.exportId,
        projectId: run.projectId,
        actorId: run.actorId,
        reportId: command.reportId,
        runId: run.id,
      },
    });
    if (!row) throw new AccessDenied('Report export is unavailable');
    const result = await this.render({
      ...input,
      revisionId: row.revisionId,
      audience: ReportAudienceSchema.parse(row.audience),
      format: z.enum(['pdf', 'pptx', 'offline']).parse(row.format),
    });
    const blob = await this.blobs.put({
      ...input,
      bytes: Buffer.from(result.bytes),
      mimeType: result.mimeType,
    });
    await this.models.projectReport.retainBlobs({ ...input, keys: [blob.key] });
    return async (leasedRun: ProjectAgentRun) => {
      const saved = await this.models.projectReportExport.complete({
        run: leasedRun,
        exportId: row.id,
        blob,
        compatibility: JSON.parse(JSON.stringify(result.compatibility)),
      });
      return {
        status: 'saved',
        exportId: saved.id,
        reportId: saved.reportId,
        revisionId: saved.revisionId,
        sideEffectKind: 'report_export',
        sideEffectRecordId: saved.id,
      };
    };
  }
  async download(input: ReportActor & { exportId: string }) {
    await this.models.projectReport.get(input);
    const row = await this.db.projectReportExport.findFirst({
      where: {
        id: input.exportId,
        projectId: input.projectId,
        reportId: input.reportId,
        status: 'succeeded',
      },
    });
    if (!row?.blobKey) throw new AccessDenied('Report export is unavailable');
    const result = await this.blobs.read({
      ...input,
      key: row.blobKey,
      allowArchivedRead: true,
    });
    await this.models.projectReport.get(input);
    return { ...result, format: row.format };
  }
  async save(
    input: ReportActor & {
      requestKey: string;
      command: Extract<ReportCommand, { operation: 'export.save' }>;
    }
  ) {
    const { command } = input;
    const stored = await this.download({
      ...input,
      exportId: command.exportId,
    });
    if (stored.format === 'offline') {
      if (command.resourceId) {
        if (!command.expectedResourceVersion || !command.resourceEditLease)
          throw new BadRequest(
            'Updating a saved report requires its current version and edit lease'
          );
        await this.resources.saveFile({
          ...input,
          resourceId: command.resourceId,
          expectedContentVersion: command.expectedResourceVersion,
          blobKey: stored.blob.key,
          requestKey: input.requestKey,
          editLease: command.resourceEditLease
            ? { ...command.resourceEditLease, kind: 'user' }
            : undefined,
        });
        return { resourceId: command.resourceId };
      }
      const resource = await this.resources.createFile({
        ...input,
        title: 'Report presentation.zip',
        blobKey: stored.blob.key,
        requestKey: input.requestKey,
        parentId: command.parentId,
      });
      await this.db.projectReportExport.update({
        where: { id: command.exportId },
        data: { resourceId: resource.id },
      });
      return { resourceId: resource.id };
    }
    let replacement;
    if (command.resourceId) {
      const resource = await this.models.projectResource.get({
        ...input,
        resourceId: command.resourceId,
      });
      if (
        !resource.officeArtifactId ||
        !command.expectedParentRevisionId ||
        !command.resourceEditLease
      )
        throw new BadRequest(
          'Updating a saved report requires its Office revision and edit lease'
        );
      replacement = {
        artifactId: resource.officeArtifactId,
        expectedParentRevisionId: command.expectedParentRevisionId,
        requestFingerprint: projectResourceHash(command),
      };
    }
    const report = await this.models.projectReport.get(input);
    const imported = await this.office.import({
      ...input,
      sourceBlobKey: stored.blob.key,
      generatedBytes: stored.bytes,
      title: report.title,
      sourceFileName: `${report.title}.${stored.format}`,
      importIdempotencyKey: `report-export:${input.actorId}:${input.requestKey}`,
      projectRequestKey: input.requestKey,
      parentId: command.parentId,
      replaceProjectArtifact: replacement,
      editLease: command.resourceEditLease
        ? { ...command.resourceEditLease, kind: 'user' }
        : undefined,
    });
    const resource = await this.models.projectResource.assertOfficeResource({
      ...input,
      artifactId: imported.artifact.id,
    });
    await this.db.projectReportExport.update({
      where: { id: command.exportId },
      data: { resourceId: resource.id },
    });
    return { resourceId: resource.id };
  }
}
