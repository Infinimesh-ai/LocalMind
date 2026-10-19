import { randomUUID } from 'node:crypto';

import { ReportDocumentSchema } from '@localmind/office/report';
import { PrismaClient } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import { Config, ConfigFactory } from '../../base';
import { ProjectBlobStorage } from '../../core/project';
import { ProjectReportContentService } from '../../core/project-report/content';
import {
  PROJECT_REPORT_FINALIZE_WORKFLOW,
  ProjectReportScheduleService,
} from '../../core/project-report/schedule';
import { ProjectReportSourceService } from '../../core/project-report/source-service';
import {
  PROJECT_REPORT_WORKFLOW,
  REPORT_PHASES,
  ReportCheckpointSchema,
} from '../../models/project-report-generation-contract';
import { ReportScheduleConfigSchema } from '../../models/project-report-schedule-contract';
import { ByokService } from '../../plugins/copilot/byok';
import { CopilotProjectAgentRuntimeWorker } from '../../plugins/copilot/project-agent-runtime-worker';
import { CopilotProviderType } from '../../plugins/copilot/providers';
import { ProjectReportGenerationService } from '../../plugins/copilot/report-generation-service';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
test.before(async () => {
  app = await createTestingApp();
});
test.beforeEach(async () => {
  await app.initTestingDB();
});
test.after.always(async () => {
  await app.close();
});
test.afterEach.always(() => Sinon.restore());
async function fixture() {
  const db = app.get(PrismaClient);
  const [creator, member, outsider] = await Promise.all(
    ['schedule-owner', 'schedule-member', 'schedule-outsider'].map(name =>
      app.createUser(`${name}-${randomUUID()}@example.com`, { name })
    )
  );
  const project = await db.aiContextProject.create({
    data: {
      name: 'Report worker acceptance',
      members: {
        create: [
          { userId: creator.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
      },
    },
  });
  const actor = { projectId: project.id, actorId: creator.id };
  const templates = await app.models.projectReport.templates(actor);
  const content = app.get(ProjectReportContentService);
  const created = await content.create({
    ...actor,
    requestKey: 'create',
    command: {
      operation: 'create',
      title: 'Report',
      period: {
        start: '2026-10-01T00:00:00Z',
        end: '2026-10-08T00:00:00Z',
        timeZone: 'UTC',
        weekStartsOn: 1,
      },
      templateRevisionId: templates[0]!.current!.id,
      selection: { kind: 'all' },
      generate: false,
    },
  });
  const config = ReportScheduleConfigSchema.parse({
    title: 'Weekly',
    templateRevisionId: templates[0]!.current!.id,
    selection: { kind: 'all' },
    timeZone: 'UTC',
    frequency: 'weekly',
    day: 1,
    time: '09:00',
    period: 'previous_week',
    autoFinalize: false,
    delivery: {
      enabled: false,
      channel: 'notification',
      recipients: [],
      includeAttachment: false,
      expiresDays: 7,
      audience: {
        kind: 'external',
        chapterIds: created.document.chapters.map(chapter => chapter.id),
        includeNotes: false,
        includeSources: false,
      },
    },
  });
  return {
    db,
    creator,
    member,
    outsider,
    project,
    actor,
    content,
    created,
    config,
    generation: app.get(ProjectReportGenerationService),
    schedule: app.get(ProjectReportScheduleService),
    worker: app.get(CopilotProjectAgentRuntimeWorker),
    scope: { ...actor, reportId: created.report.id },
  };
}

for (const scenario of ['verified', 'unresolved', 'incomplete'] as const) {
  test.serial(`A44 scheduled finalizer worker gate: ${scenario}`, async t => {
    const f = await fixture();
    const generated = await f.generation.request({
      ...f.scope,
      requestKey: 'gate-generate',
      expectedVersion: 1,
    });
    await f.worker.run({ projectId: f.project.id, runId: generated.runId });
    const candidate = await f.generation.candidate({
      ...f.scope,
      runId: generated.runId,
    });
    // Supply controlled candidate states to test the real finalizer, persistent
    // revisions, worker leases and delivery gate independently of model quality.
    const document = ReportDocumentSchema.parse({
      ...candidate.document,
      issues: scenario === 'unresolved' ? candidate.document.issues : [],
      coverage:
        scenario === 'incomplete'
          ? {
              ...candidate.document.coverage,
              discovered: 1,
              selected: 1,
              parsed: 0,
              omitted: 1,
            }
          : candidate.document.coverage,
      chapters: candidate.document.chapters.map((chapter, index) =>
        index
          ? chapter
          : {
              ...chapter,
              nodes: [
                {
                  id: 'verified-manual-node',
                  type: 'paragraph',
                  text: 'Fictional verified report content.',
                  claimKind: 'manual',
                  sourceIds: [],
                },
              ],
            }
      ),
    });
    Sinon.stub(f.generation, 'candidate').resolves({
      ...candidate,
      document,
      conflicts: [],
    });
    Sinon.stub(app.get(ByokService), 'getProfiles').resolves([
      {
        id: 'finalizer-policy-fixture',
        type: CopilotProviderType.OpenAI,
        config: { apiKey: 'fictional-non-network-fixture' },
        enabled: true,
      },
    ]);
    const config = {
      ...f.config,
      autoFinalize: true,
      delivery: {
        ...f.config.delivery,
        enabled: true,
        recipients: [f.member.id],
        audience: {
          ...f.config.delivery.audience,
          chapterIds: document.chapters.map(chapter => chapter.id),
        },
      },
    };
    const authorization = {
      actorId: f.creator.id,
      memberIds: [f.member.id],
      emailRecipients: [],
    };
    const schedule = await app.models.projectReportSchedule.save({
      ...f.actor,
      requestKey: 'gate-plan',
      config,
      authorization,
    });
    const occurrence = await f.db.projectReportOccurrence.create({
      data: {
        projectId: f.project.id,
        scheduleId: schedule.id,
        nominalTime: `gate-${scenario}`,
        timeZone: 'UTC',
        configVersion: schedule.version,
        snapshot: {
          config,
          authorization,
          period: {
            start: document.period.start,
            end: document.period.end,
            timeZone: document.period.timeZone,
          },
        },
        status: 'finalizing',
        reportId: f.scope.reportId,
        actorId: f.creator.id,
      },
    });
    const run = await app.models.copilotProjectAgentRuntime.prepare({
      ...f.actor,
      sourceType: 'project_report',
      workflow: PROJECT_REPORT_FINALIZE_WORKFLOW,
      requestKey: 'gate-finalize',
      title: 'Test finalizer gate',
      command: {
        occurrenceId: occurrence.id,
        reportId: f.scope.reportId,
        generationRunId: generated.runId,
      },
    });
    await f.db.projectReportOccurrence.update({
      where: { id: occurrence.id },
      data: { runId: run.id },
    });
    await f.worker.run({ projectId: f.project.id, runId: run.id });
    const completed = await f.db.projectReportOccurrence.findUniqueOrThrow({
      where: { id: occurrence.id },
    });
    const final = await f.content.read(f.scope);
    const finishedRun = await f.db.aiAgentRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { steps: true },
    });
    t.is(
      finishedRun.status,
      'completed',
      JSON.stringify({
        failureCode: finishedRun.failureCode,
        steps: finishedRun.steps.map(step => ({
          key: step.stepKey,
          output: step.outputSummary,
        })),
      })
    );
    t.is(
      completed.status,
      scenario === 'verified' ? 'completed' : 'needs_review'
    );
    t.is(!!final.report.latestFinalRevisionId, scenario === 'verified');
    t.is(!!completed.reportRevisionId, scenario === 'verified');
    t.is(
      await f.db.projectReportDelivery.count({
        where: { occurrenceId: occurrence.id },
      }),
      scenario === 'verified' ? 1 : 0
    );
  });
}

