import { randomUUID } from 'node:crypto';

import {
  type ReportAudience,
  reportFinalizationIssues,
} from '@localmind/office/report';
import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PrismaClient,
  type ProjectReportDelivery,
  type ProjectReportOccurrence,
} from '@prisma/client';
import { z } from 'zod';

import { AccessDenied, BadRequest, Config, JobQueue } from '../../base';
import { Models } from '../../models';
import type { ProjectAgentRun } from '../../models/copilot-project-agent-runtime';
import {
  type ReportMailAuthorizer,
  ReportOccurrenceSnapshotSchema,
  type ReportScheduleConfig,
  ReportScheduleConfigSchema,
} from '../../models/project-report-schedule-contract';
import { reportDeliveryIntersection } from '../../models/project-report-schedule-policy';
import {
  type ProjectActor,
  projectResourceHash,
} from '../../models/project-resource';
import { ByokService } from '../../plugins/copilot/byok';
import { ProjectReportGenerationService } from '../../plugins/copilot/report-generation-service';
import { Mailer } from '../mail';
import { ProjectReportContentService } from './content';
import type { ReportCommandInput } from './contracts';
import { ProjectReportExportService } from './export';
import { ProjectReportShareService } from './share';

export const PROJECT_REPORT_FINALIZE_WORKFLOW =
  'agent_runtime_project_report_finalize_v1';
const finalizerCommand = z
  .object({
    occurrenceId: z.string(),
    reportId: z.string(),
    generationRunId: z.string(),
  })
  .strict();

