import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BadRequest } from '../base';
import { BaseModel } from './base';
import type { ProjectAgentRun } from './copilot-project-agent-runtime';
import type { ReportActor } from './project-report';
import type { ProjectBlobEvidence } from './project-resource';

export const PROJECT_REPORT_EXPORT_WORKFLOW =
  'agent_runtime_project_report_export_v1';
@Injectable()
export class ProjectReportExportModel extends BaseModel {
  @Transactional()
  async request(
    input: ReportActor & {
      revisionId: string;
      requestKey: string;
      fingerprint: string;
      format: string;
      audience: Prisma.InputJsonValue;
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    await this.models.projectReport.lock(input);
    const previous = await this.db.projectReportExport.findUnique({
      where: {
        projectId_actorId_requestKey: {
          projectId: input.projectId,
          actorId: input.actorId,
          requestKey: input.requestKey,
        },
      },
    });
    if (previous) {
      if (
        previous.fingerprint !== input.fingerprint ||
        previous.reportId !== input.reportId
      )
        throw new BadRequest('Export request key reused');
      return previous;
    }
    await this.models.projectReport.revision(input);
    const row = await this.db.projectReportExport.create({
      data: {
        projectId: input.projectId,
        reportId: input.reportId,
        revisionId: input.revisionId,
        actorId: input.actorId,
        requestKey: input.requestKey,
        fingerprint: input.fingerprint,
        format: input.format,
        audience: input.audience,
      },
    });
    const run = await this.models.copilotProjectAgentRuntime.prepare({
      ...input,
      sourceType: 'project_report',
      workflow: PROJECT_REPORT_EXPORT_WORKFLOW,
      requestKey: `export:${input.actorId}:${input.requestKey}`,
      title: 'Export project report',
      command: { exportId: row.id, reportId: input.reportId },
    });
    const result = await this.db.projectReportExport.update({
      where: { id: row.id },
      data: { runId: run.id },
    });
    await this.models.projectReport.record({
      ...input,
      operation: 'export',
      result: { exportId: row.id, runId: run.id },
    });
    return result;
  }

  @Transactional()
  async complete(input: {
    run: ProjectAgentRun;
    exportId: string;
    blob: ProjectBlobEvidence;
    compatibility: Prisma.InputJsonValue;
  }) {
    const scope = {
      projectId: input.run.projectId,
      actorId: input.run.actorId,
    };
    await this.models.projectResource.assertMember(scope);
    const row = await this.db.projectReportExport.findFirst({
      where: {
        id: input.exportId,
        projectId: input.run.projectId,
        actorId: input.run.actorId,
        runId: input.run.id,
      },
    });
    if (!row) throw new BadRequest('Report export is unavailable');
    const report = await this.models.projectReport.get({
      ...scope,
      reportId: row.reportId,
    });
    if (report.lifecycle !== 'active')
      throw new BadRequest('Report export was stopped');
    const now = await this.db.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    if (
      !(await this.db.aiAgentRun.findFirst({
        where: {
          id: input.run.id,
          status: 'running',
          workerLeaseId: input.run.workerLeaseId,
          workerAttempt: input.run.workerAttempt,
          workerLeaseExpiresAt: { gt: now[0].now },
        },
      }))
    )
      throw new BadRequest('Report export worker expired');
    const result = await this.db.projectReportExport.update({
      where: { id: row.id },
      data: {
        status: 'succeeded',
        blobKey: input.blob.key,
        mimeType: input.blob.mimeType,
        compatibility: input.compatibility,
      },
    });
    await this.db.projectRealtimeOutbox.create({
      data: {
        topic: 'project.report.changed',
        scopeId: row.projectId,
        resourceId: row.reportId,
      },
    });
    return result;
  }
}
