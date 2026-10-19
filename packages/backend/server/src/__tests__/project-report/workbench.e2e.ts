import { randomUUID } from 'node:crypto';

import {
  type ReportDocument,
  ReportDocumentSchema,
  ReportTemplateSchema,
} from '@localmind/office/report';
import { Prisma, PrismaClient } from '@prisma/client';
import test from 'ava';

import { ProjectReportContentService } from '../../core/project-report/content';
import { ProjectReportExportService } from '../../core/project-report/export';
import { ProjectReportService } from '../../core/project-report/service';
import { ProjectReportShareService } from '../../core/project-report/share';
import { CopilotProjectAgentRuntimeWorker } from '../../plugins/copilot/project-agent-runtime-worker';
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
async function fixture() {
  const db = app.get(PrismaClient);
  const [owner, member, outsider] = await Promise.all(
    ['report-owner', 'report-member', 'report-outsider'].map(name =>
      app.createUser(`${name}-${randomUUID()}@example.com`, { name })
    )
  );
  const project = await db.aiContextProject.create({
    data: {
      name: 'Report acceptance',
      members: {
        create: [
          { userId: owner.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
      },
    },
  });
  const templates = await app.models.projectReport.templates({
    projectId: project.id,
    actorId: owner.id,
  });
  const content = app.get(ProjectReportContentService);
  const created = await content.create({
    projectId: project.id,
    actorId: owner.id,
    requestKey: 'create',
    command: {
      operation: 'create',
      title: 'Weekly report',
      templateRevisionId: templates[0].current!.id,
      selection: { kind: 'all' },
      period: {
        start: '2026-10-05T00:00:00.000Z',
        end: '2026-10-12T00:00:00.000Z',
        timeZone: 'UTC',
        weekStartsOn: 1,
      },
      generate: false,
    },
  });
  const scope = {
    projectId: project.id,
    reportId: created.report.id,
    actorId: owner.id,
  };
  const held = await app.models.projectReport.acquireLease({
    ...scope,
    tabId: 'owner-tab',
  });
  if (!held.acquired || !held.lease.leaseId)
    throw new Error('Fixture lease not acquired');
  const editLease = {
    tabId: 'owner-tab',
    leaseId: held.lease.leaseId,
    kind: 'user' as const,
  };
  const document = ReportDocumentSchema.parse({
    ...created.document,
    chapters: created.document.chapters.map((chapter, index) =>
      index === 0
        ? {
            ...chapter,
            nodes: [
              {
                id: 'manual-fact',
                type: 'paragraph',
                text: 'Chinese 中文 and 繁體 progress; explicitly written by a member.',
                sourceIds: [],
                claimKind: 'manual',
                locked: false,
              },
            ],
          }
        : chapter
    ),
  });
  return {
    db,
    owner,
    member,
    outsider,
    project,
    content,
    created,
    scope,
    editLease,
    document,
  };
}

test.serial(
  'A03 A04 A06 creator fallback is stable across different editors and restore',
  async t => {
    const f = await fixture();
    t.is(f.created.document.responsibility.identity.kind, 'member');
    t.is(f.created.document.responsibility.origin, 'creator_fallback');
    const saved = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      requestKey: 'save',
      expectedVersion: 1,
      document: f.document,
      kind: 'draft',
      reason: 'manual content',
    });
    t.deepEqual(saved.document.chapters[0].nodes[0].responsibility?.identity, {
      kind: 'member',
      actorId: f.owner.id,
      label: f.owner.name,
    });
    await app.models.projectReport.releaseLease({ ...f.scope, ...f.editLease });
    const next = await app.models.projectReport.acquireLease({
      ...f.scope,
      actorId: f.member.id,
      tabId: 'member-tab',
    });
    const changed = await f.content.save({
      ...f.scope,
      actorId: f.member.id,
      editLease: {
        tabId: 'member-tab',
        leaseId: next.lease.leaseId!,
        kind: 'user',
      },
      requestKey: 'member-save',
      expectedVersion: saved.report.version,
      document: { ...saved.document, title: 'Edited by member' },
      kind: 'draft',
      reason: 'another editor',
    });
    t.is(changed.document.creator.actorId, f.owner.id);
    t.deepEqual(
      changed.document.responsibility.identity,
      saved.document.responsibility.identity
    );
  }
);