@Injectable()
export class ProjectReportScheduleService implements ReportMailAuthorizer {
  private readonly logger = new Logger(ProjectReportScheduleService.name);
  constructor(
    private readonly models: Models,
    private readonly db: PrismaClient,
    private readonly ref: ModuleRef,
    private readonly config: Config,
    private readonly queue: JobQueue,
    private readonly content: ProjectReportContentService,
    private readonly exports: ProjectReportExportService,
    private readonly shares: ProjectReportShareService,
    private readonly mailer: Mailer
  ) {}
  private generation() {
    return this.ref.get(ProjectReportGenerationService, { strict: false });
  }
  private byok() {
    return this.ref.get(ByokService, { strict: false });
  }
  async list(input: ProjectActor) {
    return this.models.projectReportSchedule.list(input);
  }
  private async authorization(
    input: ProjectActor,
    config: ReportScheduleConfig
  ) {
    const memberIds: string[] = [],
      emailRecipients: string[] = [];
    for (const recipient of new Set(config.delivery.recipients)) {
      if (config.delivery.channel === 'notification') {
        if (!(await this.models.user.get(recipient)))
          throw new BadRequest('A report recipient is unavailable');
        memberIds.push(recipient);
      } else {
        const user = await this.models.user.get(recipient);
        const email = user?.email ?? z.string().email().parse(recipient);
        const account = user ?? (await this.models.user.getUserByEmail(email));
        if (!account && !this.config.projectReports.allowAnonymous)
          throw new BadRequest(
            'External email delivery requires anonymous report sharing to be enabled'
          );
        emailRecipients.push(email.toLowerCase());
        if (account) memberIds.push(account.id);
      }
    }
    return { actorId: input.actorId, memberIds, emailRecipients };
  }
  async command(input: ReportCommandInput & { actorId: string }) {
    const command = input.command;
    if (
      !this.config.projectReports.schedulesEnabled &&
      command.operation !== 'schedule.remove' &&
      command.operation !== 'schedule.delivery.resolve' &&
      !(command.operation === 'schedule.pause' && command.paused)
    )
      throw new BadRequest('Report schedules are disabled');
    if (command.operation === 'schedule.delivery.resolve')
      return this.resolveDelivery({ ...input, ...command });
    if (command.operation === 'schedule.save') {
      const authorization = await this.authorization(input, command.config);
      return this.models.projectReportSchedule.save({
        ...input,
        scheduleId: command.scheduleId,
        expectedVersion: command.expectedScheduleVersion,
        config: command.config,
        authorization,
        rebind: command.rebind,
      });
    }
    if (command.operation === 'schedule.run') {
      const occurrence = await this.models.projectReportSchedule.manual({
        ...input,
        ...command,
        expectedVersion: command.expectedScheduleVersion,
      });
      await this.processOccurrence(occurrence);
      return this.db.projectReportOccurrence.findUniqueOrThrow({
        where: { id: occurrence.id },
      });
    }
    if (
      command.operation === 'schedule.pause' ||
      command.operation === 'schedule.remove'
    ) {
      const schedule = await this.models.projectReportSchedule.get({
        ...input,
        scheduleId: command.scheduleId,
      });
      const config = ReportScheduleConfigSchema.parse(schedule.config);
      const authorization =
        ReportOccurrenceSnapshotSchema.shape.authorization.parse(
          schedule.authorization
        );
      const result = await this.models.projectReportSchedule.save({
        ...input,
        scheduleId: schedule.id,
        expectedVersion: command.expectedScheduleVersion,
        config,
        authorization,
        status:
          command.operation === 'schedule.remove'
            ? 'removed'
            : command.paused
              ? 'paused'
              : 'active',
      });
      if (result.status !== 'active') {
        const pending = await this.db.projectReportOccurrence.findMany({
          where: {
            scheduleId: schedule.id,
            status: { in: ['generating', 'finalizing'] },
          },
        });
        for (const occurrence of pending)
          if (occurrence.reportId)
            await this.models.copilotProjectAgentRuntime.cancelReportRuns({
              ...input,
              reportId: occurrence.reportId,
            });
        await this.db.projectReportOccurrence.updateMany({
          where: {
            scheduleId: schedule.id,
            status: { in: ['generating', 'finalizing'] },
          },
          data: {
            status: 'paused',
            version: { increment: 1 },
            failureCode: 'SCHEDULE_PAUSED',
          },
        });
      }
      return result;
    }
    throw new BadRequest('Unsupported report schedule operation');
  }
  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick() {
    if (
      !this.config.projectReports.enabled ||
      !this.config.projectReports.schedulesEnabled
    )
      return;
    const schedules = await this.db.projectReportSchedule.findMany({
      where: { status: 'active', nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: 'asc' },
      take: 25,
      select: { id: true },
    });
    for (const schedule of schedules) {
      try {
        await this.models.projectReportSchedule.claimDue(schedule.id);
      } catch {
        this.logger.warn('Report schedule claim failed');
      }
    }
    const occurrences = await this.db.projectReportOccurrence.findMany({
      where: { status: { in: ['queued', 'generating', 'finalizing'] } },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    for (const occurrence of occurrences) {
      try {
        await this.processOccurrence(occurrence);
      } catch {
        await this.failOccurrence(
          occurrence,
          'REPORT_SCHEDULE_EXECUTION_FAILED'
        );
      }
    }
    const deliveries = await this.db.projectReportDelivery.findMany({
      where: { status: { in: ['queued', 'sending'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const delivery of deliveries) {
      try {
        await this.processDelivery(delivery);
      } catch {
        await this.db.projectReportDelivery.updateMany({
          where: {
            id: delivery.id,
            status: 'queued',
            version: delivery.version,
          },
          data: {
            status: 'failed',
            resultNote:
              'Report delivery preparation failed; review authorization and mail configuration.',
            version: { increment: 1 },
          },
        });
      }
    }
  }
  private async failOccurrence(
    occurrence: ProjectReportOccurrence,
    code: string
  ) {
    await this.db.projectReportOccurrence.updateMany({
      where: {
        id: occurrence.id,
        status: { in: ['queued', 'generating', 'finalizing'] },
      },
      data: { status: 'failed', failureCode: code, version: { increment: 1 } },
    });
    const current = await this.db.projectReportSchedule.findUnique({
      where: { id: occurrence.scheduleId },
    });
    if (current?.actorId === occurrence.actorId)
      await this.models.projectReportSchedule.pauseForFailure({
        scheduleId: occurrence.scheduleId,
        version: current.version,
        code,
      });
  }
  private async checkOccurrence(occurrence: ProjectReportOccurrence) {
    const actor = {
      projectId: occurrence.projectId,
      actorId: occurrence.actorId,
    };
    await this.models.projectResource.assertMember(actor);
    const schedule = await this.models.projectReportSchedule.get({
      ...actor,
      scheduleId: occurrence.scheduleId,
    });
    if (schedule.status !== 'active')
      throw new AccessDenied('Report schedule is paused');
    if (
      !(
        await this.byok().getProfiles({
          projectId: actor.projectId,
          userId: actor.actorId,
        })
      ).length
    )
      throw new AccessDenied('Project report provider is unavailable');
    return schedule;
  }
  private async processOccurrence(occurrence: ProjectReportOccurrence) {
    await this.checkOccurrence(occurrence);
    const actor = {
      projectId: occurrence.projectId,
      actorId: occurrence.actorId,
    };
    const snapshot = ReportOccurrenceSnapshotSchema.parse(occurrence.snapshot);
    if (occurrence.status === 'queued') {
      const created = await this.content.create({
        ...actor,
        requestKey: `schedule:${occurrence.id}:create`,
        command: {
          operation: 'create',
          title: snapshot.config.title,
          period: { ...snapshot.period, weekStartsOn: 1 },
          templateRevisionId: snapshot.config.templateRevisionId,
          selection: snapshot.config.selection,
          generate: false,
        },
      });
      const task = await this.generation().request({
        ...actor,
        reportId: created.report.id,
        requestKey: `schedule:${occurrence.id}:generate`,
        expectedVersion: created.report.version,
        cutoffAt: snapshot.period.end,
      });
      await this.db.projectReportOccurrence.updateMany({
        where: {
          id: occurrence.id,
          status: 'queued',
          version: occurrence.version,
        },
        data: {
          reportId: created.report.id,
          runId: task.runId,
          status: 'generating',
          version: { increment: 1 },
        },
      });
      return;
    }
    if (!occurrence.runId || !occurrence.reportId)
      throw new BadRequest('Report occurrence is incomplete');
    const task = await this.db.aiAgentRun.findUniqueOrThrow({
      where: { id: occurrence.runId },
    });
    if (['failed', 'cancelled'].includes(task.status)) {
      await this.failOccurrence(
        occurrence,
        task.failureCode ?? 'REPORT_TASK_FAILED'
      );
      return;
    }
    if (task.status !== 'completed') return;
    if (occurrence.status === 'generating') {
      const run = await this.models.copilotProjectAgentRuntime.prepare({
        ...actor,
        sourceType: 'project_report',
        workflow: PROJECT_REPORT_FINALIZE_WORKFLOW,
        requestKey: `finalize:${actor.actorId}:${occurrence.id}`,
        title: 'Review scheduled project report',
        command: {
          occurrenceId: occurrence.id,
          reportId: occurrence.reportId,
          generationRunId: task.id,
        },
      });
      await this.db.projectReportOccurrence.updateMany({
        where: { id: occurrence.id, status: 'generating' },
        data: {
          runId: run.id,
          status: 'finalizing',
          version: { increment: 1 },
        },
      });
      await this.queue.add('copilot.projectAgentRuntime.run', {
        projectId: actor.projectId,
        runId: run.id,
      });
    }
  }
  async prepareExecution(run: ProjectAgentRun) {
    const command = finalizerCommand.parse(
      run.steps.find(step => step.stepKey === 'execute')?.input
    );
    const occurrence = await this.db.projectReportOccurrence.findFirstOrThrow({
      where: {
        id: command.occurrenceId,
        projectId: run.projectId,
        actorId: run.actorId,
        reportId: command.reportId,
      },
    });
    await this.checkOccurrence(occurrence);
    return async (leased: ProjectAgentRun) => {
      await this.checkOccurrence(occurrence);
      const actor = {
        projectId: leased.projectId,
        actorId: leased.actorId,
        reportId: command.reportId,
      };
      if (!leased.workerLeaseId)
        throw new BadRequest('Report worker lease is unavailable');
      const lease = await this.models.projectReport.acquireLease({
        ...actor,
        tabId: leased.workerLeaseId,
        kind: 'ai_task',
        taskId: leased.id,
      });
      if (!lease.acquired || !lease.lease.leaseId)
        throw new BadRequest('Report editing lease is occupied');
      const editLease = {
        tabId: leased.workerLeaseId,
        leaseId: lease.lease.leaseId,
        kind: 'ai_task' as const,
        taskId: leased.id,
      };
      try {
        const current = await this.content.read(actor);
        const candidate = await this.generation().candidate({
          ...actor,
          runId: command.generationRunId,
        });
        let status: 'completed' | 'needs_review' = 'needs_review';
        let reportRevisionId: string | undefined;
        if (!candidate.conflicts.length) {
          await this.generation().apply({
            ...actor,
            runId: command.generationRunId,
            expectedVersion: current.report.version,
            requestKey: `schedule:${occurrence.id}:apply`,
            editLease,
          });
          const applied = await this.content.read(actor);
          const snapshot = ReportOccurrenceSnapshotSchema.parse(
            occurrence.snapshot
          );
          if (
            snapshot.config.autoFinalize &&
            !reportFinalizationIssues(applied.document, true).length
          ) {
            const finalized = await this.content.save({
              ...actor,
              expectedVersion: applied.report.version,
              requestKey: `schedule:${occurrence.id}:final`,
              document: applied.document,
              kind: 'final',
              reason: 'Scheduled report automatic finalization',
              automatic: true,
              editLease,
            });
            reportRevisionId = finalized.revision.id;
            status = 'completed';
          }
        }
        const deliveries =
          status === 'completed' ? await this.createDeliveries(occurrence) : [];
        await this.models.projectReportSchedule.completeOccurrence({
          occurrenceId: occurrence.id,
          runId: leased.id,
          status,
          deliveries,
          reportRevisionId,
        });
        await this.models.notification.reportChanged({
          id: `report-occurrence:${occurrence.id}:${status}`,
          userId: actor.actorId,
          actorId: actor.actorId,
          projectId: actor.projectId,
          reportId: actor.reportId,
          scheduleId: occurrence.scheduleId,
          status,
          title: current.report.title,
          url: `/intelligence/projects/${actor.projectId}/reports/${actor.reportId}`,
        });

        return {
          occurrenceId: occurrence.id,
          reportId: actor.reportId,
          status,
          sideEffectKind: 'report_schedule',
          sideEffectRecordId: occurrence.id,
        };
      } finally {
        await this.models.projectReport.releaseLease({
          ...actor,
          ...editLease,
        });
      }
    };
  }
  private async createDeliveries(occurrence: ProjectReportOccurrence) {
    const current = await this.checkOccurrence(occurrence);
    const frozen = ReportOccurrenceSnapshotSchema.parse(occurrence.snapshot);
    const delivery = reportDeliveryIntersection(
      frozen.config,
      ReportScheduleConfigSchema.parse(current.config)
    );
    if (!delivery) return [];
    return delivery.recipients.map(recipientKey => ({
      recipientKey,
      channel: delivery.channel,
      authorizationHash: projectResourceHash({
        authorization: frozen.authorization,
        delivery,
      }),
    }));
  }
  private async deliveryContext(row: ProjectReportDelivery) {
    const occurrence = await this.db.projectReportOccurrence.findUniqueOrThrow({
      where: { id: row.occurrenceId },
    });
    const current = await this.checkOccurrence(occurrence);
    if (occurrence.status !== 'completed' || !occurrence.reportId)
      throw new AccessDenied(
        'Only finalized report occurrences may be delivered'
      );
    const frozen = ReportOccurrenceSnapshotSchema.parse(occurrence.snapshot);
    const delivery = reportDeliveryIntersection(
      frozen.config,
      ReportScheduleConfigSchema.parse(current.config)
    );
    if (
      !delivery ||
      !delivery.recipients.includes(row.recipientKey) ||
      delivery.channel !== row.channel
    )
      throw new AccessDenied('Report delivery authorization changed');
    const actor = {
      projectId: occurrence.projectId,
      actorId: occurrence.actorId,
      reportId: occurrence.reportId,
    };
    const report = await this.models.projectReport.get(actor);
    if (!occurrence.reportRevisionId || report.lifecycle !== 'active')
      throw new AccessDenied('Finalized report is unavailable');
    const account = await this.models.user.get(row.recipientKey);
    const email =
      row.channel === 'email'
        ? (account?.email ?? row.recipientKey).toLowerCase()
        : undefined;
    if (email && !frozen.authorization.emailRecipients.includes(email))
      throw new AccessDenied(
        'Recipient email changed after report authorization'
      );
    if (
      row.channel === 'notification' &&
      !frozen.authorization.memberIds.includes(row.recipientKey)
    )
      throw new AccessDenied('Recipient authorization changed');
    return {
      occurrence,
      delivery,
      actor,
      report,
      revisionId: occurrence.reportRevisionId,
      account:
        account ??
        (email ? await this.models.user.getUserByEmail(email) : null),
      email,
    };
  }
  private async processDelivery(row: ProjectReportDelivery) {
    if (row.status === 'sending') {
      if (!row.mailDeliveryId) {
        if (row.leaseExpiresAt && row.leaseExpiresAt < new Date())
          await this.db.projectReportDelivery.updateMany({
            where: { id: row.id, status: 'sending', version: row.version },
            data: {
              status: 'unknown',
              resultNote: 'Delivery outcome requires manual reconciliation.',
              version: { increment: 1 },
            },
          });
        return;
      }
      const mail = await this.db.mailDelivery.findUnique({
        where: { id: row.mailDeliveryId },
      });
      let status: string | undefined;
      if (mail?.status === 'sent') status = 'sent';
      else if (mail && ['skipped', 'canceled'].includes(mail.status))
        status = 'cancelled';
      else if (mail?.status === 'failed')
        status = mail.attemptCount > 0 ? 'unknown' : 'failed';
      else if (
        mail?.status === 'sending' &&
        mail.attemptCount > 0 &&
        mail.lockedUntil &&
        mail.lockedUntil < new Date()
      )
        status = 'unknown';
      if (status)
        await this.db.projectReportDelivery.updateMany({
          where: { id: row.id, status: 'sending', version: row.version },
          data: {
            status,
            providerReceipt: mail?.providerMessageId?.slice(0, 512),
            version: { increment: 1 },
          },
        });
      return;
    }
    const { occurrence, delivery, actor, report, revisionId, account, email } =
      await this.deliveryContext(row);
    const audience: ReportAudience = {
      ...delivery.audience,
      kind: 'external',
      includeNotes: false,
    };
    const share = await this.shares.create({
      ...actor,
      requestKey: `delivery:${row.id}:share:${row.version}`,
      command: {
        operation: 'share.create',
        revisionId,
        audience,
        mode: account ? 'accounts' : 'link',
        accountIds: account ? [account.id] : [],
        expiresAt: new Date(
          +occurrence.createdAt + delivery.expiresDays * 86400000
        ).toISOString(),
        allowDownload: delivery.includeAttachment,
      },
    });
    if (!share.url) throw new AccessDenied('Report share is unavailable');
    let exportId = row.exportId;
    if (delivery.includeAttachment && row.channel === 'email') {
      exportId = (
        await this.exports.request({
          ...actor,
          requestKey: `delivery:${row.id}:pdf:${row.version}`,
          command: {
            operation: 'export',
            revisionId,
            format: 'pdf',
            audience,
          },
        })
      ).exportId;
      await this.db.projectReportDelivery.updateMany({
        where: { id: row.id, status: 'queued', version: row.version },
        data: { exportId, shareId: share.shareId },
      });
      const exported = await this.db.projectReportExport.findUniqueOrThrow({
        where: { id: exportId },
      });
      if (exported.status !== 'succeeded') {
        const run = exported.runId
          ? await this.db.aiAgentRun.findUnique({
              where: { id: exported.runId },
            })
          : null;
        if (run && ['failed', 'cancelled'].includes(run.status))
          throw new BadRequest('PDF attachment export failed');
        return;
      }
    }
    if (row.channel === 'notification') {
      await this.models.notification.reportChanged({
        id: `report-delivery:${row.id}`,
        deliveryId: row.id,
        userId: row.recipientKey,
        actorId: actor.actorId,
        projectId: actor.projectId,
        reportId: actor.reportId,
        scheduleId: occurrence.scheduleId,
        status: 'shared',
        title: report.title,
        url: share.url,
      });
      await this.db.projectReportDelivery.updateMany({
        where: { id: row.id, status: 'queued', version: row.version },
        data: {
          status: 'sent',
          shareId: share.shareId,
          providerReceipt: `notification:report-delivery:${row.id}`,
          version: { increment: 1 },
        },
      });
      return;
    }
    if (!email) throw new BadRequest('Email recipient is unavailable');
    const leaseId = randomUUID();
    const claimed = await this.db.projectReportDelivery.updateMany({
      where: { id: row.id, status: 'queued', version: row.version },
      data: {
        status: 'sending',
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 300000),
        shareId: share.shareId,
        exportId,
        version: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    const dedupeKey = `report-delivery:${row.id}:${row.version}`;
    await this.mailer.send({
      name: 'ProjectReportReady',
      to: email,
      props: {
        deliveryId: row.id,
        title: report.title,
        url: new URL(share.url, this.config.server.externalUrl).toString(),
      },
      metadata: {
        actorUserId: actor.actorId,
        recipientUserId: account?.id,
        dedupeKey,
        maxAttempts: 1,
        expiresAt: new Date(
          +occurrence.createdAt + delivery.expiresDays * 86400000
        ),
      },
    });
    const mail = await this.models.mailDelivery.findByDedupeKey(dedupeKey);
    await this.db.projectReportDelivery.updateMany({
      where: { id: row.id, status: 'sending', leaseId },
      data: {
        mailDeliveryId: mail?.id ?? null,
        ...(!mail
          ? {
              status: 'failed',
              resultNote: 'Mail queue did not accept this delivery',
            }
          : {}),
      },
    });
  }
  async authorizeMailDelivery(deliveryId: string, recipient: string) {
    const row = await this.db.projectReportDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    if (row.status !== 'sending')
      throw new AccessDenied('Report delivery is not active');
    const context = await this.deliveryContext(row);
    if (context.email !== recipient.toLowerCase())
      throw new AccessDenied('Report recipient changed');
    const share = await this.db.projectReportShare.findFirst({
      where: { id: row.shareId ?? '', status: 'active' },
      include: { current: true },
    });
    if (
      !share?.current ||
      share.current.expiresAt < new Date() ||
      projectResourceHash(share.current.audience) !==
        projectResourceHash({
          ...context.delivery.audience,
          kind: 'external',
          includeNotes: false,
        })
    )
      throw new AccessDenied('Report share authorization changed');
    if (!context.delivery.includeAttachment) return {};
    if (!row.exportId)
      throw new AccessDenied('Report PDF attachment is unavailable');
    const exported = await this.db.projectReportExport.findUniqueOrThrow({
      where: { id: row.exportId },
    });
    if (
      projectResourceHash(exported.audience) !==
      projectResourceHash(share.current.audience)
    )
      throw new AccessDenied('Report attachment authorization changed');
    const { bytes } = await this.exports.download({
      ...context.actor,
      exportId: row.exportId,
    });
    if (bytes.length > 15 * 1024 * 1024)
      throw new BadRequest('Report PDF exceeds the mail attachment limit');
    return {
      attachments: [
        {
          filename: 'project-report.pdf',
          content: bytes,
          contentType: 'application/pdf',
        },
      ],
    };
  }
  private async resolveDelivery(
    input: ProjectActor & {
      requestKey: string;
      deliveryId: string;
      expectedDeliveryVersion: number;
      result: 'sent' | 'not_sent';
      note: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    const row = await this.db.projectReportDelivery.findFirstOrThrow({
      where: { id: input.deliveryId, projectId: input.projectId },
    });
    if (input.result === 'not_sent' && row.status === 'unknown')
      await this.deliveryContext(row);
    return this.models.projectReportSchedule.resolveDelivery(input);
  }
}
