import {
  projectReportAudience,
  reportAudienceAssetBindings,
  type ReportDocument,
  reportNodeText,
  ReportSelectionSchema,
  ReportTemplateSchema,
} from '@localmind/office/report';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  Prisma,
  PrismaClient,
  type ProjectReportComment,
} from '@prisma/client';

import { BadRequest, Config } from '../../base';
import { Models } from '../../models';
import type { ReportActor } from '../../models/project-report';
import { reportPage } from '../../models/project-report-pagination';
import { projectResourceHash } from '../../models/project-resource';
import { ProjectReportGenerationService } from '../../plugins/copilot/report-generation-service';
import { ProjectReportContentService } from './content';
import {
  type ReportCommandInput,
  ReportCommandInputSchema,
  type ReportQuery,
  ReportQuerySchema,
} from './contracts';
import { ProjectReportExportService } from './export';
import { ProjectReportLifecycleService } from './lifecycle';
import { ProjectReportScheduleService } from './schedule';
import { ProjectReportShareService } from './share';

@Injectable()
export class ProjectReportService {
  constructor(
    private readonly models: Models,
    private readonly db: PrismaClient,
    private readonly ref: ModuleRef,
    private readonly content: ProjectReportContentService,
    private readonly exports: ProjectReportExportService,
    private readonly shares: ProjectReportShareService,
    private readonly config: Config
  ) {}
  private get generation() {
    return this.ref.get(ProjectReportGenerationService, { strict: false });
  }
  private get schedules() {
    return this.ref.get(ProjectReportScheduleService, { strict: false });
  }

  private commentState(
    row: ProjectReportComment,
    document: ReportDocument,
    revisionId: string
  ) {
    const chapter = row.nodeId
      ? document.chapters.find(chapter =>
          chapter.nodes.some(node => node.id === row.nodeId)
        )
      : document.chapters.find(chapter => chapter.id === row.chapterId);
    const node = chapter?.nodes.find(node => node.id === row.nodeId);
    const stale =
      row.revisionId !== revisionId &&
      (row.nodeId
        ? !node || reportNodeText(node).slice(0, 2000) !== row.anchorText
        : row.chapterId
          ? !chapter
          : !!row.anchorText);
    return {
      ...row,
      chapterId: chapter?.id ?? row.chapterId,
      body: row.content,
      resolved: !!row.resolvedAt,
      stale,
    };
  }

