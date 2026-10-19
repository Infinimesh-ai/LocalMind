import { randomUUID } from 'node:crypto';

import type { ReportDocument } from '@localmind/office/report';
import { PrismaClient, type ProjectReport } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import { ConfigFactory } from '../../base';
import { sessionUser } from '../../core/auth/service';
import { ProjectRealtimeProvider } from '../../core/project/realtime';
import { ProjectReportContentService } from '../../core/project-report/content';
import { ProjectReportShareService } from '../../core/project-report/share';
import {
  RealtimePublisher,
  RealtimeRegistry,
  type RealtimeRequestHandler,
} from '../../core/realtime';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
test.before(async () => {
  app = await createTestingApp();
});
test.beforeEach(async () => {
  await app.initTestingDB();
});
test.afterEach.always(() => Sinon.restore());
test.after.always(async () => {
  await app.close();
});
async function fixture() {
  const db = app.get(PrismaClient);
  const owner = await app.createUser(
    `report-api-owner-${randomUUID()}@example.invalid`
  );
  const member = await app.createUser(
    `report-api-member-${randomUUID()}@example.invalid`
  );
  const outsider = await app.createUser(
    `report-api-outsider-${randomUUID()}@example.invalid`
  );
  const project = await db.aiContextProject.create({
    data: {
      name: 'Fictional report API acceptance',
      members: {
        create: [
          { userId: owner.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
      },
    },
  });
  const actor = { projectId: project.id, actorId: owner.id };
  const templates = await app.models.projectReport.templates(actor);
  const input = {
    projectId: project.id,
    requestKey: 'api-create',
    command: {
      operation: 'create',
      title: 'Fictional API report',
      templateRevisionId: templates[0].current!.id,
      selection: { kind: 'all' },
      generate: false,
      period: {
        start: '2026-10-01T00:00:00Z',
        end: '2026-10-08T00:00:00Z',
        timeZone: 'UTC',
        weekStartsOn: 1,
      },
    },
  };
  await app.login(owner);
  return { db, owner, member, outsider, project, actor, input };
}
const command =
  'mutation Report($input: ProjectReportCommandInput!) { projectReportCommand(input: $input) }';
type Created = {
  projectReportCommand: {
    report: ProjectReport;
    document: ReportDocument;
    revision: { id: string };
  };
};
test.serial(
  'A01 A02 A41 A49 A59 real GraphQL report operations enforce identity, input schema and live membership',
  async t => {
    const f = await fixture();
    const created = await app.gql<Created>(command, { input: f.input });
    const duplicate = await app.gql<Created>(command, { input: f.input });
    const result = created.projectReportCommand;
    t.is(duplicate.projectReportCommand.report.id, result.report.id);
    t.is(
      await f.db.projectReport.count({ where: { projectId: f.project.id } }),
      1
    );
    await t.throwsAsync(
      app.gql(command, {
        input: {
          ...f.input,
          command: { ...f.input.command, title: 'Different input' },
        },
      })
    );
    await t.throwsAsync(
      app.gql(command, {
        input: {
          ...f.input,
          requestKey: 'forged-policy',
          command: { ...f.input.command, actorId: f.outsider.id },
        },
      })
    );
    const stateQuery =
      'query Report($projectId: ID!, $reportId: ID!) { projectReportState(projectId: $projectId, reportId: $reportId, view: "detail") }';
    const variables = { projectId: f.project.id, reportId: result.report.id };
    const state = await app.gql<{
      projectReportState: { report: ProjectReport };
    }>(stateQuery, variables);
    t.is(state.projectReportState.report.id, result.report.id);
    await t.throwsAsync(
      app.gql(stateQuery, { ...variables, projectId: randomUUID() })
    );
    await app.login(f.outsider);
    await t.throwsAsync(app.gql(stateQuery, variables));
    await t.throwsAsync(
      app.gql(command, { input: { ...f.input, requestKey: 'outsider-create' } })
    );
    await app.login(f.member);
    t.truthy(await app.gql(stateQuery, variables));
    const scheduleState = await app.gql<{
      projectReportState: {
        templates: { current: { id: string } }[];
        members: { id: string; name: string }[];
        resources: unknown[];
      };
    }>(
      'query Report($projectId: ID!) { projectReportState(projectId: $projectId, view: "schedules") }',
      { projectId: f.project.id }
    );
    t.true(scheduleState.projectReportState.templates.length >= 6);
    t.true(
      scheduleState.projectReportState.templates.every(
        template => !!template.current.id
      )
    );
    t.deepEqual(
      scheduleState.projectReportState.members.map(member => member.id).sort(),
      [f.owner.id, f.member.id].sort()
    );
    t.true(Array.isArray(scheduleState.projectReportState.resources));
    await f.db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: f.project.id, userId: f.member.id },
      },
    });
    await t.throwsAsync(app.gql(stateQuery, variables));
  }
);
test.serial(
  'A31 A38 A39 A40 actual public HTTP share strips internal content and revokes existing cookies',
  async t => {
    const f = await fixture();
    app
      .get(ConfigFactory)
      .override({ projectReports: { allowAnonymous: true } });
    const { projectReportCommand: created } = await app.gql<Created>(command, {
      input: f.input,
    });
    const scope = { ...f.actor, reportId: created.report.id };
    const held = await app.models.projectReport.acquireLease({
      ...scope,
      tabId: 'api-final',
    });
    t.truthy(held.lease.leaseId);
    const content = app.get(ProjectReportContentService);
    const final = await content.save({
      ...scope,
      requestKey: 'api-final',
      expectedVersion: 1,
      kind: 'final',
      reason: 'HTTP acceptance',
      editLease: { tabId: 'api-final', leaseId: held.lease.leaseId! },
      document: {
        ...created.document,
        chapters: created.document.chapters.map((chapter, index) => ({
          ...chapter,
          hidden: index > 0,
          notes: 'PRIVATE HTTP NOTES',
          nodes: [
            {
              id: `api-node-${index}`,
              type: 'paragraph',
              text:
                index > 0 ? 'HIDDEN HTTP CONTENT' : 'Visible fictional content',
              claimKind: 'manual',
              sourceIds: [],
              locked: false,
            },
          ],
        })),
      },
    });
    const shares = app.get(ProjectReportShareService);
    const shared = await shares.create({
      ...scope,
      requestKey: 'api-share',
      command: {
        operation: 'share.create',
        revisionId: final.revision.id,
        mode: 'link',
        accountIds: [],
        allowDownload: false,
        audience: {
          kind: 'external',
          chapterIds: [final.document.chapters[0].id],
          includeNotes: false,
          includeSources: false,
        },
      },
    });
    const token = new URL(`https://local.invalid${shared.url}`).hash.slice(
      '#token='.length
    );
    app.clearAuth();
    const path = `/api/report-shares/${shared.shareId}`;
    const opened = await app.POST(path).send({ token }).expect(201);
    const cookie =
      opened
        .get('Set-Cookie')
        ?.map(value => value.split(';')[0])
        .join('; ') ?? '';
    t.true(cookie.includes('lm_report_'));
    const read = await app.GET(path).set('cookie', cookie).expect(200);
    t.is(read.get('cache-control'), 'private, no-store');
    t.is(read.get('referrer-policy'), 'no-referrer');
    t.true((read.get('x-robots-tag') ?? '').includes('noindex'));
    const serialized = JSON.stringify(read.body);
    for (const forbidden of [
      'PRIVATE HTTP NOTES',
      'HIDDEN HTTP CONTENT',
      f.project.id,
      f.owner.id,
    ])
      t.false(serialized.includes(forbidden));
    t.true(serialized.includes('Visible fictional content'));
    await app.GET(`${path}/downloads/pdf`).set('cookie', cookie).expect(403);
    const row = await f.db.projectReportShare.findUniqueOrThrow({
      where: { id: shared.shareId },
    });
    await app.models.projectReportShare.revoke({
      ...scope,
      shareId: row.id,
      expectedShareVersion: row.version,
      requestKey: 'revoke-http',
      fingerprint: 'a'.repeat(64),
    });
    await app.GET(path).set('cookie', cookie).expect(403);
  }
);
test.serial(
  'A53 report realtime replay targets only current members and carries no report content',
  async t => {
    const f = await fixture();
    const registry = app.get(RealtimeRegistry);
    const snapshot = registry.getRequest(
      'project.report.get'
    ) as RealtimeRequestHandler<'project.report.get'>;
    const topic = registry.getTopic('project.report.changed');
    await topic.authorize(sessionUser(f.member), { projectId: f.project.id });
    await t.throwsAsync(
      topic.authorize(sessionUser(f.outsider), { projectId: f.project.id })
    );
    await f.db.projectRealtimeOutbox.deleteMany();
    const { projectReportCommand: created } = await app.gql<Created>(command, {
      input: f.input,
    });
    t.true(
      (
        await snapshot.handle(sessionUser(f.member), {
          projectId: f.project.id,
        })
      ).revision.includes(created.report.id)
    );
    await f.db.aiContextProjectMember.delete({
      where: {
        projectId_userId: { projectId: f.project.id, userId: f.member.id },
      },
    });
    await t.throwsAsync(
      topic.authorize(sessionUser(f.member), { projectId: f.project.id })
    );
    await t.throwsAsync(
      snapshot.handle(sessionUser(f.member), { projectId: f.project.id })
    );
    const publish = Sinon.stub(app.get(RealtimePublisher), 'publish').returns(
      true
    );
    const provider = app.get(ProjectRealtimeProvider);
    await provider.deliver();
    const calls = publish
      .getCalls()
      .filter(call => call.args[0] === 'project.report.changed');
    t.true(calls.length > 0);
    for (const call of calls) {
      t.deepEqual(call.args[1], { projectId: f.project.id });
      t.false(JSON.stringify(call.args[2]).includes('Fictional API report'));
      t.true(JSON.stringify(call.args[3]).includes(f.owner.id));
      t.false(JSON.stringify(call.args[3]).includes(f.member.id));
      t.false(JSON.stringify(call.args[3]).includes(f.outsider.id));
    }
    const before = calls.length;
    await provider.deliver();
    t.is(
      publish
        .getCalls()
        .filter(call => call.args[0] === 'project.report.changed').length,
      before
    );
  }
);
