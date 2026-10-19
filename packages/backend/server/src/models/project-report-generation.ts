import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Prisma } from '@prisma/client';

import { AccessDenied, BadRequest, ResourceConflict } from '../base';
import { BaseModel } from './base';
import type {
  ProjectAgentLease,
  ProjectAgentRun,
} from './copilot-project-agent-runtime';
import { WORK_ORDER_DISPATCH_RELEASED_STATUSES } from './copilot-work-order';
import type { ReportActor } from './project-report';
import {
  PROJECT_REPORT_WORKFLOW,
  REPORT_PHASES,
  type ReportGenerationCommand,
  ReportGenerationCommandSchema,
  type ReportWorkOrderEvidence,
} from './project-report-generation-contract';
import { ReportGenerationError } from './project-report-generation-error';
import {
  type ProjectActor,
  type ProjectBlobEvidence,
  projectResourceHash,
} from './project-resource';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const include = {
  steps: { orderBy: { order: 'asc' as const } },
} satisfies Prisma.AiAgentRunInclude;
// Participant-visible metadata only. Never select delivery drafts, staged blobs,
// delivery item text/files, exchanges or dispatch drafts for report evidence.
const workOrderEvidenceSelect = {
  id: true,
  dispatchId: true,
  senderId: true,
  recipientId: true,
  status: true,
  version: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  requirements: {
    where: { required: true },
    orderBy: { ordinal: 'asc' as const },
    select: { title: true },
  },
  deliveries: {
    orderBy: { revision: 'desc' as const },
    take: 1,
    select: {
      revision: true,
      submittedAt: true,
      _count: { select: { items: true } },
    },
  },
} satisfies Prisma.WorkOrderSelect;
type WorkOrderEvidenceRow = Prisma.WorkOrderGetPayload<{
  select: typeof workOrderEvidenceSelect;
}>;