test.serial(
  'A26 A41 A49 lease denial, stale tokens, cross-project and concurrent save dedupe',
  async t => {
    const f = await fixture();
    const refused = await app.models.projectReport.acquireLease({
      ...f.scope,
      actorId: f.member.id,
      tabId: 'other',
    });
    t.false(refused.acquired);
    t.is(refused.lease.leaseId, null);
    await t.throwsAsync(f.content.read({ ...f.scope, actorId: f.outsider.id }));
    await t.throwsAsync(
      f.content.save({
        ...f.scope,
        editLease: { ...f.editLease, leaseId: 'wrong' },
        expectedVersion: 1,
        requestKey: 'bad-lease',
        document: f.document,
        kind: 'draft',
        reason: 'invalid',
      })
    );
    const request = {
      ...f.scope,
      editLease: f.editLease,
      expectedVersion: 1,
      requestKey: 'same-save',
      document: f.document,
      kind: 'draft' as const,
      reason: 'same command',
    };
    const [a, b] = await Promise.all([
      f.content.save(request),
      f.content.save(request),
    ]);
    t.is(a.revision.id, b.revision.id);
    t.is(
      await f.db.projectReportRevision.count({
        where: { reportId: f.scope.reportId },
      }),
      2
    );
    await t.throwsAsync(
      f.content.save({
        ...request,
        document: { ...f.document, title: 'different input' },
      })
    );
    const other = await f.db.aiContextProject.create({
      data: {
        name: 'Other',
        members: { create: { userId: f.owner.id, role: 'owner' } },
      },
    });
    await t.throwsAsync(f.content.read({ ...f.scope, projectId: other.id }));
  }
);

test.serial(
  'A27 immutable revision cannot be overwritten and restore appends',
  async t => {
    const f = await fixture();
    const saved = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      expectedVersion: 1,
      requestKey: 'final',
      document: f.document,
      kind: 'final',
      reason: 'finalize',
    });
    t.is(saved.revision.kind, 'final');
    t.is(saved.report.draftRevisionId, null);
    await t.throwsAsync(
      f.db.projectReportRevision.update({
        where: { id: saved.revision.id },
        data: { reason: 'tamper' },
      })
    );
    const restored = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      expectedVersion: saved.report.version,
      requestKey: 'restore',
      document: saved.document,
      kind: 'draft',
      reason: 'restore',
      restoreRevisionId: saved.revision.id,
    });
    t.true(restored.revision.sequence > saved.revision.sequence);
    t.is(restored.report.latestFinalRevisionId, saved.revision.id);
    t.is(
      (await f.content.read({ ...f.scope, revisionId: saved.revision.id }))
        .document.title,
      saved.document.title
    );
  }
);

test.serial(
  'A16 A17 manual save cannot fabricate sources or remove verification evidence',
  async t => {
    const f = await fixture();
    const invalid = { ...f.document, cutoffAt: '2026-10-13T00:00:00.000Z' };
    await t.throwsAsync(
      f.content.save({
        ...f.scope,
        editLease: f.editLease,
        expectedVersion: 1,
        requestKey: 'fake-sources',
        document: invalid,
        kind: 'draft',
        reason: 'tamper',
      })
    );
    t.throws(() =>
      ReportDocumentSchema.parse({
        ...f.document,
        chapters: [
          {
            ...f.document.chapters[0],
            nodes: [
              {
                id: 'false-metric',
                type: 'metric',
                label: 'Done',
                value: 100,
                unit: '%',
                formula: '1 / 2',
                calculation: {
                  kind: 'ratio',
                  numerator: 1,
                  denominator: 2,
                  scale: 100,
                },
                sourceIds: [],
                claimKind: 'calculation',
                locked: false,
              },
            ],
          },
        ],
      })
    );
  }
);

