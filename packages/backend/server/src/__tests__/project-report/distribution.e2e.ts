import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { ReportDocumentSchema } from '@localmind/office/report';
import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { ConfigFactory, CryptoHelper } from '../../base';
import { Mailer } from '../../core/mail';
import { MailJob } from '../../core/mail/job';
import { MailSender } from '../../core/mail/sender';
import { ProjectReportContentService } from '../../core/project-report/content';
import { ProjectReportScheduleService } from '../../core/project-report/schedule';
import { ReportScheduleConfigSchema } from '../../models/project-report-schedule-contract';
import { projectResourceHash } from '../../models/project-resource';
import { CopilotProjectAgentRuntimeWorker } from '../../plugins/copilot/project-agent-runtime-worker';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
let smtp: Server;
let smtpPort = 0;
let loseAcknowledgement = false;
const messages: string[] = [];
const sockets = new Set<Socket>();

test.before(async () => {
  // This SMTP sink binds only to loopback. No message can reach an outside recipient.
  smtp = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 fictional-report-sink ESMTP\r\n');
    let pending = '';
    let data = false;
    socket.on('data', chunk => {
      pending += chunk;
      while (pending.includes('\r\n')) {
        if (data) {
          const end = pending.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages.push(pending.slice(0, end));
          pending = pending.slice(end + 5);
          data = false;
          if (loseAcknowledgement) {
            socket.destroy();
            return;
          }
          socket.write('250 2.0.0 accepted-by-fictional-sink\r\n');
          continue;
        }
        const end = pending.indexOf('\r\n');
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (/^EHLO /i.test(line))
          socket.write('250-fictional-report-sink\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH /i.test(line))
          socket.write('235 2.7.0 authenticated\r\n');
        else if (/^DATA$/i.test(line)) {
          data = true;
          socket.write('354 End with a dot\r\n');
        } else if (/^QUIT$/i.test(line)) socket.end('221 goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(0, '127.0.0.1', resolve);
  });
  const address = smtp.address();
  if (!address || typeof address === 'string')
    throw new Error('SMTP listener unavailable');
  smtpPort = address.port;
  app = await createTestingApp({
    tapModule: builder => builder.overrideProvider(Mailer).useClass(Mailer),
  });
  app.get(ConfigFactory).override({
    mailer: {
      SMTP: {
        host: '127.0.0.1',
        port: smtpPort,
        username: 'fictional-sink',
        password: 'fictional-sink',
        ignoreTLS: true,
      },
    },
  });
  app.get(MailSender).onConfigInit();
});
test.beforeEach(async () => {
  messages.length = 0;
  loseAcknowledgement = false;
  await app.initTestingDB();
});
test.after.always(async () => {
  await app?.close();
  for (const socket of sockets) socket.destroy();
  if (smtp) await new Promise<void>(resolve => smtp.close(() => resolve()));
});

async function fixture(includeAttachment = false) {
  const db = app.get(PrismaClient);
  const owner = await app.createUser(
    `report-mail-owner-${randomUUID()}@example.invalid`
  );
  const recipient = await app.createUser(
    `report-mail-recipient-${randomUUID()}@example.invalid`
  );
  const project = await db.aiContextProject.create({
    data: {
      name: 'Fictional distribution acceptance',
      members: { create: { userId: owner.id, role: 'owner' } },
    },
  });
  const actor = { projectId: project.id, actorId: owner.id };
  await db.aiProjectByokConfig.create({
    data: {
      id: 'global',
      revision: 1,
      provider: 'openai',
      encryptedApiKey: app.get(CryptoHelper).encrypt('fictional-local-only'),
      endpoint: 'http://127.0.0.1:1/v1',
      modelId: 'fictional-local-only',
      enabled: true,
      workOrderEnabled: false,
      lastValidatedAt: new Date(),
      updatedBy: owner.id,
    },
  });
  const templates = await app.models.projectReport.templates(actor);
  const templateRevisionId = templates[0].current!.id;
  const content = app.get(ProjectReportContentService);
  const created = await content.create({
    ...actor,
    requestKey: 'mail-report',
    command: {
      operation: 'create',
      title: 'Fictional accepted report',
      templateRevisionId,
      selection: { kind: 'all' },
      generate: false,
      period: {
        start: '2026-10-01T00:00:00Z',
        end: '2026-10-08T00:00:00Z',
        timeZone: 'UTC',
        weekStartsOn: 1,
      },
    },
  });
  const scope = { ...actor, reportId: created.report.id };
  const held = await app.models.projectReport.acquireLease({
    ...scope,
    tabId: 'mail-fixture',
  });
  if (!held.lease.leaseId) throw new Error('Report editing lease unavailable');
  const document = ReportDocumentSchema.parse({
    ...created.document,
    chapters: created.document.chapters.map((chapter, index) =>
      index === 0
        ? {
            ...chapter,
            nodes: [
              {
                id: 'fictional-manual',
                type: 'paragraph',
                text: 'Fictional report for local SMTP acceptance only.',
                claimKind: 'manual',
                sourceIds: [],
                locked: false,
              },
            ],
          }
        : chapter
    ),
  });
  const final = await content.save({
    ...scope,
    requestKey: 'mail-final',
    expectedVersion: 1,
    kind: 'final',
    document,
    editLease: {
      kind: 'user',
      tabId: 'mail-fixture',
      leaseId: held.lease.leaseId,
    },
    reason: 'Fictional mail test',
  });
  const config = ReportScheduleConfigSchema.parse({
    title: 'Fictional delivery plan',
    templateRevisionId,
    selection: { kind: 'all' },
    timeZone: 'UTC',
    frequency: 'weekly',
    day: 1,
    time: '09:00',
    period: 'previous_week',
    autoFinalize: true,
    delivery: {
      enabled: true,
      channel: 'email',
      recipients: [recipient.id],
      includeAttachment,
      expiresDays: 7,
      audience: {
        kind: 'external',
        chapterIds: final.document.chapters.map(chapter => chapter.id),
        includeNotes: false,
        includeSources: false,
      },
    },
  });
  const authorization = {
    actorId: owner.id,
    memberIds: [recipient.id],
    emailRecipients: [recipient.email.toLowerCase()],
  };
  const schedule = await app.models.projectReportSchedule.save({
    ...actor,
    requestKey: 'mail-plan',
    config,
    authorization,
  });
  const occurrence = await db.projectReportOccurrence.create({
    data: {
      projectId: project.id,
      scheduleId: schedule.id,
      nominalTime: `fixture-${randomUUID()}`,
      timeZone: 'UTC',
      configVersion: schedule.version,
      snapshot: {
        config,
        authorization,
        period: {
          start: document.period.start,
          end: document.period.end,
          timeZone: 'UTC',
        },
      },
      status: 'completed',
      reportId: created.report.id,
      reportRevisionId: final.revision.id,
      actorId: owner.id,
    },
  });
  const delivery = await db.projectReportDelivery.create({
    data: {
      projectId: project.id,
      occurrenceId: occurrence.id,
      recipientKey: recipient.id,
      channel: 'email',
      authorizationHash: projectResourceHash({ authorization, config }),
    },
  });
  return {
    db,
    actor,
    owner,
    recipient,
    project,
    scope,
    final,
    config,
    authorization,
    schedule,
    occurrence,
    delivery,
    service: app.get(ProjectReportScheduleService),
  };
}

async function queueDelivery(f: Awaited<ReturnType<typeof fixture>>) {
  await f.service.tick();
  let row = await f.db.projectReportDelivery.findUniqueOrThrow({
    where: { id: f.delivery.id },
  });
  if (row.exportId) {
    const exported = await f.db.projectReportExport.findUniqueOrThrow({
      where: { id: row.exportId },
    });
    if (exported.runId) {
      await app
        .get(CopilotProjectAgentRuntimeWorker)
        .run({ projectId: f.project.id, runId: exported.runId });
      const run = await f.db.aiAgentRun.findUniqueOrThrow({
        where: { id: exported.runId },
      });
      if (run.status === 'failed')
        throw new Error(`Report attachment failed: ${run.failureCode}`);
    }
    await f.service.tick();
    row = await f.db.projectReportDelivery.findUniqueOrThrow({
      where: { id: f.delivery.id },
    });
  }
  return row;
}

test.serial(
  'A45 real Mailer and MailJob send a fixed authorized PDF only to the local SMTP sink',
  async t => {
    t.timeout(180000);
    const f = await fixture(true);
    const queued = await queueDelivery(f);
    t.is(queued.status, 'sending');
    t.truthy(queued.mailDeliveryId);
    await app.get(MailJob).processReadyDeliveries();
    await f.service.tick();
    const sent = await f.db.projectReportDelivery.findUniqueOrThrow({
      where: { id: f.delivery.id },
    });
    t.is(sent.status, 'sent');
    t.is(messages.length, 1);
    t.true(messages[0].includes('application/pdf'));
    const mail = await f.db.mailDelivery.findUniqueOrThrow({
      where: { id: queued.mailDeliveryId! },
    });
    t.is(mail.mailClass, 'collaboration_notice');
    t.is(mail.status, 'sent');
    t.is(mail.attemptCount, 1);
    await f.service.tick();
    await app.get(MailJob).processReadyDeliveries();
    t.is(messages.length, 1);
  }
);

test.serial(
  'A45 send-time authorization intersection blocks a recipient removed after mail enqueue',
  async t => {
    const f = await fixture();
    const queued = await queueDelivery(f);
    t.is(queued.status, 'sending');
    await app.models.projectReportSchedule.save({
      ...f.actor,
      requestKey: 'remove-recipient',
      scheduleId: f.schedule.id,
      expectedVersion: f.schedule.version,
      config: {
        ...f.config,
        delivery: { ...f.config.delivery, enabled: false, recipients: [] },
      },
      authorization: { ...f.authorization, memberIds: [], emailRecipients: [] },
    });
    await app.get(MailJob).processReadyDeliveries();
    await f.service.tick();
    const mail = await f.db.mailDelivery.findUniqueOrThrow({
      where: { id: queued.mailDeliveryId! },
    });
    t.is(mail.status, 'skipped');
    t.is(mail.lastErrorCode, 'report_authorization_changed');
    t.is(mail.attemptCount, 0);
    t.is(messages.length, 0);
  }
);

test.serial(
  'A46 lost SMTP acknowledgement becomes unknown and never resends without manual reconciliation',
  async t => {
    const f = await fixture();
    const queued = await queueDelivery(f);
    loseAcknowledgement = true;
    await app.get(MailJob).processReadyDeliveries();
    await f.service.tick();
    const uncertain = await f.db.projectReportDelivery.findUniqueOrThrow({
      where: { id: f.delivery.id },
    });
    t.is(uncertain.status, 'unknown');
    t.is(messages.length, 1);
    await f.service.tick();
    await app.get(MailJob).processReadyDeliveries();
    t.is(messages.length, 1);
    const settled = await app.models.projectReportSchedule.resolveDelivery({
      ...f.actor,
      requestKey: 'verify-sink-receipt',
      deliveryId: uncertain.id,
      expectedDeliveryVersion: uncertain.version,
      result: 'sent',
      note: 'The local SMTP sink retained exactly one fictional message.',
    });
    t.is(settled.status, 'sent');
    const receipt = await f.db.projectReportRequest.findUniqueOrThrow({
      where: {
        projectId_actorId_requestKey: {
          ...f.actor,
          requestKey: 'verify-sink-receipt',
        },
      },
    });
    t.is(
      (receipt.result as { mailDeliveryId: string | null }).mailDeliveryId,
      queued.mailDeliveryId
    );
    await t.throwsAsync(
      app.models.projectReportSchedule.resolveDelivery({
        ...f.actor,
        requestKey: 'stale-resolution',
        deliveryId: uncertain.id,
        expectedDeliveryVersion: uncertain.version,
        result: 'not_sent',
        note: 'Stale retry is rejected.',
      })
    );
    t.is(messages.length, 1);
  }
);