@Injectable()
export class ProjectReportGenerationModel extends BaseModel {
  @Transactional<TransactionalAdapterPrisma>({ timeout: 30000 })
  async request(
    input: ReportActor & {
      requestKey: string;
      command: ReportGenerationCommand;
      explicitCutoff?: boolean;
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    const command = ReportGenerationCommandSchema.parse(input.command);
    const report = await this.models.projectReport.lock(input);
    const runtimeRequestKey = `generate:${input.actorId}:${input.requestKey}`;
    const prior = await this.models.copilotProjectAgentRuntime.findRequest({
      ...input,
      sourceType: 'project_report',
      requestKey: runtimeRequestKey,
    });
    if (prior) {
      const original = ReportGenerationCommandSchema.parse(
        prior.steps.find(step => step.stepKey === 'execute')?.input
      );
      if (!input.explicitCutoff) command.cutoffAt = original.cutoffAt;
      // PostgreSQL JSONB reorders object keys; compare schema-normalized inputs.
      if (projectResourceHash(original) !== projectResourceHash(command))
        throw new BadRequest(
          'Report generation request was reused with different input'
        );
      return prior;
    }
    if (report.version !== command.expectedVersion)
      throw new ResourceConflict('Report changed before generation');
    await this.models.projectReport.revision({
      ...input,
      revisionId: command.baselineRevisionId,
    });
    const run = await this.models.copilotProjectAgentRuntime.prepare({
      ...input,
      requestKey: runtimeRequestKey,
      workflow: PROJECT_REPORT_WORKFLOW,
      sourceType: 'project_report',
      title: report.title,
      command: json(command) as Prisma.InputJsonObject,
    });
    for (const [index, phase] of REPORT_PHASES.entries())
      await this.models.copilotProjectAgentRuntime.reportStep({
        ...input,
        runId: run.id,
        key: phase,
        status: 'pending',
        order: 10 + index,
      });
    await this.models.projectReport.record({
      ...input,
      operation: 'generate',
      fingerprint: projectResourceHash(command),
      result: { runId: run.id },
    });
    return run;
  }

  @Transactional()
  async run(input: ReportActor & { runId?: string }) {
    await this.models.projectReport.get(input);
    const run = await this.db.aiAgentRun.findFirst({
      where: {
        projectId: input.projectId,
        workspaceId: null,
        workflow: PROJECT_REPORT_WORKFLOW,
        ...(input.runId
          ? { id: input.runId }
          : {
              steps: {
                some: {
                  stepKey: 'execute',
                  input: { path: ['reportId'], equals: input.reportId },
                },
              },
            }),
      },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!run) return null;
    const command = ReportGenerationCommandSchema.parse(
      run.steps.find(step => step.stepKey === 'execute')?.input
    );
    if (command.reportId !== input.reportId)
      throw new AccessDenied('Report task is unavailable');
    return { ...run, command };
  }

  @Transactional()
  async assertLease(input: ProjectAgentLease) {
    await this.models.projectResource.assertMember(input);
    await this.db
      .$queryRaw`SELECT id FROM ai_agent_runs WHERE id=${input.runId} AND project_id=${input.projectId} FOR UPDATE`;
    const run = await this.db.aiAgentRun.findFirst({
      where: {
        id: input.runId,
        projectId: input.projectId,
        actorId: input.actorId,
        workflow: PROJECT_REPORT_WORKFLOW,
        status: 'running',
        workerLeaseId: input.workerLeaseId,
        workerAttempt: input.workerAttempt,
        workerLeaseExpiresAt: { gt: new Date() },
      },
      include,
    });
    if (
      !run ||
      (await this.db.aiAgentTimelineEvent.findFirst({
        where: {
          runId: input.runId,
          eventType: 'run_cancellation',
          payload: { path: ['action'], equals: 'cancel_requested' },
        },
      }))
    )
      throw new BadRequest(
        'Report execution was cancelled or its lease expired'
      );
    const command = ReportGenerationCommandSchema.parse(
      run.steps.find(step => step.stepKey === 'execute')?.input
    );
    const report = await this.models.projectReport.get({
      ...input,
      reportId: command.reportId,
    });
    if (report.lifecycle !== 'active')
      throw new BadRequest('Report is not active');
    return { run, command, report };
  }

  @Transactional()
  async checkpoint(
    input: ProjectAgentLease & {
      key: string;
      output?: Prisma.InputJsonObject;
      running?: boolean;
    }
  ) {
    await this.assertLease(input);
    const existing = await this.db.aiAgentStep.findUnique({
      where: { runId_stepKey: { runId: input.runId, stepKey: input.key } },
    });
    if (existing?.status === 'completed') return existing.outputSummary;
    if (!input.running && !input.output) return null;
    const output = input.output ?? {};
    if (Buffer.byteLength(JSON.stringify(output)) > 65536)
      throw new BadRequest('Report checkpoint is too large');
    const status = input.running ? 'running' : 'completed';
    await this.models.copilotProjectAgentRuntime.reportStep({
      ...input,
      key: input.key,
      status,
      output,
    });
    await this.db.projectRealtimeOutbox.create({
      data: {
        topic: 'project.report.changed',
        scopeId: input.projectId,
        resourceId: (await this.assertLease(input)).command.reportId,
      },
    });
    return null;
  }

  @Transactional()
  async reserveModelCall(
    input: ProjectAgentLease & { maxCalls: number; inputCharacters: number }
  ) {
    await this.assertLease(input);
    const count = await this.db.aiAgentStep.count({
      where: { runId: input.runId, stepKey: { startsWith: 'model-call:' } },
    });
    if (count >= input.maxCalls)
      throw new ReportGenerationError('REPORT_MODEL_BUDGET_EXCEEDED');
    await this.models.copilotProjectAgentRuntime.reportStep({
      ...input,
      key: `model-call:${count + 1}`,
      type: 'model',
      status: 'running',
      order: 1000 + count,
      output: { inputCharacters: input.inputCharacters },
    });
    return `model-call:${count + 1}`;
  }

  @Transactional()
  async seedPrompt(input: { name: string; system: string }) {
    await this.db.aiPrompt.upsert({
      where: { name: input.name },
      update: {},
      create: {
        name: input.name,
        model: '',
        action: '',
        optionalModels: [],
        config: { maxTokens: 6000 },
        messages: {
          create: [
            { idx: 0, role: 'system', content: input.system },
            { idx: 1, role: 'user', content: '{{content}}' },
          ],
        },
      },
    });
  }

  @Transactional()
  async sharedBackground(
    input: ProjectActor & { cursor?: string; cutoffAt: string; limit: number }
  ) {
    await this.models.projectResource.assertMember(input);
    const now = new Date();
    const rows = await this.db.aiContextMemory.findMany({
      where: {
        projectId: input.projectId,
        scope: 'project',
        sharingStatus: 'shared',
        contractVersion: 'shared-project-memory/v1',
        status: 'active',
        quarantinedAt: null,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
      orderBy: { id: 'asc' },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
    });
    return {
      items: rows.slice(0, input.limit),
      nextCursor:
        rows.length > input.limit ? (rows[input.limit - 1]?.id ?? null) : null,
    };
  }
  @Transactional()
  async validateSharedBackground(
    input: ProjectActor & { id: string; revision: string; fingerprint: string }
  ) {
    await this.models.projectResource.assertMember(input);
    const row = await this.db.aiContextMemory.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        scope: 'project',
        sharingStatus: 'shared',
        contractVersion: 'shared-project-memory/v1',
        status: 'active',
        quarantinedAt: null,
      },
    });
    if (
      !row ||
      !Number.isSafeInteger(Number(input.revision)) ||
      Number(input.revision) > row.revision ||
      (String(row.revision) === input.revision &&
        projectResourceHash({
          content: row.content,
          revision: row.revision,
        }) !== input.fingerprint) ||
      (row.validUntil && row.validUntil <= new Date()) ||
      (row.expiresAt && row.expiresAt <= new Date())
    )
      throw new AccessDenied(
        'Shared report background changed or is no longer available'
      );
  }

