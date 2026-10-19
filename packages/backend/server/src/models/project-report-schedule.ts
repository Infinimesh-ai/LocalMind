import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { AccessDenied, BadRequest } from '../base';
import { BaseModel } from './base';
import {
  type ReportOccurrenceSnapshot,
  type ReportScheduleConfig,
  ReportScheduleConfigSchema,
} from './project-report-schedule-contract';
import {
  reportScheduleNext,
  reportSchedulePeriod,
} from './project-report-schedule-time';
import type { ProjectActor } from './project-resource';
import { projectResourceHash } from './project-resource';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
@Injectable()
export class ProjectReportScheduleModel extends BaseModel {
  async list(input: ProjectActor) {
    await this.models.projectResource.assertMember(input, false, true);
    return this.db.projectReportSchedule.findMany({
      where: { projectId: input.projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        revisions: { orderBy: { version: 'desc' } },
        occurrences: {
          orderBy: { scheduledAt: 'desc' },
          take: 100,
          include: { deliveries: true },
        },
      },
    });
  }
  async get(input: ProjectActor & { scheduleId: string }) {
    await this.models.projectResource.assertMember(input);
    const schedule = await this.db.projectReportSchedule.findFirst({
      where: { id: input.scheduleId, projectId: input.projectId },
    });
    if (!schedule) throw new AccessDenied('Report schedule is unavailable');
    return schedule;
  }
  @Transactional()
  async save(
    input: ProjectActor & {
      requestKey: string;
      scheduleId?: string;
      expectedVersion?: number;
      config: ReportScheduleConfig;
      authorization: ReportOccurrenceSnapshot['authorization'];
      rebind?: boolean;
      status?: 'active' | 'paused' | 'removed';
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    const fingerprint = projectResourceHash({
      scheduleId: input.scheduleId ?? null,
      config: input.config,
      expectedVersion: input.expectedVersion ?? null,
      rebind: input.rebind ?? false,
      status: input.status ?? null,
    });
    const prior = await this.db.projectReportScheduleRevision.findUnique({
      where: {
        projectId_actorId_requestKey: {
          projectId: input.projectId,
          actorId: input.actorId,
          requestKey: input.requestKey,
        },
      },
    });
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new BadRequest('Schedule request key was reused');
      return this.get({ ...input, scheduleId: prior.scheduleId });
    }
    const current = input.scheduleId
      ? await this.get({ ...input, scheduleId: input.scheduleId })
      : null;
    if (current && current.version !== input.expectedVersion)
      throw new BadRequest('Report schedule changed; reload before saving');
    if (current?.status === 'removed')
      throw new BadRequest('Removed schedules cannot be changed');
    await this.models.projectReport.templateRevision({
      ...input,
      revisionId: input.config.templateRevisionId,
    });
    const actorId = current && !input.rebind ? current.actorId : input.actorId;
    const authorization = { ...input.authorization, actorId };
    const status = input.status ?? current?.status ?? 'active';
    const nextRunAt = reportScheduleNext(input.config, new Date()).instant;
    const schedule = current
      ? await this.db.projectReportSchedule.update({
          where: { id: current.id, version: input.expectedVersion },
          data: {
            title: input.config.title,
            config: json(input.config),
            authorization: json(authorization),
            actorId,
            status,
            templateRevisionId: input.config.templateRevisionId,
            nextRunAt,
            version: { increment: 1 },
          },
        })
      : await this.db.projectReportSchedule.create({
          data: {
            projectId: input.projectId,
            actorId,
            title: input.config.title,
            templateRevisionId: input.config.templateRevisionId,
            config: json(input.config),
            authorization: json(authorization),
            nextRunAt,
            status,
          },
        });
    await this.db.projectReportScheduleRevision.create({
      data: {
        scheduleId: schedule.id,
        projectId: schedule.projectId,
        version: schedule.version,
        actorId: input.actorId,
        delegatedActorId: actorId,
        requestKey: input.requestKey,
        fingerprint,
        config: json(input.config),
        authorization: json(authorization),
        status,
        nextRunAt,
      },
    });
    if (status !== 'active') {
      await this.db.projectReportOccurrence.updateMany({
        where: { scheduleId: schedule.id, status: 'queued' },
        data: {
          status: 'paused',
          failureCode: 'SCHEDULE_PAUSED',
          version: { increment: 1 },
        },
      });
      await this.db.projectReportDelivery.updateMany({
        where: { occurrence: { scheduleId: schedule.id }, status: 'queued' },
        data: { status: 'cancelled', version: { increment: 1 } },
      });
    }
    return schedule;
  }
  @Transactional()
  async claimDue(scheduleId: string, now = new Date()) {
    await this.db
      .$queryRaw`SELECT id FROM project_report_schedules WHERE id=${scheduleId} FOR UPDATE`;
    const schedule = await this.db.projectReportSchedule.findUniqueOrThrow({
      where: { id: scheduleId },
    });
    if (schedule.status !== 'active' || schedule.nextRunAt > now) return null;
    const config = ReportScheduleConfigSchema.parse(schedule.config);
    let instant = schedule.nextRunAt;
    let next = reportScheduleNext(config, new Date(+instant - 1));
    const due: Array<typeof next> = [];
    // At most a century per transaction. Anything older is preserved for the next claim.
    while (instant <= now && due.length < 5200) {
      due.push(next);
      next = reportScheduleNext(config, instant);
      instant = next.instant;
    }
    if (instant <= now)
      throw new BadRequest(
        'Schedule catch-up exceeds the retained calendar bound'
      );
    let latest = null;
    for (const [index, item] of due.entries()) {
      const snapshot = {
        config,
        authorization: schedule.authorization,
        period: reportSchedulePeriod(config, item.instant),
      };
      latest = await this.db.projectReportOccurrence.upsert({
        where: {
          scheduleId_nominalTime_timeZone: {
            scheduleId,
            nominalTime: item.nominal,
            timeZone: config.timeZone,
          },
        },
        create: {
          projectId: schedule.projectId,
          scheduleId,
          nominalTime: item.nominal,
          timeZone: config.timeZone,
          configVersion: schedule.version,
          actorId: schedule.actorId,
          snapshot: json(snapshot),
          scheduledAt: item.instant,
          status: index === due.length - 1 ? 'queued' : 'missed',
          failureCode: index === due.length - 1 ? null : 'MISSED_WHILE_OFFLINE',
        },
        update: {},
      });
    }
    await this.db.projectReportSchedule.update({
      where: { id: scheduleId },
      data: { nextRunAt: next.instant },
    });
    return latest;
  }
  @Transactional()
  async manual(
    input: ProjectActor & {
      scheduleId: string;
      expectedVersion: number;
      periodStart?: string;
      periodEnd?: string;
    }
  ) {
    await this.models.projectResource.assertMember(input, true);
    const schedule = await this.get(input);
    if (
      schedule.version !== input.expectedVersion ||
      schedule.status !== 'active'
    )
      throw new BadRequest('Report schedule changed');
    const config = ReportScheduleConfigSchema.parse(schedule.config);
    if (Boolean(input.periodStart) !== Boolean(input.periodEnd))
      throw new BadRequest('Both report period boundaries are required');
    const period =
      input.periodStart && input.periodEnd
        ? {
            start: input.periodStart,
            end: input.periodEnd,
            timeZone: config.timeZone,
          }
        : reportSchedulePeriod(config, new Date());
    if (+new Date(period.start) >= +new Date(period.end))
      throw new BadRequest('Report period is invalid');
    const existing = await this.db.projectReportOccurrence.findFirst({
      where: {
        scheduleId: schedule.id,
        timeZone: config.timeZone,
        AND: [
          { snapshot: { path: ['period', 'start'], equals: period.start } },
          { snapshot: { path: ['period', 'end'], equals: period.end } },
        ],
      },
    });
    if (existing) {
      if (existing.status === 'missed')
        return this.db.projectReportOccurrence.update({
          where: { id: existing.id, status: 'missed' },
          data: {
            status: 'queued',
            failureCode: null,
            version: { increment: 1 },
          },
        });
      return existing;
    }
    const nominalTime = `period:${projectResourceHash(period).slice(0, 48)}`;
    return this.db.projectReportOccurrence.upsert({
      where: {
        scheduleId_nominalTime_timeZone: {
          scheduleId: schedule.id,
          nominalTime,
          timeZone: config.timeZone,
        },
      },
      create: {
        scheduleId: schedule.id,
        projectId: schedule.projectId,
        nominalTime,
        timeZone: config.timeZone,
        configVersion: schedule.version,
        actorId: schedule.actorId,
        snapshot: json({
          config,
          authorization: schedule.authorization,
          period,
        }),
        scheduledAt: new Date(),
      },
      update: {},
    });
  }
  @Transactional()
  async notification(input: {
    id: string;
    userId: string;
    actorId: string;
    projectId: string;
    scheduleId: string;
    reportId?: string;
    status: string;
    title: string;
    url: string;
  }) {
    return this.models.notification.reportChanged(input);
  }
  @Transactional()
  async pauseForReport(input: ProjectActor & { reportId: string }) {
    await this.models.projectResource.assertMember(input, true);
    const occurrences = await this.db.projectReportOccurrence.findMany({
      where: { projectId: input.projectId, reportId: input.reportId },
      select: { scheduleId: true },
    });
    return this.pauseSchedules(input, [
      ...new Set(occurrences.map(row => row.scheduleId)),
    ]);
  }
  @Transactional()
  async pauseProject(input: ProjectActor) {
    await this.models.projectResource.assertMember(input, true);
    const schedules = await this.db.projectReportSchedule.findMany({
      where: { projectId: input.projectId, status: 'active' },
      select: { id: true },
    });
    return this.pauseSchedules(
      input,
      schedules.map(row => row.id)
    );
  }
  private async pauseSchedules(input: ProjectActor, ids: string[]) {
    for (const id of ids) {
      const current = await this.get({ ...input, scheduleId: id });
      if (current.status !== 'active') continue;
      await this.save({
        ...input,
        scheduleId: id,
        expectedVersion: current.version,
        requestKey: `lifecycle:${id}:${current.version}`,
        config: ReportScheduleConfigSchema.parse(current.config),
        authorization:
          current.authorization as ReportOccurrenceSnapshot['authorization'],
        status: 'paused',
      });
    }
  }
  @Transactional()
  async completeOccurrence(input: {
    occurrenceId: string;
    runId: string;
    status: 'completed' | 'needs_review';
    reportRevisionId?: string;
    deliveries: Array<{
      recipientKey: string;
      channel: string;
      authorizationHash: string;
    }>;
  }) {
    const occurrence = await this.db.projectReportOccurrence.findUniqueOrThrow({
      where: { id: input.occurrenceId },
    });
    if (occurrence.status !== 'finalizing' || occurrence.runId !== input.runId)
      throw new BadRequest('Report occurrence changed during finalization');
    await this.db.projectReportOccurrence.update({
      where: { id: occurrence.id },
      data: {
        status: input.status,
        reportRevisionId: input.reportRevisionId,
        version: { increment: 1 },
      },
    });
    if (input.status === 'completed')
      await this.db.projectReportDelivery.createMany({
        data: input.deliveries.map(item => ({
          ...item,
          projectId: occurrence.projectId,
          occurrenceId: occurrence.id,
        })),
        skipDuplicates: true,
      });
  }