test.serial(
  'Report generation has durable eight stages, immutable checkpoint blobs and candidate only',
  async t => {
    const f = await fixture();
    const input = { ...f.scope, requestKey: 'generation', expectedVersion: 1 };
    const [first, duplicate] = await Promise.all([
      f.generation.request(input),
      f.generation.request(input),
    ]);
    t.is(first.runId, duplicate.runId);
    await t.throwsAsync(
      f.generation.request({ ...input, instruction: 'A different request' })
    );
    await f.worker.run({ projectId: f.project.id, runId: first.runId });
    const run = await f.db.aiAgentRun.findUniqueOrThrow({
      where: { id: first.runId },
      include: { steps: true },
    });
    t.is(run.status, 'completed');
    t.is(run.workflow, PROJECT_REPORT_WORKFLOW);
    for (const key of REPORT_PHASES)
      t.is(run.steps.find(step => step.stepKey === key)?.status, 'completed');
    const report = await f.content.read(f.scope);
    t.is(report.report.version, 1);
    t.is(report.revision.id, f.created.revision.id);
    const candidate = await f.generation.candidate({
      ...f.scope,
      runId: first.runId,
    });
    t.true(
      candidate.document.issues.some(
        issue => issue.id === 'no-project-documents'
      )
    );
    t.is(candidate.document.creator.actorId, f.creator.id);
    t.is(
      await f.db.projectReportSourceManifest.count({
        where: { reportId: f.created.report.id },
      }),
      1
    );
    const checkpoints = REPORT_PHASES.filter(key => key !== 'persist').map(
      key =>
        ReportCheckpointSchema.parse(
          run.steps.find(step => step.stepKey === key)?.outputSummary
        )
    );
    // Identical stage outputs legitimately share a content-addressed Blob.
    // Every checkpoint must still retain its exact immutable evidence.
    for (const checkpoint of checkpoints) {
      t.truthy(
        await f.db.projectReportBlobReference.findFirst({
          where: {
            reportId: f.created.report.id,
            blobKey: checkpoint.blobKey,
          },
        })
      );
      const blob = await f.db.projectBlob.findUniqueOrThrow({
        where: {
          projectId_key: {
            projectId: f.project.id,
            key: checkpoint.blobKey,
          },
        },
      });
      t.is(blob.fingerprint, checkpoint.fingerprint);
    }
    await t.throwsAsync(
      f.db.projectBlob.update({
        where: {
          projectId_key: {
            projectId: f.project.id,
            key: checkpoints[0]!.blobKey,
          },
        },
        data: { mimeType: 'application/tampered' },
      })
    );
    await t.throwsAsync(
      f.db.projectReportRevision.update({
        where: { id: candidate.candidateRevisionId },
        data: { reason: 'tamper' },
      })
    );
    await t.throwsAsync(
      f.generation.candidate({
        ...f.scope,
        actorId: f.outsider.id,
        runId: first.runId,
      })
    );
  }
);