  @Transactional()
  async workOrderEvidence(
    input: ProjectActor & { cursor?: string; cutoffAt: string; limit: number }
  ) {
    await this.models.projectResource.assertMember(input);
    const rows = await this.db.workOrder.findMany({
      where: {
        sourceProjectIdSnapshot: input.projectId,
        createdAt: { lte: new Date(input.cutoffAt) },
        OR: [{ senderId: input.actorId }, { recipientId: input.actorId }],
      },
      orderBy: { id: 'asc' },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: input.limit + 1,
      select: workOrderEvidenceSelect,
    });
    const page = rows.slice(0, input.limit);
    return {
      items: await this.workOrderEvidenceItems(input.actorId, page),
      nextCursor:
        rows.length > input.limit ? (rows[input.limit - 1]?.id ?? null) : null,
    };
  }

  @Transactional()
  async validateWorkOrderEvidence(
    input: ProjectActor & { id: string; revision: string; fingerprint: string }
  ) {
    await this.models.projectResource.assertMember(input);
    const row = await this.db.workOrder.findFirst({
      where: {
        id: input.id,
        sourceProjectIdSnapshot: input.projectId,
        OR: [{ senderId: input.actorId }, { recipientId: input.actorId }],
      },
      select: workOrderEvidenceSelect,
    });
    const claimed = /^[a-z_]{1,24}:(\d{1,9}):\d{1,9}$/.exec(input.revision);
    const current = row
      ? (await this.workOrderEvidenceItems(input.actorId, [row]))[0]
      : undefined;
    // Older versions stay valid historical evidence; the current version must
    // match its server-built fingerprint exactly.
    if (
      !current ||
      !claimed ||
      Number(claimed[1]) > current.version ||
      (Number(claimed[1]) === current.version &&
        (current.revision !== input.revision ||
          current.fingerprint !== input.fingerprint))
    )
      throw new AccessDenied(
        'Work order report evidence changed or is no longer available'
      );
  }