test.serial(
  'A25 review fixed revision and exact assigned reviewer plus comment CAS',
  async t => {
    const f = await fixture();
    const base = {
      ...f.scope,
      requestKey: 'review',
      fingerprint: 'a'.repeat(64),
    };
    const result = (await app.models.projectReportCollaboration.requestReview({
      ...base,
      revisionId: f.created.revision.id,
      reviewerIds: [f.member.id],
    })) as { reviews: { id: string }[] };
    await t.throwsAsync(
      app.models.projectReportCollaboration.respondReview({
        ...base,
        requestKey: 'wrong-reviewer',
        reviewId: result.reviews[0].id,
        expectedVersion: 1,
        status: 'approved',
        note: '',
      })
    );
    const approved = await app.models.projectReportCollaboration.respondReview({
      ...base,
      actorId: f.member.id,
      requestKey: 'approve',
      reviewId: result.reviews[0].id,
      expectedVersion: 1,
      status: 'approved',
      note: 'Reviewed',
    });
    t.truthy(approved);
    const comment = (await app.models.projectReportCollaboration.addComment({
      ...base,
      requestKey: 'comment',
      revisionId: f.created.revision.id,
      anchorText: 'Section',
      content: 'Please verify',
    })) as { id: string };
    await app.models.projectReportCollaboration.resolveComment({
      ...base,
      requestKey: 'resolve',
      commentId: comment.id,
      expectedVersion: 1,
      resolved: true,
    });
    await t.throwsAsync(
      app.models.projectReportCollaboration.resolveComment({
        ...base,
        requestKey: 'stale-resolve',
        commentId: comment.id,
        expectedVersion: 1,
        resolved: false,
      })
    );
  }
);

test.serial(
  'A37 A38 A39 A40 fixed final share, account scope, password, revoke and version rotation',
  async t => {
    const f = await fixture();
    const saved = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      expectedVersion: 1,
      requestKey: 'final',
      document: f.document,
      kind: 'final',
      reason: 'finalize',
    });
    const shares = app.get(ProjectReportShareService);
    const audience = {
      kind: 'external' as const,
      chapterIds: saved.document.chapters.map(chapter => chapter.id),
      includeNotes: false,
      includeSources: false,
    };
    const created = await shares.create({
      ...f.scope,
      requestKey: 'share',
      command: {
        operation: 'share.create',
        revisionId: saved.revision.id,
        audience,
        mode: 'accounts',
        accountIds: [],
        accountEmails: [f.member.email.toUpperCase()],
        password: 'private-report-password',
        allowDownload: true,
      },
    });
    t.deepEqual((await shares.list(f.scope))[0].accountIds, [f.member.id]);
    await t.throwsAsync(
      shares.create({
        ...f.scope,
        requestKey: 'missing-share-account',
        command: {
          operation: 'share.create',
          revisionId: saved.revision.id,
          audience,
          mode: 'accounts',
          accountIds: [],
          accountEmails: ['missing-report-recipient@example.invalid'],
          allowDownload: false,
        },
      })
    );
    const token = new URL(`https://local.invalid${created.url}`).hash.slice(
      '#token='.length
    );
    await t.throwsAsync(
      shares.open({
        shareId: created.shareId,
        actorId: f.outsider.id,
        token,
        password: 'private-report-password',
      })
    );
    await t.throwsAsync(
      shares.open({
        shareId: created.shareId,
        actorId: f.member.id,
        token,
        password: 'incorrect',
      })
    );
    const session = await shares.open({
      shareId: created.shareId,
      actorId: f.member.id,
      token,
      password: 'private-report-password',
    });
    const visible = await shares.read({
      shareId: created.shareId,
      actorId: f.member.id,
      cookie: session.cookie,
    });
    const serialized = JSON.stringify(visible);
    t.false(serialized.includes(f.owner.id));
    t.false(serialized.includes(f.scope.projectId));
    t.true(visible.projection.chapters.every(chapter => chapter.notes === ''));
    const record = await f.db.projectReportShare.findUniqueOrThrow({
      where: { id: created.shareId },
    });
    await app.models.projectReportShare.revoke({
      ...f.scope,
      shareId: record.id,
      expectedShareVersion: record.version,
      requestKey: 'revoke',
      fingerprint: 'b'.repeat(64),
    });
    await t.throwsAsync(
      shares.read({
        shareId: created.shareId,
        actorId: f.member.id,
        cookie: session.cookie,
      })
    );
  }
);