test.serial(
  'Lifecycle cancellation cancels exact report runs from every actor without expanding to unrelated tasks',
  async t => {
    const f = await fixture();
    const own = await f.generation.request({
      ...f.scope,
      requestKey: 'one',
      expectedVersion: 1,
    });
    const other = await f.generation.request({
      ...f.scope,
      actorId: f.member.id,
      requestKey: 'one',
      expectedVersion: 1,
    });
    t.not(own.runId, other.runId);
    await f.db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: f.project.id, userId: f.member.id },
      },
    });
    await app.models.copilotProjectAgentRuntime.cancelReportRuns(f.scope);
    t.is(
      (await f.db.aiAgentRun.findUniqueOrThrow({ where: { id: own.runId } }))
        .status,
      'cancelled'
    );
    t.is(
      (await f.db.aiAgentRun.findUniqueOrThrow({ where: { id: other.runId } }))
        .status,
      'cancelled'
    );
    t.is(
      await f.db.aiAgentTimelineEvent.count({
        where: { runId: other.runId, eventType: 'run_cancellation' },
      }),
      1
    );
  }
);

test.serial(
  'Schedule catch-up persists missed occurrences, freezes configuration and pauses when delegate loses access',
  async t => {
    const f = await fixture();
    const schedule = await app.models.projectReportSchedule.save({
      ...f.actor,
      requestKey: 'schedule',
      config: f.config,
      authorization: {
        actorId: f.creator.id,
        memberIds: [],
        emailRecipients: [],
      },
    });
    await f.db.projectReportSchedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date('2026-09-07T09:00:00Z') },
    });
    const latest = await app.models.projectReportSchedule.claimDue(
      schedule.id,
      new Date('2026-09-29T12:00:00Z')
    );
    t.is(latest?.nominalTime, '2026-09-28T09:00');
    t.is(
      await f.db.projectReportOccurrence.count({
        where: { scheduleId: schedule.id, status: 'missed' },
      }),
      3
    );
    t.is(
      await f.db.projectReportOccurrence.count({
        where: { scheduleId: schedule.id, status: 'queued' },
      }),
      1
    );
    const changed = await app.models.projectReportSchedule.save({
      ...f.actor,
      actorId: f.member.id,
      requestKey: 'edit-schedule',
      scheduleId: schedule.id,
      expectedVersion: 1,
      config: { ...f.config, title: 'Next generation title' },
      authorization: {
        actorId: f.member.id,
        memberIds: [],
        emailRecipients: [],
      },
    });
    t.is(changed.actorId, f.creator.id);
    t.is(
      (latest!.snapshot as { config: { title: string } }).config.title,
      'Weekly'
    );
    const revision = await f.db.projectReportScheduleRevision.findFirstOrThrow({
      where: { scheduleId: schedule.id },
    });
    await t.throwsAsync(
      f.db.projectReportScheduleRevision.update({
        where: { id: revision.id },
        data: { status: 'removed' },
      })
    );
    await f.db.aiContextProjectMember.update({
      where: {
        projectId_userId: { projectId: f.project.id, userId: f.member.id },
      },
      data: { role: 'owner' },
    });
    await f.db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: f.project.id, userId: f.creator.id },
      },
    });
    await f.schedule.tick();
    t.is(
      (
        await f.db.projectReportOccurrence.findUniqueOrThrow({
          where: { id: latest!.id },
        })
      ).status,
      'failed'
    );
    // The same delegated creator lost access; pause the current revision without rebinding.
    t.is(
      (
        await f.db.projectReportSchedule.findUniqueOrThrow({
          where: { id: schedule.id },
        })
      ).version,
      3
    );
  }
);

