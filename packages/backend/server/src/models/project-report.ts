import { randomUUID } from 'node:crypto';

import {
  BUILTIN_REPORT_TEMPLATES,
  type ReportDocument,
  ReportDocumentSchema,
  ReportResponsibilitySchema,
  ReportSelectionSchema,
  type ReportTemplate,
  ReportTemplateSchema,
} from '@localmind/office/report';
import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { AccessDenied, BadRequest, ResourceConflict } from '../base';
import { BaseModel } from './base';
import {
  type ProjectActor,
  type ProjectBlobEvidence,
  projectResourceHash,
} from './project-resource';

export type ReportActor = ProjectActor & { reportId: string };
export type ReportLeaseProof = {
  tabId: string;
  leaseId: string;
  kind?: 'user' | 'ai_task';
  taskId?: string;
};
const requestKey = z.string().trim().min(1).max(256);
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const cursorSchema = z
  .object({
    projectId: z.string(),
    lifecycle: z.string(),
    search: z.string(),
    updatedAt: z.string().datetime(),
    id: z.string(),
  })
  .strict();

@Injectable()
export class ProjectReportModel extends BaseModel {
  @Transactional()
  async get(input: ReportActor & { includeTrash?: boolean }) {
    await this.models.projectResource.assertMember(input, false, true);
    const report = await this.db.projectReport.findFirst({
      where: { id: input.reportId, projectId: input.projectId, deletion: null },
    });
    if (!report || (!input.includeTrash && report.lifecycle === 'trashed'))
      throw new AccessDenied('Project report is unavailable');
    return report;
  }