test.serial(
  'A31 audience presentation DTO never includes notes, sources or internal identities',
  async t => {
    const f = await fixture();
    const document: ReportDocument = {
      ...f.document,
      chapters: f.document.chapters.map(chapter => ({
        ...chapter,
        notes: 'PRIVATE PRESENTER SECRET',
      })),
    };
    const snapshot = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      expectedVersion: 1,
      requestKey: 'preview',
      document,
      kind: 'preview',
      reason: 'presentation snapshot',
    });
    const result = await app.get(ProjectReportService).state(f.owner.id, {
      projectId: f.project.id,
      reportId: f.scope.reportId,
      revisionId: snapshot.revision.id,
      view: 'presentation',
    });
    const payload = JSON.stringify(result);
    t.false(payload.includes('PRIVATE PRESENTER SECRET'));
    t.false(payload.includes(f.owner.id));
    t.false(payload.includes('contentBlobKey'));
  }
);

test.serial(
  'A02 A20 A49 custom templates persist immutable idempotent versions',
  async t => {
    const f = await fixture();
    const templates = await app.models.projectReport.templates(f.scope);
    const source = templates.find(template => template.current)?.current;
    if (!source) throw new Error('No built-in template');
    const content = ReportTemplateSchema.parse({
      ...(source.content as object),
      name: 'Custom customer template',
    });
    const request = { ...f.scope, content, requestKey: 'custom-template' };
    const [first, duplicate] = await Promise.all([
      app.models.projectReport.saveTemplate(request),
      app.models.projectReport.saveTemplate(request),
    ]);
    t.is(first.id, duplicate.id);
    t.is(
      await f.db.projectReportTemplateRevision.count({
        where: { templateId: first.id },
      }),
      1
    );
    await t.throwsAsync(
      app.models.projectReport.saveTemplate({
        ...request,
        content: { ...content, name: 'Different' },
      })
    );
    const service = app.get(ProjectReportService);
    await service.command(f.owner.id, {
      projectId: f.project.id,
      requestKey: 'frozen-template-schedule',
      command: {
        operation: 'schedule.save',
        config: {
          title: 'Frozen template schedule',
          templateRevisionId: first.current!.id,
          selection: { kind: 'all' },
          timeZone: 'Asia/Shanghai',
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
              chapterIds: [],
              includeNotes: false,
              includeSources: false,
            },
          },
        },
      },
    });
    const revised = await app.models.projectReport.saveTemplate({
      ...f.scope,
      content: { ...content, name: 'Custom version 2' },
      requestKey: 'custom-template-update',
      templateId: first.id,
      expectedVersion: first.version,
    });
    t.is(revised.current?.sequence, 2);
    const scheduleState = (await service.state(f.owner.id, {
      projectId: f.project.id,
      view: 'schedules',
    })) as { templates: { name: string; current: { id: string } }[] };
    t.true(
      scheduleState.templates.some(
        template => template.current.id === revised.current?.id
      )
    );
    t.is(
      scheduleState.templates.find(
        template => template.current.id === first.current!.id
      )?.name,
      'Custom customer template · v1'
    );
    t.is(
      (
        await app.models.projectReport.templateRevision({
          ...f.scope,
          revisionId: source.id,
        })
      ).content.name,
      ReportTemplateSchema.parse(source.content).name
    );
    await t.throwsAsync(
      f.db.projectReportTemplateRevision.update({
        where: { id: revised.current!.id },
        data: { content: {} },
      })
    );
  }
);