  async state(actorId: string, raw: ReportQuery) {
    const query = ReportQuerySchema.parse(raw);
    const scope = { projectId: query.projectId, actorId };
    await this.models.projectResource.assertMember(scope, false, true);
    const project = await this.db.aiContextProject.findUniqueOrThrow({
      where: { id: query.projectId },
      select: { status: true },
    });
    const active =
      project.status === 'active' && this.config.projectReports.enabled;
    const capabilities = {
      canEdit: active,
      canShare: active,
      canSchedule: active && this.config.projectReports.schedulesEnabled,
      allowAnonymous: this.config.projectReports.allowAnonymous,
      emailConfigured: !!this.config.mailer.SMTP.host,
    };
    // Search must not wait for template initialization or creation-form data.
    if (query.view === 'list_results') {
      return {
        currentActorId: actorId,
        capabilities,
        reports: await this.models.projectReport.list({ ...scope, ...query }),
      };
    }
    if (query.view === 'presentation') {
      if (!query.reportId || !query.revisionId)
        throw new BadRequest('Presentation requires a fixed report revision');
      const input = {
        ...scope,
        reportId: query.reportId,
        revisionId: query.revisionId,
      };
      const { document, revision } = await this.content.read(input);
      const audience = {
        kind: 'external' as const,
        chapterIds: document.chapters.filter(c => !c.hidden).map(c => c.id),
        includeNotes: false,
        includeSources: false,
      };
      const projection = projectReportAudience(document, audience);
      return {
        projection,
        revision: {
          id: revision.id,
          sequence: revision.sequence,
          kind: revision.kind,
        },
        assetUrls: Object.fromEntries(
          reportAudienceAssetBindings(document, audience).map(binding => [
            binding.publicId,
            `/api/projects/${query.projectId}/reports/${query.reportId}/revisions/${query.revisionId}/assets/${binding.publicId}`,
          ])
        ),
      };
    }
    if (
      query.view === 'schedule_occurrences' ||
      query.view === 'schedule_revisions'
    ) {
      if (
        !query.scheduleId ||
        !(await this.db.projectReportSchedule.findFirst({
          where: { id: query.scheduleId, projectId: scope.projectId },
        }))
      )
        throw new BadRequest('Choose an available report schedule');
      const page = reportPage(
        {
          ...scope,
          reportId: query.scheduleId,
          cursor: query.cursor,
          limit: query.limit,
        },
        query.view
      );
      const { reportId: _reportId, ...bound } = page.where;
      const where = { ...bound, scheduleId: query.scheduleId };
      if (query.view === 'schedule_occurrences') {
        const result = page.finish(
          await this.db.projectReportOccurrence.findMany({
            where,
            orderBy: page.orderBy,
            take: page.limit + 1,
            include: { deliveries: true },
          })
        );
        return {
          scheduleId: query.scheduleId,
          occurrences: result.items,
          nextCursors: { occurrences: result.nextCursor },
          capabilities,
        };
      }
      const result = page.finish(
        await this.db.projectReportScheduleRevision.findMany({
          where,
          orderBy: page.orderBy,
          take: page.limit + 1,
        })
      );
      return {
        scheduleId: query.scheduleId,
        revisions: result.items,
        nextCursors: { revisions: result.nextCursor },
        capabilities,
      };
    }
    if (query.view === 'schedules' || query.view === 'templates') {
      if (query.view === 'templates' && active)
        await this.models.projectReport.templates(scope);
      const page = reportPage(
        {
          ...scope,
          reportId: '$project',
          cursor: query.cursor,
          limit: query.limit,
        },
        query.view
      );
      const { reportId: _reportId, ...where } = page.where;
      if (query.view === 'templates') {
        const result = page.finish(
          await this.db.projectReportTemplate.findMany({
            where,
            orderBy: page.orderBy,
            take: page.limit + 1,
            include: { current: true },
          })
        );
        return {
          templates: result.items,
          nextCursors: { templates: result.nextCursor },
          capabilities,
        };
      }
      const result = page.finish(
        await this.db.projectReportSchedule.findMany({
          where,
          orderBy: page.orderBy,
          take: page.limit + 1,
          include: {
            revisions: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 31,
            },
            occurrences: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 31,
              include: { deliveries: true },
            },
          },
        })
      );
      const schedules = result.items.map(row => {
        const occurrencePage = reportPage(
          { ...scope, reportId: row.id },
          'schedule_occurrences'
        ).finish(row.occurrences);
        const revisionPage = reportPage(
          { ...scope, reportId: row.id },
          'schedule_revisions'
        ).finish(row.revisions);
        return {
          ...row,
          occurrences: occurrencePage.items,
          revisions: revisionPage.items,
          nextCursors: {
            occurrences: occurrencePage.nextCursor,
            revisions: revisionPage.nextCursor,
          },
        };
      });
      const [templates, members, resources] = await Promise.all([
        active
          ? this.models.projectReport.templates(scope)
          : Promise.resolve([]),
        this.db.aiContextProjectMember.findMany({
          where: { projectId: query.projectId },
          select: { userId: true, user: { select: { name: true } } },
        }),
        active ? this.resourceRows(query.projectId, 1001) : Promise.resolve([]),
      ]);
      const frozenTemplates =
        await this.db.projectReportTemplateRevision.findMany({
          where: {
            projectId: query.projectId,
            id: {
              in: schedules
                .map(schedule => schedule.templateRevisionId)
                .filter(
                  id => !templates.some(template => template.current?.id === id)
                ),
            },
          },
          include: { template: true },
        });
      return {
        schedules,
        templates: [
          ...templates,
          ...frozenTemplates.map(revision => ({
            ...revision.template,
            name: `${ReportTemplateSchema.parse(revision.content).name} · v${revision.sequence}`,
            current: revision,
          })),
        ],
        members: members.map(member => ({
          id: member.userId,
          name: member.user.name,
        })),
        resources: resources.slice(0, 1000),
        resourcesLimited: resources.length > 1000,
        nextCursors: { schedules: result.nextCursor },
        capabilities,
      };
    }
    if (query.view === 'history') {
      if (!query.reportId) throw new BadRequest('Choose a report');
      const revisions = await this.models.projectReport.history({
        ...scope,
        reportId: query.reportId,
        before: query.cursor ? Number(query.cursor) : undefined,
        limit: query.limit,
      });
      return {
        revisions: revisions.map(this.revision),
        nextCursor:
          revisions.length === (query.limit ?? 30)
            ? revisions.at(-1)?.sequence.toString()
            : null,
        nextCursors: {
          revisions:
            revisions.length === (query.limit ?? 30)
              ? revisions.at(-1)?.sequence.toString()
              : null,
        },
        capabilities,
      };
    }
    if (
      query.view &&
      ['comments', 'reviews', 'exports', 'shares'].includes(query.view)
    ) {
      if (!query.reportId) throw new BadRequest('Choose a report');
      const input = {
        ...scope,
        reportId: query.reportId,
        cursor: query.cursor,
        limit: query.limit,
      };
      if (query.view === 'exports' || query.view === 'shares') {
        const page =
          query.view === 'exports'
            ? await this.exports.page(input)
            : await this.shares.page(input);
        return {
          [query.view]: page.items,
          nextCursors: { [query.view]: page.nextCursor },
          capabilities,
        };
      }
      const current = await this.content.read({
        ...input,
        revisionId: query.revisionId,
      });
      if (query.view === 'reviews') {
        const page =
          await this.models.projectReportCollaboration.reviews(input);
        return {
          reviews: page.items.map(row => ({
            ...row,
            stale: row.revisionId !== current.revision.id,
          })),
          nextCursors: { reviews: page.nextCursor },
          capabilities,
        };
      }
      const page = await this.models.projectReportCollaboration.comments(input);
      return {
        comments: page.items.map(row =>
          this.commentState(row, current.document, current.revision.id)
        ),
        nextCursors: { comments: page.nextCursor },
        capabilities,
      };
    }
    const [templates, members, resources] = await Promise.all([
      active ? this.models.projectReport.templates(scope) : Promise.resolve([]),
      this.db.aiContextProjectMember.findMany({
        where: { projectId: query.projectId },
        select: { userId: true, user: { select: { name: true } } },
      }),
      active ? this.resourceRows(query.projectId, 1001) : Promise.resolve([]),
    ]);
    const common = {
      currentActorId: actorId,
      templates,
      members: members.map(member => ({
        id: member.userId,
        name: member.user.name,
      })),
      resources: resources.slice(0, 1000),
      resourcesLimited: resources.length > 1000,
      capabilities,
    };
    if (query.view === 'list_options') return common;
    if (!query.reportId)
      return {
        ...common,
        reports: await this.models.projectReport.list({ ...scope, ...query }),
      };
    const input = { ...scope, reportId: query.reportId };
    const current = await this.content.read({
      ...input,
      revisionId: query.revisionId,
    });
    const [revisions, collaboration, exports, shares, task] = await Promise.all(
      [
        this.models.projectReport.history(input),
        this.models.projectReportCollaboration.state(input),
        this.exports.page(input),
        this.shares.page(input),
        active ? this.generation.getTask(input) : Promise.resolve(null),
      ]
    );
    let candidates: unknown[] = [];
    if (task?.candidateRevisionId && task.status === 'completed') {
      const candidate = await this.generation.candidate({
        ...input,
        runId: task.runId,
      });
      candidates = [
        {
          id: task.runId,
          runId: task.runId,
          baseRevisionId: candidate.baseRevisionId,
          document: candidate.document,
          conflicts: candidate.conflicts,
          details: candidate.details,
          status: 'ready',
        },
      ];
    }
    return {
      ...common,
      ...current,
      capabilities: {
        ...capabilities,
        canEdit: active && current.report.lifecycle === 'active',
        canShare: active && current.report.lifecycle === 'active',
      },
      assetUrls: Object.fromEntries(
        current.document.assets.map(asset => [
          asset.id,
          `/api/projects/${query.projectId}/reports/${query.reportId}/revisions/${current.revision.id}/assets/${asset.id}`,
        ])
      ),
      sourceChanges: active
        ? await this.sourceChanges(
            scope,
            current.document,
            current.report.selection
          )
        : null,
      revision: this.revision(current.revision),
      revisions: revisions.map(this.revision),
      comments: collaboration.comments.map(row =>
        this.commentState(row, current.document, current.revision.id)
      ),
      reviews: collaboration.reviews.map(row => ({
        ...row,
        stale: row.revisionId !== current.revision.id,
      })),
      lease: collaboration.lease
        ? {
            ...collaboration.lease,
            owned: collaboration.lease.holderId === actorId,
            holderName:
              common.members.find(
                member => member.id === collaboration.lease?.holderId
              )?.name ?? 'Project member',
          }
        : null,
      exports: exports.items,
      shares: shares.items,
      nextCursors: {
        ...collaboration.nextCursors,
        exports: exports.nextCursor,
        shares: shares.nextCursor,
        revisions:
          revisions.length === 30
            ? revisions.at(-1)?.sequence.toString()
            : null,
      },
      runs: task
        ? [
            {
              ...task,
              id: task.runId,
              step: task.phases.find(phase => phase.status === 'running')?.key,
              completed: task.phases.filter(
                phase => phase.status === 'completed'
              ).length,
              total: task.phases.length,
              error: task.failureCode,
            },
          ]
        : [],
      candidates,
    };
  }

  private resourceRows(projectId: string, limit: number) {
    return this.db.$queryRaw<
      {
        id: string;
        title: string;
        kind: string;
        parentId: string | null;
        contentVersion: number;
        officeArtifactId: string | null;
        updatedAt: Date;
      }[]
    >(Prisma.sql`
      WITH RECURSIVE live AS (
        SELECT r.id,r.title,r.kind,r.parent_id,r.content_version,r.office_artifact_id,r.updated_at,1 AS depth
        FROM project_resources r WHERE r.project_id=${projectId} AND r.parent_id IS NULL AND r.trashed_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM project_resource_deletions d WHERE d.resource_id=r.id)
        UNION ALL
        SELECT r.id,r.title,r.kind,r.parent_id,r.content_version,r.office_artifact_id,r.updated_at,p.depth+1
        FROM project_resources r JOIN live p ON r.parent_id=p.id
        WHERE r.project_id=${projectId} AND r.trashed_at IS NULL AND p.depth<64
        AND NOT EXISTS(SELECT 1 FROM project_resource_deletions d WHERE d.resource_id=r.id)
      ) SELECT id,title,kind,parent_id AS "parentId",content_version AS "contentVersion",office_artifact_id AS "officeArtifactId",updated_at AS "updatedAt"
      FROM live ORDER BY title,id LIMIT ${limit}
    `);
  }
  private async sourceChanges(
    scope: { projectId: string; actorId: string },
    document: import('@localmind/office/report').ReportDocument,
    rawSelection: unknown
  ) {
    const { projectId } = scope;
    const excluded =
      await this.models.projectReportGeneration.reportExportResourceIds(scope);
    const sources = document.sources.filter(
      source => !['memory', 'work_order'].includes(source.kind)
    );
    const rows = await this.resourceRows(projectId, 10001);
    const revisions = await this.db.officeRevision.findMany({
      where: {
        projectId,
        artifactId: {
          in: rows.flatMap(row =>
            row.officeArtifactId ? [row.officeArtifactId] : []
          ),
        },
      },
      distinct: ['artifactId'],
      orderBy: [{ artifactId: 'asc' }, { sequence: 'desc' }],
      select: { artifactId: true, id: true },
    });
    const heads = new Map(revisions.map(row => [row.artifactId, row.id]));
    const live = new Map(rows.map(row => [row.id, row]));
    const selection = ReportSelectionSchema.parse(rawSelection);
    const selected = (row: (typeof rows)[number]) => {
      if (selection.kind === 'all') return true;
      if (selection.kind === 'resources')
        return selection.resourceIds.includes(row.id);
      let parentId: string | null = row.parentId;
      for (let depth = 0; parentId && depth < 64; depth++) {
        if (selection.folderIds.includes(parentId)) return true;
        parentId = live.get(parentId)?.parentId ?? null;
      }
      return false;
    };
    const known = new Set(sources.map(source => source.resourceId));
    let count = rows.filter(
        row =>
          row.kind !== 'folder' &&
          !excluded.has(row.id) &&
          selected(row) &&
          !known.has(row.id) &&
          row.updatedAt > new Date(document.cutoffAt)
      ).length,
      removed = 0;
    for (const source of sources) {
      const row = live.get(source.resourceId);
      if (!row) {
        removed++;
        continue;
      }
      const revision = row.officeArtifactId
        ? heads.get(row.officeArtifactId)
        : String(row.contentVersion);
      if (revision !== source.revision) count++;
    }
    return {
      count,
      removed,
      limited: rows.length > 10000,
      checkedAt: new Date().toISOString(),
    };
  }
  private revision(row: {
    id: string;
    reportId: string;
    sequence: number;
    kind: string;
    createdAt: Date;
    actorId: string;
    reason: string;
  }) {
    return {
      id: row.id,
      reportId: row.reportId,
      sequence: row.sequence,
      kind: row.kind,
      createdAt: row.createdAt,
      actorId: row.actorId,
      reason: row.reason,
    };
  }

  async command(actorId: string, raw: ReportCommandInput) {
    if (Buffer.byteLength(JSON.stringify(raw)) > 2 * 1024 * 1024)
      throw new BadRequest('Report command exceeds its bound');
    const input = ReportCommandInputSchema.parse(raw);
    const command = input.command;
    const scope = { projectId: input.projectId, actorId };
    if (
      !this.config.projectReports.enabled &&
      ![
        'share.revoke',
        'lease.release',
        'schedule.pause',
        'schedule.remove',
        'schedule.delivery.resolve',
      ].includes(command.operation)
    )
      throw new BadRequest('New report operations are disabled');
    if (command.operation.startsWith('schedule.'))
      return this.schedules.command({ ...input, actorId });
    if (command.operation === 'template.save')
      return {
        templates: [
          await this.models.projectReport.saveTemplate({
            ...scope,
            ...command,
            requestKey: input.requestKey,
          }),
        ],
      };
    if (command.operation === 'create') {
      const created = await this.content.create({
        ...scope,
        requestKey: input.requestKey,
        command,
      });
      const task = command.generate
        ? await this.generation.request({
            ...scope,
            reportId: created.report.id,
            expectedVersion: created.report.version,
            requestKey: `${input.requestKey}:generate`,
            instruction: command.instructions,
            operation: 'create',
          })
        : null;
      return { ...created, reportId: created.report.id, runId: task?.runId };
    }
    if (!input.reportId) throw new BadRequest('Choose a report');
    const actor: ReportActor = { ...scope, reportId: input.reportId };
    const request = {
      ...actor,
      requestKey: input.requestKey,
      fingerprint: projectResourceHash(command),
    };
    const version = () => {
      if (!input.expectedVersion)
        throw new BadRequest('Current report version required');
      return input.expectedVersion;
    };
    const lease = () => {
      if (!input.editLease) throw new BadRequest('Report edit lease required');
      return { ...input.editLease, kind: 'user' as const };
    };
    switch (command.operation) {
      case 'lease.acquire': {
        const acquired = await this.models.projectReport.acquireLease({
          ...actor,
          tabId: command.tabId,
          kind: 'user',
        });
        return {
          ...acquired,
          lease: { ...acquired.lease, owned: acquired.acquired },
        };
      }
      case 'lease.renew': {
        const acquired = await this.models.projectReport.renewLease({
          ...actor,
          ...command,
          kind: 'user',
        });
        return {
          ...acquired,
          lease: { ...acquired.lease, owned: acquired.acquired },
        };
      }
      case 'lease.release':
        return {
          released: await this.models.projectReport.releaseLease({
            ...actor,
            ...command,
            kind: 'user',
          }),
        };
      case 'save':
      case 'finalize':
        return this.content.save({
          ...actor,
          requestKey: input.requestKey,
          expectedVersion: version(),
          editLease: lease(),
          document: command.document,
          kind:
            command.operation === 'finalize'
              ? 'final'
              : (command.kind ?? 'draft'),
          reason:
            command.operation === 'finalize'
              ? 'Finalize report'
              : (command.reason ?? 'Save report'),
        });
      case 'restore': {
        const historical = await this.content.read({
          ...actor,
          revisionId: command.revisionId,
        });
        return this.content.save({
          ...actor,
          requestKey: input.requestKey,
          expectedVersion: version(),
          editLease: lease(),
          document: historical.document,
          kind: 'draft',
          reason: `Restore revision ${historical.revision.sequence}`,
          restoreRevisionId: command.revisionId,
        });
      }
      case 'lifecycle':
        return {
          report: await this.models.projectReport.changeLifecycle({
            ...request,
            expectedVersion: version(),
            lifecycle: command.lifecycle,
          }),
        };
      case 'permanentlyDelete':
        return this.ref
          .get(ProjectReportLifecycleService, { strict: false })
          .permanentlyDelete({ ...request, expectedVersion: version() });
      case 'comment.add': {
        const current = await this.content.read({
          ...actor,
          revisionId: command.revisionId,
        });
        const chapter = command.chapterId
          ? current.document.chapters.find(c => c.id === command.chapterId)
          : command.nodeId
            ? current.document.chapters.find(c =>
                c.nodes.some(node => node.id === command.nodeId)
              )
            : undefined;
        const node = command.nodeId
          ? current.document.chapters
              .flatMap(c => c.nodes)
              .find(n => n.id === command.nodeId)
          : undefined;
        if (
          (command.chapterId && !chapter) ||
          (command.nodeId && !node) ||
          (chapter && node && !chapter.nodes.some(item => item.id === node.id))
        )
          throw new BadRequest('Comment anchor is unavailable');
        return {
          comment: await this.models.projectReportCollaboration.addComment({
            ...request,
            ...command,
            chapterId: chapter?.id,
            content: command.body,
            anchorText: (node
              ? reportNodeText(node)
              : (chapter?.title ?? '')
            ).slice(0, 2000),
          }),
        };
      }
      case 'comment.resolve':
        return {
          comment: await this.models.projectReportCollaboration.resolveComment({
            ...request,
            ...command,
            expectedVersion: command.expectedCommentVersion,
          }),
        };
      case 'review.request':
        return this.models.projectReportCollaboration.requestReview({
          ...request,
          ...command,
        });
      case 'review.respond':
        return {
          review: await this.models.projectReportCollaboration.respondReview({
            ...request,
            ...command,
            expectedVersion: command.expectedReviewVersion,
          }),
        };
      case 'generate': {
        const revision = await this.models.projectReport.revision(actor);
        if (revision.id !== command.revisionId)
          throw new BadRequest('Report baseline changed');
        return this.generation.request({
          ...request,
          expectedVersion: version(),
          operation: command.mode,
          instruction: command.instructions,
          selection: command.selection,
          scope: { chapterIds: command.chapterIds, nodeIds: command.nodeIds },
        });
      }
      case 'generation.cancel':
        return {
          run: await this.generation.cancel({ ...actor, runId: command.runId }),
        };
      case 'generation.retry':
        return {
          run: await this.generation.retry({ ...actor, runId: command.runId }),
        };
      case 'candidate.apply': {
        await this.generation.apply({
          ...request,
          runId: command.candidateId,
          expectedVersion: version(),
          editLease: lease(),
          choices: command.choices,
        });
        return this.content.read(actor);
      }
      case 'export':
        return this.exports.request({ ...request, command });
      case 'export.save':
        return this.exports.save({ ...request, command });
      case 'share.create':
        return this.shares.create({ ...request, command });
      case 'share.revoke':
        return this.models.projectReportShare.revoke({
          ...request,
          ...command,
        });
      default:
        throw new BadRequest('Unsupported report command');
    }
  }
}