  @Transactional()
  async resolveDelivery(
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
      include: { occurrence: true },
    });
    if (!row.occurrence.reportId)
      throw new BadRequest('Report delivery has no report');
    const actor = { ...input, reportId: row.occurrence.reportId };
    const fingerprint = projectResourceHash({
      deliveryId: input.deliveryId,
      version: input.expectedDeliveryVersion,
      result: input.result,
      note: input.note,
    });
    const prior = await this.models.projectReport.findRequest({
      ...actor,
      fingerprint,
      operation: 'delivery.resolve',
    });
    if (prior) return row;
    if (
      row.status !== 'unknown' ||
      row.version !== input.expectedDeliveryVersion
    )
      throw new BadRequest(
        'Only an unchanged uncertain delivery can be reconciled'
      );
    const result = await this.db.projectReportDelivery.update({
      where: {
        id: row.id,
        version: input.expectedDeliveryVersion,
        status: 'unknown',
      },
      data: {
        status: input.result === 'sent' ? 'sent' : 'queued',
        mailDeliveryId: null,
        leaseId: null,
        leaseExpiresAt: null,
        shareId: null,
        exportId: null,
        resultNote: input.note,
        version: { increment: 1 },
      },
    });
    await this.models.projectReport.record({
      ...actor,
      fingerprint,
      operation: 'delivery.resolve',
      result: {
        deliveryId: row.id,
        previousVersion: row.version,
        version: result.version,
        previousStatus: row.status,
        status: result.status,
        note: input.note,
        mailDeliveryId: row.mailDeliveryId,
        providerReceipt: row.providerReceipt,
        shareId: row.shareId,
        exportId: row.exportId,
      },
    });
    return result;
  }

  @Transactional()
  async pauseForFailure(input: {
    scheduleId: string;
    version: number;
    code: string;
  }) {
    const schedule = await this.db.projectReportSchedule.findUniqueOrThrow({
      where: { id: input.scheduleId },
    });
    if (schedule.version !== input.version || schedule.status !== 'active')
      return;
    const updated = await this.db.projectReportSchedule.updateMany({
      where: { id: input.scheduleId, version: input.version, status: 'active' },
      data: { status: 'paused', version: { increment: 1 } },
    });
    if (!updated.count) return;
    await this.db.projectReportScheduleRevision.create({
      data: {
        scheduleId: schedule.id,
        projectId: schedule.projectId,
        version: schedule.version + 1,
        actorId: schedule.actorId,
        delegatedActorId: schedule.actorId,
        requestKey: `auto-pause:${schedule.id}:${schedule.version}`,
        fingerprint: projectResourceHash({
          code: input.code,
          version: schedule.version,
        }),
        config: json(schedule.config),
        authorization: json(schedule.authorization),
        status: 'paused',
        nextRunAt: schedule.nextRunAt,
      },
    });
    await this.notification({
      id: `report-schedule-paused:${schedule.id}:${schedule.version}`,
      userId: schedule.actorId,
      actorId: schedule.actorId,
      projectId: schedule.projectId,
      scheduleId: schedule.id,
      status: 'paused',
      title: schedule.title,
      url: `/intelligence/projects/${schedule.projectId}/reports`,
    });
  }
}