  @Transactional()
  async list(
    input: ProjectActor & {
      cursor?: string;
      limit?: number;
      lifecycle?: string;
      search?: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, false, true);
    const limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(input.limit ?? 30);
    const lifecycle = z
      .enum(['active', 'archived', 'trashed'])
      .parse(input.lifecycle ?? 'active');
    const search = z
      .string()
      .max(128)
      .parse(input.search ?? '')
      .trim();
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (input.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(input.cursor, 'base64url').toString())
        );
      } catch {
        throw new BadRequest('Invalid report cursor');
      }
      if (
        cursor.projectId !== input.projectId ||
        cursor.lifecycle !== lifecycle ||
        cursor.search !== search
      )
        throw new BadRequest('Report cursor belongs to a different query');
    }
    const rows = await this.db.projectReport.findMany({
      where: {
        projectId: input.projectId,
        lifecycle,
        deletion: null,
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: new Date(cursor.updatedAt) } },
                {
                  updatedAt: new Date(cursor.updatedAt),
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const identities = new Set(page.map(row => row.createdByActorId));
    for (const row of page) {
      const responsibility = ReportResponsibilitySchema.parse(
        row.responsibility
      );
      if (responsibility.identity.kind === 'member')
        identities.add(responsibility.identity.actorId);
    }
    const existingUsers = new Set(
      (
        await this.db.user.findMany({
          where: { id: { in: [...identities] } },
          select: { id: true },
        })
      ).map(user => user.id)
    );
    const items = page.map(row => {
      const responsibility = ReportResponsibilitySchema.parse(
        row.responsibility
      );
      if (
        responsibility.identity.kind === 'member' &&
        !existingUsers.has(responsibility.identity.actorId)
      )
        responsibility.identity.label = '已删除用户';
      return {
        ...row,
        creatorLabel: existingUsers.has(row.createdByActorId)
          ? row.creatorLabel
          : '已删除用户',
        responsibility,
      };
    });
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                projectId: input.projectId,
                lifecycle,
                search,
                updatedAt: last.updatedAt.toISOString(),
                id: last.id,
              })
            ).toString('base64url')
          : null,
    };
  }

  @Transactional<TransactionalAdapterPrisma>({ timeout: 30000 })
  async templates(input: ProjectActor) {
    await this.models.projectResource.assertMember(input);
    const existing = await this.db.projectReportTemplate.findMany({
      where: { projectId: input.projectId, builtinKey: { not: null } },
      select: {
        id: true,
        builtinKey: true,
        currentRevisionId: true,
        current: { select: { fingerprint: true } },
      },
    });
    for (const builtin of BUILTIN_REPORT_TEMPLATES) {
      const seeded = existing.find(
        item => item.builtinKey === builtin.key && item.currentRevisionId
      );
      if (seeded) {
        // Built-ins cannot be edited, so a different fingerprint is always an
        // older built-in definition. Reports keep their pinned old revision.
        const fingerprint = projectResourceHash(builtin.content);
        if (seeded.current?.fingerprint !== fingerprint)
          await this.upgradeBuiltinTemplate(
            input,
            seeded.id,
            builtin.content,
            fingerprint
          );
        continue;
      }
      const template = await this.db.projectReportTemplate.upsert({
        where: {
          projectId_builtinKey: {
            projectId: input.projectId,
            builtinKey: builtin.key,
          },
        },
        create: {
          projectId: input.projectId,
          builtinKey: builtin.key,
          name: builtin.content.name,
          createdBy: input.actorId,
        },
        update: {},
      });
      if (!template.currentRevisionId) {
        await this.db
          .$queryRaw`SELECT id FROM project_report_templates WHERE id = ${template.id} FOR UPDATE`;
        const locked = await this.db.projectReportTemplate.findUniqueOrThrow({
          where: { id: template.id },
        });
        if (locked.currentRevisionId) continue;
        const revision = await this.db.projectReportTemplateRevision.create({
          data: {
            templateId: template.id,
            projectId: input.projectId,
            sequence: 1,
            content: json(builtin.content),
            fingerprint: projectResourceHash(builtin.content),
            actorId: input.actorId,
          },
        });
        await this.db.projectReportTemplate.update({
          where: { id: template.id },
          data: { currentRevisionId: revision.id, revisionCounter: 1 },
        });
      }
    }
    return this.db.projectReportTemplate.findMany({
      where: { projectId: input.projectId },
      include: { current: true },
      orderBy: [{ builtinKey: 'asc' }, { name: 'asc' }],
      take: 100,
    });
  }

  private async upgradeBuiltinTemplate(
    input: ProjectActor,
    templateId: string,
    content: ReportTemplate,
    fingerprint: string
  ) {
    await this.db
      .$queryRaw`SELECT id FROM project_report_templates WHERE id = ${templateId} FOR UPDATE`;
    const locked = await this.db.projectReportTemplate.findUniqueOrThrow({
      where: { id: templateId },
      include: { current: { select: { fingerprint: true } } },
    });
    if (locked.current?.fingerprint === fingerprint) return;
    const revision = await this.db.projectReportTemplateRevision.create({
      data: {
        templateId,
        projectId: input.projectId,
        sequence: locked.revisionCounter + 1,
        content: json(content),
        fingerprint,
        actorId: input.actorId,
      },
    });
    await this.db.projectReportTemplate.update({
      where: { id: templateId },
      data: {
        name: content.name,
        currentRevisionId: revision.id,
        revisionCounter: revision.sequence,
        version: { increment: 1 },
      },
    });
  }

  @Transactional()
  async templateRevision(input: ProjectActor & { revisionId: string }) {
    await this.models.projectResource.assertMember(input, false, true);
    const revision = await this.db.projectReportTemplateRevision.findFirst({
      where: { id: input.revisionId, projectId: input.projectId },
    });
    if (!revision) throw new AccessDenied('Report template is unavailable');
    return {
      ...revision,
      content: ReportTemplateSchema.parse(revision.content),
    };
  }

  @Transactional<TransactionalAdapterPrisma>({ timeout: 30000 })
  async saveTemplate(
    input: ProjectActor & {
      templateId?: string;
      expectedVersion?: number;
      content: ReportTemplate;
      status?: 'active' | 'archived';
      requestKey: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    const content = ReportTemplateSchema.parse(input.content);
    const key = requestKey.parse(input.requestKey);
    const fingerprint = projectResourceHash({
      templateId: input.templateId ?? null,
      expectedVersion: input.expectedVersion ?? null,
      content,
      status: input.status ?? null,
    });
    const previous = await this.db.projectReportTemplateRevision.findUnique({
      where: {
        projectId_actorId_requestKey: {
          projectId: input.projectId,
          actorId: input.actorId,
          requestKey: key,
        },
      },
    });
    if (previous) {
      if (previous.requestFingerprint !== fingerprint)
        throw new BadRequest(
          'Template request key reused with different input'
        );
      return this.db.projectReportTemplate.findUniqueOrThrow({
        where: { id: previous.templateId },
        include: { current: true },
      });
    }
    let template = input.templateId
      ? await this.db.projectReportTemplate.findFirst({
          where: { id: input.templateId, projectId: input.projectId },
        })
      : null;
    if (input.templateId && !template)
      throw new AccessDenied('Report template is unavailable');
    if (template?.builtinKey)
      throw new BadRequest('Copy a built-in report template before editing');
    if (template) {
      await this.db
        .$queryRaw`SELECT id FROM project_report_templates WHERE id = ${template.id} FOR UPDATE`;
      template = await this.db.projectReportTemplate.findUniqueOrThrow({
        where: { id: template.id },
      });
      if (template.version !== input.expectedVersion)
        throw new ResourceConflict('Report template changed');
    } else
      template = await this.db.projectReportTemplate.create({
        data: {
          projectId: input.projectId,
          name: content.name,
          createdBy: input.actorId,
        },
      });
    const revision = await this.db.projectReportTemplateRevision.create({
      data: {
        projectId: input.projectId,
        templateId: template.id,
        sequence: template.revisionCounter + 1,
        content: json(content),
        fingerprint: projectResourceHash(content),
        actorId: input.actorId,
        requestKey: key,
        requestFingerprint: fingerprint,
      },
    });
    for (const asset of content.assets) {
      const blob = await this.models.projectResource.getBlob({
        ...input,
        key: asset.blobKey,
      });
      if (blob.mimeType !== asset.mimeType)
        throw new BadRequest('Template image MIME evidence differs');
      const retained = await this.db.projectReportBlobReference.findFirst({
        where: {
          projectId: input.projectId,
          blobKey: asset.blobKey,
          OR: [
            { report: { lifecycle: { not: 'trashed' }, deletion: null } },
            { template: { status: 'active' } },
          ],
        },
      });
      if (!retained)
        await this.models.projectResource.assertBlobDownload({
          ...input,
          key: asset.blobKey,
        });
      await this.db.projectReportBlobReference.upsert({
        where: {
          templateId_blobKey: {
            templateId: template.id,
            blobKey: asset.blobKey,
          },
        },
        create: {
          templateId: template.id,
          projectId: input.projectId,
          blobKey: asset.blobKey,
        },
        update: {},
      });
    }
    const updated = await this.db.projectReportTemplate.update({
      where: { id: template.id },
      data: {
        name: content.name,
        currentRevisionId: revision.id,
        revisionCounter: revision.sequence,
        version: { increment: 1 },
        status: input.status ?? template.status,
      },
      include: { current: true },
    });
    await this.db.projectRealtimeOutbox.create({
      data: {
        topic: 'project.report.template.changed',
        scopeId: input.projectId,
      },
    });
    return updated;
  }

  @Transactional()
  async findRequest(
    input: ProjectActor & {
      requestKey: string;
      fingerprint: string;
      operation: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, false, true);
    const found = await this.db.projectReportRequest.findUnique({
      where: {
        projectId_actorId_requestKey: {
          projectId: input.projectId,
          actorId: input.actorId,
          requestKey: requestKey.parse(input.requestKey),
        },
      },
    });
    if (
      found &&
      (found.fingerprint !== input.fingerprint ||
        found.operation !== input.operation)
    )
      throw new BadRequest('Report request key reused with different input');
    return found;
  }

  @Transactional<TransactionalAdapterPrisma>({ timeout: 30000 })
  async create(
    input: ProjectActor & {
      requestKey: string;
      fingerprint: string;
      document: ReportDocument;
      blob: ProjectBlobEvidence;
      templateRevisionId: string;
      selection: unknown;
      previousReportId?: string;
      previousRevisionId?: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    const prior = await this.findRequest({ ...input, operation: 'create' });
    if (prior) return this.get({ ...input, reportId: prior.reportId });
    await this.templateRevision({
      ...input,
      revisionId: input.templateRevisionId,
    });
    if (input.previousReportId)
      await this.get({ ...input, reportId: input.previousReportId });
    if (input.previousRevisionId) {
      if (!input.previousReportId)
        throw new BadRequest('Previous revision requires a report');
      await this.revision({
        ...input,
        reportId: input.previousReportId,
        revisionId: input.previousRevisionId,
      });
    }
    if (input.document.creator.actorId !== input.actorId)
      throw new BadRequest('Report creator must be the authenticated actor');
    const report = await this.db.projectReport.create({
      data: {
        projectId: input.projectId,
        title: input.document.title,
        createdByActorId: input.actorId,
        creatorLabel: input.document.creator.label,
        responsibility: json(
          ReportResponsibilitySchema.parse(input.document.responsibility)
        ),
        periodStart: input.document.period.start,
        periodEnd: input.document.period.end,
        timeZone: input.document.period.timeZone,
        templateRevisionId: input.templateRevisionId,
        selection: json(ReportSelectionSchema.parse(input.selection)),
        previousReportId: input.previousReportId,
        previousRevisionId: input.previousRevisionId,
      },
    });
    const revision = await this.db.projectReportRevision.create({
      data: {
        reportId: report.id,
        projectId: input.projectId,
        sequence: 1,
        kind: 'draft',
        contentBlobKey: input.blob.key,
        contentHash: input.blob.fingerprint,
        actorId: input.actorId,
        reason: 'create',
      },
    });
    const result = await this.db.projectReport.update({
      where: { id: report.id },
      data: { draftRevisionId: revision.id, revisionCounter: 1 },
    });
    await this.retainBlobs({
      ...input,
      reportId: report.id,
      keys: input.document.assets.map(asset => asset.blobKey),
    });
    await this.record({
      ...input,
      reportId: report.id,
      operation: 'create',
      result: { reportId: report.id, revisionId: revision.id },
    });
    return result;
  }

  @Transactional()
  async revision(input: ReportActor & { revisionId?: string }) {
    const report = await this.get(input);
    const revisionId =
      input.revisionId ??
      report.draftRevisionId ??
      report.latestFinalRevisionId;
    const revision = revisionId
      ? await this.db.projectReportRevision.findFirst({
          where: {
            id: revisionId,
            reportId: report.id,
            projectId: input.projectId,
          },
        })
      : null;
    if (!revision) throw new AccessDenied('Report revision is unavailable');
    return revision;
  }

  @Transactional()
  async history(input: ReportActor & { before?: number; limit?: number }) {
    await this.get(input);
    if (input.before !== undefined)
      z.number().int().positive().parse(input.before);
    return this.db.projectReportRevision.findMany({
      where: {
        reportId: input.reportId,
        projectId: input.projectId,
        ...(input.before ? { sequence: { lt: input.before } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: z
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(input.limit ?? 30),
    });
  }

  @Transactional<TransactionalAdapterPrisma>({ timeout: 30000 })
  async save(
    input: ReportActor & {
      expectedVersion: number;
      requestKey: string;
      fingerprint: string;
      blob: ProjectBlobEvidence;
      document: ReportDocument;
      kind: 'draft' | 'preview' | 'final';
      reason: string;
      editLease: ReportLeaseProof;
      sourceManifestId?: string;
      selection?: unknown;
    }
  ) {
    input.document = ReportDocumentSchema.parse(input.document);
    const report = await this.lock(input);
    const prior = await this.findRequest({ ...input, operation: input.kind });
    if (prior) return this.get(input);
    if (report.version !== input.expectedVersion)
      throw new ResourceConflict('Report changed; merge the current revision');
    await this.assertLease(input);
    if (input.document.creator.actorId !== report.createdByActorId)
      throw new BadRequest('Report creation identity is immutable');
    const responsibility = ReportResponsibilitySchema.parse(
      input.document.responsibility
    );
    const revision = await this.db.projectReportRevision.create({
      data: {
        reportId: report.id,
        projectId: input.projectId,
        sequence: report.revisionCounter + 1,
        kind: input.kind,
        parentRevisionId:
          report.draftRevisionId ?? report.latestFinalRevisionId,
        contentBlobKey: input.blob.key,
        contentHash: input.blob.fingerprint,
        actorId: input.actorId,
        reason: z.string().max(512).parse(input.reason),
        sourceManifestId: input.sourceManifestId,
      },
    });
    const result = await this.db.projectReport.update({
      where: { id: report.id },
      data: {
        ...(input.kind === 'preview'
          ? {}
          : {
              title: input.document.title,
              responsibility: json(responsibility),
              periodStart: input.document.period.start,
              periodEnd: input.document.period.end,
              timeZone: input.document.period.timeZone,
            }),
        revisionCounter: revision.sequence,
        ...(input.selection
          ? { selection: json(ReportSelectionSchema.parse(input.selection)) }
          : {}),
        version: { increment: 1 },
        ...(input.kind === 'final'
          ? { latestFinalRevisionId: revision.id, draftRevisionId: null }
          : input.kind === 'draft'
            ? { draftRevisionId: revision.id }
            : {}),
      },
    });
    await this.retainBlobs({
      ...input,
      keys: input.document.assets.map(asset => asset.blobKey),
    });
    await this.record({
      ...input,
      operation: input.kind,
      result: { revisionId: revision.id, version: result.version },
    });
    return result;
  }

  @Transactional()
  async changeLifecycle(
    input: ReportActor & {
      expectedVersion: number;
      lifecycle: 'active' | 'archived' | 'trashed';
      requestKey: string;
      fingerprint: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    await this.db
      .$queryRaw`SELECT id FROM project_reports WHERE id = ${input.reportId} AND project_id = ${input.projectId} FOR UPDATE`;
    const prior = await this.findRequest({ ...input, operation: 'lifecycle' });
    if (prior) return this.get({ ...input, includeTrash: true });
    const report = await this.get({ ...input, includeTrash: true });
    if (report.version !== input.expectedVersion)
      throw new ResourceConflict('Report changed');
    const result = await this.db.projectReport.update({
      where: { id: report.id },
      data: { lifecycle: input.lifecycle, version: { increment: 1 } },
    });
    if (input.lifecycle !== 'active') {
      await this.models.copilotProjectAgentRuntime.cancelReportRuns(input);
      await this.models.projectReportSchedule.pauseForReport(input);
      await this.db.projectReportEditLease.deleteMany({
        where: { reportId: report.id },
      });
      if (input.lifecycle === 'trashed')
        await this.db.projectReportShare.updateMany({
          where: { reportId: report.id, status: 'active' },
          data: {
            status: 'revoked',
            revokedAt: new Date(),
            version: { increment: 1 },
          },
        });
    }
    await this.record({
      ...input,
      operation: 'lifecycle',
      result: { lifecycle: result.lifecycle, version: result.version },
    });
    return result;
  }

  @Transactional()
  async acquireLease(
    input: ReportActor & {
      tabId: string;
      kind?: 'user' | 'ai_task';
      taskId?: string;
    }
  ) {
    await this.lock(input);
    const tabId = z.string().trim().min(1).max(128).parse(input.tabId);
    const kind = input.kind ?? 'user';
    const now = await this.now();
    let expiresAt = new Date(now.getTime() + 60000);
    if (kind === 'ai_task') {
      const run = await this.db.aiAgentRun.findFirst({
        where: {
          id: input.taskId,
          projectId: input.projectId,
          actorId: input.actorId,
          status: 'running',
          workerLeaseId: tabId,
          workerLeaseExpiresAt: { gt: now },
        },
      });
      if (!run?.workerLeaseExpiresAt)
        throw new AccessDenied('Report worker lease is unavailable');
      expiresAt = new Date(
        Math.min(expiresAt.getTime(), run.workerLeaseExpiresAt.getTime())
      );
    }
    const current = await this.db.projectReportEditLease.findUnique({
      where: { reportId: input.reportId },
    });
    if (
      current &&
      current.expiresAt > now &&
      (current.holderId !== input.actorId ||
        current.tabId !== tabId ||
        current.kind !== kind ||
        current.taskId !== (input.taskId ?? null))
    )
      return { acquired: false, lease: { ...current, leaseId: null } };
    const lease = await this.db.projectReportEditLease.upsert({
      where: { reportId: input.reportId },
      create: {
        reportId: input.reportId,
        projectId: input.projectId,
        holderId: input.actorId,
        tabId,
        kind,
        taskId: input.taskId,
        leaseId: randomUUID(),
        expiresAt,
      },
      update: {
        holderId: input.actorId,
        tabId,
        kind,
        taskId: input.taskId ?? null,
        leaseId:
          current && current.expiresAt > now ? current.leaseId : randomUUID(),
        expiresAt,
      },
    });
    if (
      !current ||
      current.holderId !== lease.holderId ||
      current.tabId !== lease.tabId ||
      current.expiresAt <= now
    )
      await this.db.projectRealtimeOutbox.create({
        data: {
          topic: 'project.report.changed',
          scopeId: input.projectId,
          resourceId: input.reportId,
        },
      });
    return { acquired: true, lease };
  }

  @Transactional()
  async renewLease(input: ReportActor & ReportLeaseProof) {
    await this.lock(input);
    await this.assertLease({ ...input, editLease: input });
    return this.acquireLease(input);
  }

  @Transactional()
  async releaseLease(input: ReportActor & ReportLeaseProof) {
    await this.get({ ...input, includeTrash: true });
    const result = await this.db.projectReportEditLease.deleteMany({
      where: {
        reportId: input.reportId,
        projectId: input.projectId,
        holderId: input.actorId,
        leaseId: input.leaseId,
        tabId: input.tabId,
        kind: input.kind ?? 'user',
        taskId: input.taskId ?? null,
      },
    });
    if (result.count)
      await this.db.projectRealtimeOutbox.create({
        data: {
          topic: 'project.report.changed',
          scopeId: input.projectId,
          resourceId: input.reportId,
        },
      });
    return result.count === 1;
  }

  async assertLease(input: ReportActor & { editLease: ReportLeaseProof }) {
    const proof = input.editLease;
    const lease = await this.db.projectReportEditLease.findFirst({
      where: {
        reportId: input.reportId,
        projectId: input.projectId,
        holderId: input.actorId,
        tabId: proof.tabId,
        leaseId: proof.leaseId,
        kind: proof.kind ?? 'user',
        taskId: proof.taskId ?? null,
        expiresAt: { gt: await this.now() },
      },
    });
    if (!lease) throw new AccessDenied('Active report edit lease required');
    if (lease.kind === 'ai_task') {
      const run = await this.db.aiAgentRun.findFirst({
        where: {
          id: lease.taskId ?? '',
          projectId: input.projectId,
          actorId: input.actorId,
          status: 'running',
          workerLeaseId: lease.tabId,
          workerLeaseExpiresAt: { gt: await this.now() },
        },
      });
      if (!run) throw new AccessDenied('Report worker lease expired');
    }
    return lease;
  }

  async lock(input: ReportActor) {
    await this.models.projectResource.assertMember(input);
    await this.db
      .$queryRaw`SELECT id FROM project_reports WHERE id = ${input.reportId} AND project_id = ${input.projectId} FOR UPDATE`;
    const report = await this.get(input);
    if (report.lifecycle !== 'active')
      throw new BadRequest('Restore the report before editing');
    return report;
  }

  @Transactional()
  async retainBlobs(input: ReportActor & { keys: string[] }) {
    await this.get(input);
    for (const key of new Set(input.keys)) {
      await this.models.projectResource.getBlob({ ...input, key });
      await this.db.projectReportBlobReference.upsert({
        where: { reportId_blobKey: { reportId: input.reportId, blobKey: key } },
        create: {
          reportId: input.reportId,
          projectId: input.projectId,
          blobKey: key,
        },
        update: {},
      });
    }
  }

  async record(
    input: ReportActor & {
      requestKey: string;
      fingerprint: string;
      operation: string;
      result: Prisma.InputJsonValue;
    }
  ) {
    await this.db.projectReportRequest.create({
      data: {
        projectId: input.projectId,
        reportId: input.reportId,
        actorId: input.actorId,
        requestKey: requestKey.parse(input.requestKey),
        operation: input.operation,
        fingerprint: input.fingerprint,
        result: input.result,
      },
    });
    await this.db.projectReportAuditEvent.create({
      data: {
        projectId: input.projectId,
        reportId: input.reportId,
        actorId: input.actorId,
        action: input.operation,
        evidence: input.result,
      },
    });
    await this.db.projectRealtimeOutbox.create({
      data: {
        topic: 'project.report.changed',
        scopeId: input.projectId,
        resourceId: input.reportId,
      },
    });
  }

  private async now() {
    const [row] = await this.db.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    return row.now;
  }
}