test.serial(
  'Report retry retains checkpoints and old worker leases cannot write late results',
  async t => {
    const f = await fixture();
    const task = await f.generation.request({
      ...f.scope,
      requestKey: 'retry-source',
      expectedVersion: 1,
    });
    const run = await app.models.copilotProjectAgentRuntime.acquire({
      projectId: f.project.id,
      runId: task.runId,
      workerLeaseId: 'worker-one',
    });
    if (!run) throw new Error('Expected worker lease');
    const lease = {
      ...f.actor,
      runId: run.id,
      workerLeaseId: 'worker-one',
      workerAttempt: run.workerAttempt,
    };
    await app.models.projectReportGeneration.checkpoint({
      ...lease,
      key: 'custom-capture',
      output: { blobKey: 'captured-blob', fingerprint: 'a'.repeat(64) },
    });
    await app.models.copilotProjectAgentRuntime.fail(
      lease,
      'REPORT_MODEL_BUDGET_EXCEEDED',
      'Configured report budget was reached'
    );
    await f.generation.retry({ ...f.scope, runId: run.id });
    const retry = await f.db.aiAgentRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { steps: true },
    });
    t.is(retry.status, 'queued');
    t.is(
      retry.steps.find(step => step.stepKey === 'custom-capture')?.status,
      'completed'
    );
    await t.throwsAsync(
      app.models.projectReportGeneration.checkpoint({
        ...lease,
        key: 'late-result',
        output: { unsafe: true },
      })
    );
    const replacement = await app.models.copilotProjectAgentRuntime.acquire({
      projectId: f.project.id,
      runId: run.id,
      workerLeaseId: 'worker-two',
    });
    t.is(replacement?.workerAttempt, run.workerAttempt + 1);
    await app.models.copilotProjectAgentRuntime.cancelReportRuns(f.scope);
    if (replacement)
      await t.throwsAsync(
        app.models.projectReportGeneration.checkpoint({
          ...f.actor,
          runId: run.id,
          workerLeaseId: 'worker-two',
          workerAttempt: replacement.workerAttempt,
          key: 'cancelled-result',
          output: { unsafe: true },
        })
      );
  }
);