  private async workOrderEvidenceItems(
    actorId: string,
    rows: WorkOrderEvidenceRow[]
  ): Promise<ReportWorkOrderEvidence[]> {
    const senderDispatches = [
      ...new Set(
        rows
          .filter(row => row.recipientId !== actorId)
          .map(row => row.dispatchId)
      ),
    ];
    // Same rule as the private work-order view: a sender sees delivery
    // revisions only after every order in the dispatch is delivered/cancelled.
    const blocked = senderDispatches.length
      ? await this.db.workOrder.findMany({
          where: {
            dispatchId: { in: senderDispatches },
            status: { notIn: [...WORK_ORDER_DISPATCH_RELEASED_STATUSES] },
          },
          distinct: ['dispatchId'],
          select: { dispatchId: true },
        })
      : [];
    const unreleased = new Set(blocked.map(row => row.dispatchId));
    return rows.map(row => {
      const role =
        row.recipientId === actorId
          ? ('recipient' as const)
          : ('sender' as const);
      const released = role === 'recipient' || !unreleased.has(row.dispatchId);
      const latest = released ? row.deliveries[0] : undefined;
      const evidence = {
        id: row.id,
        title: row.title,
        role,
        status: row.status,
        version: row.version,
        requirementTitles: row.requirements.map(item => item.title),
        delivery: latest
          ? {
              revision: latest.revision,
              submittedAt: latest.submittedAt.toISOString(),
              itemCount: latest._count.items,
            }
          : null,
        completedAt:
          released && row.completedAt ? row.completedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
      return {
        ...evidence,
        revision: `${row.status}:${row.version}:${latest?.revision ?? 0}`,
        fingerprint: projectResourceHash(evidence),
      };
    });
  }

  @Transactional()
  async captureResource(
    input: ProjectActor & {
      resourceId: string;
      cutoffAt: Date;
      periodStart: Date;
      periodEnd: Date;
    }
  ) {
    const resource = await this.models.projectResource.get(input);
    if (resource.kind === 'folder')
      throw new BadRequest('Folder is not a report source');
    if (resource.officeArtifactId) {
      const revision =
        (await this.db.officeRevision.findFirst({
          where: {
            projectId: input.projectId,
            artifactId: resource.officeArtifactId,
            createdAt: { lte: input.cutoffAt },
          },
          orderBy: { sequence: 'desc' },
        })) ??
        (await this.models.officeArtifact.getCurrentRevision(
          { projectId: input.projectId },
          resource.officeArtifactId
        ));
      if (!revision)
        throw new BadRequest('Office source revision is unavailable');
      return {
        resource,
        revisionId: revision.id,
        sequence: revision.sequence,
        fingerprint: revision.packageFingerprint,
        blobKey: revision.packageBlobKey,
        capturedAt: revision.createdAt,
        historicalGap: revision.createdAt > input.cutoffAt,
        changedInPeriod:
          revision.createdAt >= input.periodStart &&
          revision.createdAt < input.periodEnd,
      };
    }
    const revision =
      (await this.db.projectResourceRevision.findFirst({
        where: {
          projectId: input.projectId,
          resourceId: input.resourceId,
          createdAt: { lte: input.cutoffAt },
        },
        orderBy: { sequence: 'desc' },
      })) ?? (await this.models.projectResource.revision(input));
    const blob = await this.models.projectResource.getBlob({
      ...input,
      key: revision.blobKey,
    });
    return {
      resource,
      revisionId: String(revision.sequence),
      sequence: revision.sequence,
      fingerprint: blob.fingerprint,
      blobKey: blob.key,
      capturedAt: revision.createdAt,
      historicalGap: revision.createdAt > input.cutoffAt,
      changedInPeriod:
        revision.createdAt >= input.periodStart &&
        revision.createdAt < input.periodEnd,
    };
  }

  async reportExportResourceIds(input: ProjectActor) {
    await this.models.projectResource.assertMember(input);
    const exports = await this.db.projectReportExport.findMany({
      where: { projectId: input.projectId, resourceId: { not: null } },
      select: { resourceId: true },
    });
    return new Set(
      exports.flatMap(item => (item.resourceId ? [item.resourceId] : []))
    );
  }

  @Transactional()
  async persistCandidate(
    input: ProjectAgentLease & {
      blob: ProjectBlobEvidence;
      manifestBlob: ProjectBlobEvidence;
      coverage: Prisma.InputJsonValue;
    }
  ) {
    const { command, report } = await this.assertLease(input);
    await this.models.projectReport.lock({ ...input, reportId: report.id });
    const prior = await this.db.projectReportSourceManifest.findFirst({
      where: {
        runId: input.runId,
        reportId: report.id,
        projectId: input.projectId,
      },
      include: { revisions: true },
    });
    if (prior?.revisions[0])
      return {
        candidateRevisionId: prior.revisions[0].id,
        sourceManifestId: prior.id,
      };
    const current = await this.models.projectReport.get({
      ...input,
      reportId: report.id,
    });
    const manifest = await this.db.projectReportSourceManifest.create({
      data: {
        reportId: report.id,
        projectId: input.projectId,
        actorId: input.actorId,
        runId: input.runId,
        blobKey: input.manifestBlob.key,
        fingerprint: input.manifestBlob.fingerprint,
        cutoffAt: new Date(command.cutoffAt),
        coverage: input.coverage,
      },
    });
    const revision = await this.db.projectReportRevision.create({
      data: {
        reportId: report.id,
        projectId: input.projectId,
        sequence: current.revisionCounter + 1,
        kind: 'candidate',
        parentRevisionId: command.baselineRevisionId,
        contentBlobKey: input.blob.key,
        contentHash: input.blob.fingerprint,
        sourceManifestId: manifest.id,
        actorId: input.actorId,
        reason: `AI ${command.operation} candidate`,
      },
    });
    await this.db.projectReport.update({
      where: { id: report.id },
      data: { revisionCounter: revision.sequence },
    });
    await this.db.projectReportAuditEvent.create({
      data: {
        projectId: input.projectId,
        reportId: report.id,
        actorId: input.actorId,
        action: 'generation_candidate',
        evidence: {
          runId: input.runId,
          revisionId: revision.id,
          manifestId: manifest.id,
        },
      },
    });
    return { candidateRevisionId: revision.id, sourceManifestId: manifest.id };
  }

  @Transactional()
  async retry(input: ReportActor & { runId: string }) {
    await this.models.projectResource.assertMember(input, true);
    const task = await this.run(input);
    if (!task || task.actorId !== input.actorId || task.status !== 'failed')
      throw new BadRequest(
        'Only the requesting member can retry a failed report task'
      );
    await this.models.projectReport.lock(input);
    await this.models.copilotProjectAgentRuntime.retryReportRun(input);
    await this.db.projectReportAuditEvent.create({
      data: {
        projectId: input.projectId,
        reportId: input.reportId,
        actorId: input.actorId,
        action: 'generation_retry',
        evidence: { runId: task.id, previousAttempt: task.workerAttempt },
      },
    });
    return this.run(input);
  }

  lease(run: ProjectAgentRun): ProjectAgentLease {
    if (!run.workerLeaseId)
      throw new BadRequest('Report task has no worker lease');
    return {
      projectId: run.projectId,
      actorId: run.actorId,
      runId: run.id,
      workerLeaseId: run.workerLeaseId,
      workerAttempt: run.workerAttempt,
    };
  }
}