test.serial(
  'A36 A41 real export worker saves native Office revisions and rejects stale replacements',
  async t => {
    const f = await fixture();
    const saved = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      expectedVersion: 1,
      requestKey: 'export-final',
      document: f.document,
      kind: 'final',
      reason: 'Export fixture',
    });
    const exports = app.get(ProjectReportExportService);
    const audience = {
      kind: 'external' as const,
      chapterIds: saved.document.chapters.map(chapter => chapter.id),
      includeNotes: false,
      includeSources: false,
    };
    const request = {
      ...f.scope,
      requestKey: 'export-pptx',
      command: {
        operation: 'export' as const,
        revisionId: saved.revision.id,
        format: 'pptx' as const,
        audience,
      },
    };
    const [first, duplicate] = await Promise.all([
      exports.request(request),
      exports.request(request),
    ]);
    t.is(first.exportId, duplicate.exportId);
    await app
      .get(CopilotProjectAgentRuntimeWorker)
      .run({ projectId: f.project.id, runId: first.runId! });
    const output = await f.db.projectReportExport.findUniqueOrThrow({
      where: { id: first.exportId },
    });
    t.is(output.status, 'succeeded');
    const downloaded = await exports.download({
      ...f.scope,
      exportId: first.exportId,
    });
    t.true(downloaded.bytes.length > 1000);
    await t.throwsAsync(
      exports.download({
        ...f.scope,
        actorId: f.outsider.id,
        exportId: first.exportId,
      })
    );
    const result = await exports.save({
      ...f.scope,
      requestKey: 'save-office',
      command: { operation: 'export.save', exportId: first.exportId },
    });
    const repeated = await exports.save({
      ...f.scope,
      requestKey: 'save-office',
      command: { operation: 'export.save', exportId: first.exportId },
    });
    t.is(result.resourceId, repeated.resourceId);
    const resource = await app.models.projectResource.get({
      ...f.scope,
      resourceId: result.resourceId,
    });
    t.is(resource.kind, 'presentation');
    t.truthy(resource.officeArtifactId);
    const revisions = await f.db.officeRevision.findMany({
      where: { artifactId: resource.officeArtifactId! },
    });
    t.is(revisions.length, 1);
    const held = await app.models.projectResourceEditLease.acquire({
      ...f.scope,
      resourceId: resource.id,
      kind: 'user',
      tabId: 'office-update',
    });
    if (!held.lease?.leaseId)
      throw new Error('Office fixture lease is unavailable');
    const proof = { tabId: 'office-update', leaseId: held.lease.leaseId };
    await t.throwsAsync(
      exports.save({
        ...f.scope,
        requestKey: 'stale-office',
        command: {
          operation: 'export.save',
          exportId: first.exportId,
          resourceId: resource.id,
          expectedParentRevisionId: 'stale',
          resourceEditLease: proof,
        },
      })
    );
    t.is(
      await f.db.projectResource.count({
        where: { projectId: f.project.id, kind: 'presentation' },
      }),
      1
    );
    await exports.save({
      ...f.scope,
      requestKey: 'update-office',
      command: {
        operation: 'export.save',
        exportId: first.exportId,
        resourceId: resource.id,
        expectedParentRevisionId: revisions[0].id,
        resourceEditLease: proof,
      },
    });
    t.is(
      await f.db.officeRevision.count({
        where: { artifactId: resource.officeArtifactId! },
      }),
      2
    );
  }
);