test.serial(
  'A56 enumerates every page of 1005 fixed document revisions and reports a bounded incomplete scope',
  async t => {
    t.timeout(360000);
    const f = await fixture();
    const blobs = app.get(ProjectBlobStorage);
    const blob = await blobs.put({
      ...f.actor,
      bytes: Buffer.from('Fictional source with an explicitly planned task.'),
      mimeType: 'text/plain',
    });
    const rows = Array.from({ length: 1005 }, (_, index) => ({
      id: randomUUID(),
      projectId: f.project.id,
      kind: 'file' as const,
      title: `Fictional source ${index}.txt`,
      sortKey: String(index).padStart(8, '0'),
      contentVersion: 0,
      creationKey: `large-source-${index}`,
      creationHash: blob.fingerprint,
      createdBy: f.creator.id,
    }));
    await f.db.$transaction(async tx => {
      await tx.projectResource.createMany({ data: rows });
      await tx.projectResourceRevision.createMany({
        data: rows.map(row => ({
          projectId: f.project.id,
          resourceId: row.id,
          sequence: 1,
          blobKey: blob.key,
          fingerprint: blob.fingerprint,
          origin: 'user',
          requestKey: row.creationKey,
          requestHash: row.creationHash,
          createdBy: f.creator.id,
        })),
      });
      await tx.projectResource.updateMany({
        where: { id: { in: rows.map(row => row.id) } },
        data: { contentVersion: 1 },
      });
    });
    const factory = app.get(ConfigFactory);
    const previous = app.get(Config).projectReport.maxResources;
    const input = {
      ...f.actor,
      selection: { kind: 'all' as const },
      cutoffAt: new Date().toISOString(),
      period: f.created.document.period,
    };
    try {
      factory.override({ projectReport: { maxResources: 2000 } });
      const complete = await app
        .get(ProjectReportSourceService)
        .discover(input);
      t.true(complete.enumerationComplete);
      t.is(complete.resources.length, rows.length);
      t.is(
        new Set(complete.resources.map(row => row.source.resourceId)).size,
        1005
      );
      t.true(complete.resources.every(row => row.source.revision === '1'));
      factory.override({ projectReport: { maxResources: 50 } });
      const limited = await app.get(ProjectReportSourceService).discover(input);
      t.false(limited.enumerationComplete);
      t.is(limited.resources.length, 50);
      t.true(limited.discovered >= limited.resources.length);
    } finally {
      factory.override({ projectReport: { maxResources: previous } });
    }
  }
);

test.serial(
  'Report notifications recheck current membership before exposing report metadata',
  async t => {
    const f = await fixture();
    const body = {
      createdByUserId: f.creator.id,
      projectId: f.project.id,
      reportId: f.created.report.id,
      status: 'completed',
      title: 'Private report title',
      url: `/projects/${f.project.id}/reports/${f.created.report.id}`,
    };
    const active = await app.models.notification.presentReportNotification(
      body,
      f.member.id
    );
    t.not(active.status, 'unavailable');
    await f.db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: f.project.id, userId: f.member.id },
      },
    });
    const revoked = await app.models.notification.presentReportNotification(
      body,
      f.member.id
    );
    t.is(revoked.status, 'unavailable');
    t.is(revoked.title, '');
    t.is(revoked.projectId, '');
    t.is(revoked.reportId, null);
    t.is(revoked.url, '');
  }
);