test.serial(
  'A56 report list over 1000 records paginates and stays within the one-second P95 budget',
  async t => {
    const f = await fixture();
    const template = f.created.report.templateRevisionId;
    await f.db.projectReport.createMany({
      data: Array.from({ length: 1000 }, (_, index) => ({
        id: `report-performance-${index}`,
        projectId: f.project.id,
        title: `Report ${index.toString().padStart(4, '0')}`,
        createdByActorId: f.owner.id,
        creatorLabel: f.owner.name ?? 'Creator',
        responsibility: f.created.report
          .responsibility as Prisma.InputJsonValue,
        templateRevisionId: template,
        periodStart: new Date('2026-10-05T00:00:00Z'),
        periodEnd: new Date('2026-10-12T00:00:00Z'),
        timeZone: 'UTC',
        selection: { kind: 'all' },
      })),
    });
    const durations: number[] = [];
    let cursor: string | undefined;
    const ids = new Set<string>();
    do {
      const started = performance.now();
      const page = await app.models.projectReport.list({
        ...f.scope,
        limit: 100,
        cursor,
      });
      durations.push(performance.now() - started);
      page.items.forEach(row => {
        t.false(ids.has(row.id));
        ids.add(row.id);
      });
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    t.is(ids.size, 1001);
    const p95 = durations.toSorted((a, b) => a - b)[
      Math.floor(durations.length * 0.95)
    ];
    t.log(
      `1001 reports, cold=${durations[0].toFixed(1)}ms, pages=${durations.length}, P95=${p95.toFixed(1)}ms`
    );
    t.true(p95 < 1000);
  }
);

test.serial(
  'A24 A25 paginated comments are complete and cursors are scoped',
  async t => {
    const f = await fixture();
    await f.db.projectReportComment.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: `comment-${index.toString().padStart(3, '0')}`,
        projectId: f.project.id,
        reportId: f.scope.reportId,
        revisionId: f.created.revision.id,
        actorId: f.owner.id,
        content: `Comment ${index}`,
        anchorText: '',
        createdAt: new Date('2026-10-12T00:00:00Z'),
      })),
    });
    const service = app.get(ProjectReportService);
    const scope = { projectId: f.project.id, reportId: f.scope.reportId };
    const first = (await service.state(f.owner.id, {
      ...scope,
      view: 'comments',
      limit: 100,
    })) as {
      comments: { id: string }[];
      nextCursors: { comments: string | null };
    };
    t.is(first.comments.length, 100);
    t.truthy(first.nextCursors.comments);
    const second = (await service.state(f.owner.id, {
      ...scope,
      view: 'comments',
      limit: 100,
      cursor: first.nextCursors.comments!,
    })) as typeof first;
    t.is(second.comments.length, 5);
    t.is(
      new Set([...first.comments, ...second.comments].map(row => row.id)).size,
      105
    );
    t.is(second.nextCursors.comments, null);
    await t.throwsAsync(
      service.state(f.owner.id, {
        ...scope,
        view: 'reviews',
        cursor: first.nextCursors.comments!,
      })
    );
    await t.throwsAsync(
      service.state(f.outsider.id, { ...scope, view: 'comments', limit: 100 })
    );
  }
);

test.serial(
  'A24 fixed comment anchors follow moved nodes, detect changed prose and keep replies on their original revision',
  async t => {
    const f = await fixture();
    const service = app.get(ProjectReportService);
    const first = await f.content.save({
      ...f.scope,
      requestKey: 'anchor-initial',
      expectedVersion: 1,
      editLease: f.editLease,
      document: f.document,
      kind: 'draft',
      reason: 'Anchor fixture',
    });
    const originalChapter = first.document.chapters[0];
    const targetChapter = first.document.chapters[1];
    const node = originalChapter.nodes[0];
    await service.command(f.owner.id, {
      projectId: f.project.id,
      reportId: f.scope.reportId,
      requestKey: 'chapter-comment',
      command: {
        operation: 'comment.add',
        revisionId: first.revision.id,
        chapterId: originalChapter.id,
        body: 'Chapter discussion',
      },
    });
    await service.command(f.owner.id, {
      projectId: f.project.id,
      reportId: f.scope.reportId,
      requestKey: 'node-comment',
      command: {
        operation: 'comment.add',
        revisionId: first.revision.id,
        chapterId: originalChapter.id,
        nodeId: node.id,
        body: 'Node discussion',
      },
    });
    await t.throwsAsync(
      service.command(f.owner.id, {
        projectId: f.project.id,
        reportId: f.scope.reportId,
        requestKey: 'wrong-chapter',
        command: {
          operation: 'comment.add',
          revisionId: first.revision.id,
          chapterId: targetChapter.id,
          nodeId: node.id,
          body: 'Forged placement',
        },
      })
    );
    const nodeComment = await f.db.projectReportComment.findFirstOrThrow({
      where: { reportId: f.scope.reportId, content: 'Node discussion' },
    });
    t.is(nodeComment.chapterId, originalChapter.id);
    const movedDocument = {
      ...first.document,
      chapters: first.document.chapters.map(chapter =>
        chapter.id === originalChapter.id
          ? { ...chapter, nodes: [] }
          : chapter.id === targetChapter.id
            ? { ...chapter, nodes: [node, ...chapter.nodes] }
            : chapter
      ),
    };
    const moved = await f.content.save({
      ...f.scope,
      requestKey: 'move-node',
      expectedVersion: first.report.version,
      editLease: f.editLease,
      document: movedDocument,
      kind: 'draft',
      reason: 'Move without changing text',
    });
    const readComments = async () =>
      (await service.state(f.owner.id, {
        projectId: f.project.id,
        reportId: f.scope.reportId,
        view: 'comments',
      })) as {
        comments: {
          id: string;
          body: string;
          chapterId: string | null;
          stale: boolean;
        }[];
      };
    const comments = (await readComments()).comments;
    t.false(comments.find(row => row.body === 'Chapter discussion')!.stale);
    const movedAnchor = comments.find(row => row.id === nodeComment.id)!;
    t.false(movedAnchor.stale);
    t.is(movedAnchor.chapterId, targetChapter.id);
    const changedDocument = {
      ...moved.document,
      chapters: moved.document.chapters
        .filter(chapter => chapter.id !== originalChapter.id)
        .map(chapter => ({
          ...chapter,
          nodes: chapter.nodes.map(item =>
            item.id === node.id && item.type === 'paragraph'
              ? { ...item, text: 'Changed after the original comment.' }
              : item
          ),
        })),
    };
    await f.content.save({
      ...f.scope,
      requestKey: 'change-prose',
      expectedVersion: moved.report.version,
      editLease: f.editLease,
      document: changedDocument,
      kind: 'draft',
      reason: 'Changed anchored text',
    });
    const stale = (await readComments()).comments;
    t.true(stale.find(row => row.id === nodeComment.id)!.stale);
    t.true(stale.find(row => row.body === 'Chapter discussion')!.stale);
    await service.command(f.owner.id, {
      projectId: f.project.id,
      reportId: f.scope.reportId,
      requestKey: 'reply-original',
      command: {
        operation: 'comment.add',
        revisionId: first.revision.id,
        nodeId: node.id,
        parentId: nodeComment.id,
        body: 'Reply to original evidence',
      },
    });
    const reply = await f.db.projectReportComment.findFirstOrThrow({
      where: {
        reportId: f.scope.reportId,
        content: 'Reply to original evidence',
      },
    });
    t.is(reply.revisionId, first.revision.id);
    t.is(reply.chapterId, originalChapter.id);
    t.is(reply.parentId, nodeComment.id);
  }
);

test.serial(
  'A05 A08 former member assignments survive edits but cannot be newly assigned',
  async t => {
    const f = await fixture();
    const assigned = ReportDocumentSchema.parse({
      ...f.document,
      responsibility: {
        identity: {
          kind: 'member',
          actorId: f.member.id,
          label: f.member.name,
        },
        origin: 'manual',
        sourceIds: [],
      },
    });
    const saved = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      requestKey: 'assign',
      expectedVersion: 1,
      document: assigned,
      kind: 'draft',
      reason: 'Assign member',
    });
    await f.db.aiContextProjectMember.deleteMany({
      where: { projectId: f.project.id, userId: f.member.id },
    });
    const edited = await f.content.save({
      ...f.scope,
      editLease: f.editLease,
      requestKey: 'former-save',
      expectedVersion: saved.report.version,
      document: { ...saved.document, title: 'Historical ownership' },
      kind: 'draft',
      reason: 'Keep historical assignment',
    });
    t.deepEqual(edited.document.responsibility, saved.document.responsibility);
    const newAssignment = structuredClone(edited.document);
    newAssignment.chapters[0].nodes[0].responsibility = assigned.responsibility;
    await t.throwsAsync(
      f.content.save({
        ...f.scope,
        editLease: f.editLease,
        requestKey: 'new-former-assignment',
        expectedVersion: edited.report.version,
        document: newAssignment,
        kind: 'draft',
        reason: 'Invalid new assignment',
      })
    );
  }
);
