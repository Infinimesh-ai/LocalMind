import { randomUUID } from 'node:crypto';

import { createNativeFile } from '@localmind/office';
import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { OfficeImportService } from '../../core/office';
import { ProjectBlobStorage, ProjectResourceService } from '../../core/project';
import { ProjectReportContentService } from '../../core/project-report/content';
import { ProjectReportLifecycleService } from '../../core/project-report/lifecycle';
import { StorageRuntimeProvider } from '../../core/storage-runtime';
import { projectResourceHash } from '../../models/project-resource';
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
  const owner = await app.createUser(
    `report-purge-${randomUUID()}@example.com`,
    { name: 'Report creator' }
  );
  const other = await app.createUser(
    `report-outsider-${randomUUID()}@example.com`
  );
  const project = await db.aiContextProject.create({
    data: {
      name: 'Report lifecycle',
      members: { create: { userId: owner.id, role: 'owner' } },
    },
  });
  const actor = { projectId: project.id, actorId: owner.id };
  const templates = await app.models.projectReport.templates(actor);
  const content = app.get(ProjectReportContentService);
  const created = await content.create({
    ...actor,
    requestKey: 'create',
    command: {
      operation: 'create',
      title: 'Retained report content',
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
  const scope = { ...actor, reportId: created.report.id };
  const model = app.models.projectReportLifecycle;
  async function trash() {
    const report = await db.projectReport.findUniqueOrThrow({
      where: { id: scope.reportId },
    });
    return app.models.projectReport.changeLifecycle({
      ...scope,
      lifecycle: 'trashed',
      expectedVersion: report.version,
      requestKey: 'trash',
      fingerprint: 'a'.repeat(64),
    });
  }
  async function due() {
    const report = await trash();
    // Simulate a legitimately aged request, rather than weakening the immutable
    // deadline constraint or shortening production retention for this test.
    return db.projectReportDeletion.create({
      data: {
        ...scope,
        requestKey: 'aged-delete',
        expectedVersion: report.version,
        fingerprint: projectResourceHash({
          reportId: report.id,
          expectedVersion: report.version,
        }),
        createdAt: new Date(Date.now() - 2 * 86400000),
        eligibleAt: new Date(Date.now() - 86400000),
      },
    });
  }
  return {
    db,
    owner,
    other,
    actor,
    scope,
    created,
    content,
    model,
    trash,
    due,
  };
}

test.serial(
  'A51 permanent deletion requires trash, exact CAS and immutable idempotent authorization',
  async t => {
    const f = await fixture();
    await t.throwsAsync(
      f.model.request({ ...f.scope, expectedVersion: 1, requestKey: 'delete' })
    );
    const trashed = await f.trash();
    await t.throwsAsync(
      f.model.request({
        ...f.scope,
        actorId: f.other.id,
        expectedVersion: trashed.version,
        requestKey: 'delete',
      })
    );
    await t.throwsAsync(
      f.model.request({ ...f.scope, expectedVersion: 1, requestKey: 'delete' })
    );
    const input = {
      ...f.scope,
      expectedVersion: trashed.version,
      requestKey: 'delete',
    };
    const [first, repeated] = await Promise.all([
      f.model.request(input),
      f.model.request(input),
    ]);
    t.is(first.reportId, repeated.reportId);
    t.true(first.eligibleAt.getTime() - first.createdAt.getTime() >= 86399000);
    const service = app.get(ProjectReportLifecycleService);
    await service.permanentlyDelete(input);
    t.deepEqual(app.queue.last('nightly.purgeProjectReport').payload, {
      reportId: f.scope.reportId,
    });
    t.true(app.queue.add.lastCall.args[2].delay > 23 * 60 * 60 * 1000);
    app.queue.add.rejects(new Error('queue unavailable'));
    try {
      t.is((await service.permanentlyDelete(input)).reportId, f.scope.reportId);
    } finally {
      app.queue.add.resolves();
    }
    t.is(await f.model.claim(first.reportId), null);
    await t.throwsAsync(f.model.request({ ...input, requestKey: 'different' }));
    await t.throwsAsync(
      f.db.projectReportDeletion.update({
        where: { reportId: first.reportId },
        data: { expectedVersion: 0 },
      })
    );
    await t.throwsAsync(
      f.db.projectReportDeletion.update({
        where: { reportId: first.reportId },
        data: { eligibleAt: new Date() },
      })
    );
    await t.throwsAsync(
      f.db.projectReportDeletion.update({
        where: { reportId: first.reportId },
        data: { status: 'purged', completedAt: new Date() },
      })
    );
    await t.throwsAsync(
      f.db.projectReportDeletion.update({
        where: { reportId: first.reportId },
        data: { status: 'purging' },
      })
    );
    await t.throwsAsync(
      f.db.projectReportDeletion.update({
        where: { reportId: first.reportId },
        data: { status: 'held' },
      })
    );
    await t.throwsAsync(
      app.models.projectReport.get({ ...f.scope, includeTrash: true })
    );
    const list = await app.models.projectReport.list({
      ...f.actor,
      lifecycle: 'trashed',
    });
    t.false(list.items.some(row => row.id === f.scope.reportId));
    await t.throwsAsync(
      app.models.projectReport.changeLifecycle({
        ...f.scope,
        lifecycle: 'active',
        expectedVersion: trashed.version + 1,
        requestKey: 'restore-after-delete',
        fingerprint: 'b'.repeat(64),
      })
    );
  }
);

test.serial(
  'A52 legal hold and retention freeze stop both content purge and object deletion',
  async t => {
    const f = await fixture();
    await f.due();
    await f.db.localMindLogPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', legalHold: true },
      update: { legalHold: true },
    });
    t.is(await f.model.claim(f.scope.reportId), null);
    let state = await f.db.projectReportDeletion.findUniqueOrThrow({
      where: { reportId: f.scope.reportId },
    });
    t.is(state.status, 'held');
    t.truthy(state.heldAt);
    t.is(state.holdReason, 'RETENTION_HOLD');
    t.is(
      await f.db.projectReportRevision.count({
        where: { reportId: f.scope.reportId },
      }),
      1
    );
    await f.db.localMindLogPolicy.update({
      where: { id: 'default' },
      data: { legalHold: false, retentionFrozen: true },
    });
    t.is(await f.model.claim(f.scope.reportId), null);
    await f.db.localMindLogPolicy.update({
      where: { id: 'default' },
      data: { retentionFrozen: false },
    });
    const claim = await f.model.claim(f.scope.reportId);
    t.truthy(claim?.releasedAt);
    const lease = { reportId: f.scope.reportId, leaseId: claim!.leaseId! };
    await f.model.prepare(lease);
    await f.db.localMindLogPolicy.update({
      where: { id: 'default' },
      data: { legalHold: true },
    });
    let removed = false;
    t.false(
      await f.model.deleteNextBlob(lease, async () => {
        removed = true;
      })
    );
    t.false(removed);
    state = await f.db.projectReportDeletion.findUniqueOrThrow({
      where: { reportId: f.scope.reportId },
    });
    t.is(state.status, 'held');
    t.truthy(
      await f.db.projectBlob.findUnique({
        where: {
          projectId_key: {
            projectId: f.scope.projectId,
            key: f.created.revision.contentBlobKey,
          },
        },
      })
    );
  }
);

test.serial(
  'A52 storage failure keeps a committed deletion fence; stale workers cannot delete and source/Office copies survive',
  async t => {
    const f = await fixture();
    const blobs = app.get(ProjectBlobStorage);
    const resources = app.get(ProjectResourceService);
    const sourceBlob = await blobs.put({
      ...f.actor,
      bytes: Buffer.from('Original project document'),
      mimeType: 'text/plain',
    });
    const source = await resources.createFile({
      ...f.actor,
      title: 'source.txt',
      blobKey: sourceBlob.key,
      requestKey: 'source',
    });
    const pptx = createNativeFile({
      format: 'pptx',
      slides: [{ title: 'Independent saved copy', paragraphs: ['Retain me'] }],
    });
    const exportBlob = await blobs.put({
      ...f.actor,
      bytes: Buffer.from(pptx.bytes),
      mimeType: pptx.mimeType,
    });
    const office = await app.get(OfficeImportService).import({
      ...f.actor,
      sourceBlobKey: exportBlob.key,
      generatedBytes: Buffer.from(pptx.bytes),
      title: 'Saved report',
      sourceFileName: 'report.pptx',
      importIdempotencyKey: 'saved-report',
      projectRequestKey: 'saved-report',
    });
    const savedCopy = await app.models.projectResource.assertOfficeResource({
      ...f.actor,
      artifactId: office.artifact.id,
    });
    await app.models.projectReport.retainBlobs({
      ...f.scope,
      keys: [sourceBlob.key, exportBlob.key],
    });
    await f.db.projectReportExport.create({
      data: {
        ...f.scope,
        requestKey: 'export',
        fingerprint: 'f'.repeat(64),
        revisionId: f.created.revision.id,
        format: 'pptx',
        audience: {},
        status: 'succeeded',
        blobKey: exportBlob.key,
        resourceId: savedCopy.id,
      },
    });
    await f.due();
    const first = await f.model.claim(f.scope.reportId);
    const oldLease = { reportId: f.scope.reportId, leaseId: first!.leaseId! };
    t.true(await f.model.prepare(oldLease));
    await f.db.projectReportDeletion.update({
      where: { reportId: f.scope.reportId },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    });
    const second = await f.model.claim(f.scope.reportId);
    const lease = { reportId: f.scope.reportId, leaseId: second!.leaseId! };
    await t.throwsAsync(f.model.reserveBlob(oldLease));
    let reservation = await f.model.reserveBlob(lease);
    while (reservation === true) reservation = await f.model.reserveBlob(lease);
    if (!reservation) throw new Error('Expected an unreferenced report Blob');
    const candidate = reservation;
    await t.throwsAsync(
      f.db.projectReportBlobDeletion.update({
        where: { id: candidate.id },
        data: { blobKey: sourceBlob.key },
      })
    );
    await t.throwsAsync(
      f.db.projectReportBlobDeletion.update({
        where: { id: candidate.id },
        data: { status: 'deleted' },
      })
    );
    const runtime = app.get(StorageRuntimeProvider);
    const remove = (projectId: string, key: string) =>
      runtime.deleteObject(
        'blob',
        `projects/${encodeURIComponent(projectId)}/${key}`
      );
    // Object removal succeeds but a subsequent failure rolls back the DB ack.
    await t.throwsAsync(
      f.model.deleteReservedBlob(
        lease,
        candidate.id,
        async (projectId, key) => {
          await remove(projectId, key);
          throw new Error('simulated crash after object removal');
        }
      )
    );
    const fenced = await f.db.projectBlob.findUniqueOrThrow({
      where: {
        projectId_key: {
          projectId: candidate.projectId,
          key: candidate.blobKey,
        },
      },
    });
    t.is(fenced.pendingDeletionId, `report:${f.scope.reportId}`);
    await t.throwsAsync(
      app.models.projectResource.getBlob({ ...f.actor, key: candidate.blobKey })
    );
    await t.throwsAsync(
      f.db.projectReportBlobReference.create({
        data: {
          projectId: f.scope.projectId,
          reportId: f.scope.reportId,
          blobKey: candidate.blobKey,
        },
      })
    );
    t.true(await f.model.deleteReservedBlob(lease, candidate.id, remove));
    await t.throwsAsync(
      f.db.projectReportBlobDeletion.update({
        where: { id: candidate.id },
        data: { status: 'pending', completedAt: null },
      })
    );
    await t.throwsAsync(
      f.db.projectReportBlobDeletion.delete({ where: { id: candidate.id } })
    );
    await f.model.retry(lease);
    const service = app.get(ProjectReportLifecycleService);
    await service.recover();
    t.deepEqual(app.queue.last('nightly.purgeProjectReport').payload, {
      reportId: f.scope.reportId,
    });
    await service.purge({ reportId: f.scope.reportId });
    t.is(
      (
        await f.db.projectReportDeletion.findUniqueOrThrow({
          where: { reportId: f.scope.reportId },
        })
      ).status,
      'purged'
    );
    t.is(
      await f.db.projectReportRevision.count({
        where: { reportId: f.scope.reportId },
      }),
      0
    );
    t.truthy(
      await f.db.projectReportAuditEvent.findFirst({
        where: {
          reportId: f.scope.reportId,
          action: 'purge.revision_evidence',
        },
      })
    );
    t.truthy(
      await f.db.projectReportAuditEvent.findFirst({
        where: { reportId: f.scope.reportId, action: 'purge.export_evidence' },
      })
    );
    t.is(
      (
        await resources.readFile({ ...f.actor, resourceId: source.id })
      ).bytes.toString(),
      'Original project document'
    );
    t.truthy(
      await f.db.officeArtifact.findUnique({
        where: { id: office.artifact.id },
      })
    );
    t.deepEqual(
      (await blobs.read({ ...f.actor, key: exportBlob.key })).bytes,
      Buffer.from(pptx.bytes)
    );
    t.is(await f.model.claim(f.scope.reportId), null);
    await t.throwsAsync(
      f.db.projectReportDeletion.update({
        where: { reportId: f.scope.reportId },
        data: { status: 'requested', completedAt: null },
      })
    );
  }
);

test.serial(
  'A52 deleted identity revokes delegated schedules/shares without reassigning reports or resending uncertain deliveries',
  async t => {
    const f = await fixture();
    const schedule = await f.db.projectReportSchedule.create({
      data: {
        ...f.actor,
        title: 'Delegated schedule',
        templateRevisionId: f.created.report.templateRevisionId,
        config: {},
        authorization: {},
        nextRunAt: new Date(),
      },
    });
    const occurrence = await f.db.projectReportOccurrence.create({
      data: {
        ...f.actor,
        reportId: f.scope.reportId,
        scheduleId: schedule.id,
        configVersion: 1,
        nominalTime: '2026-10-05T09:00',
        timeZone: 'UTC',
        snapshot: {},
        status: 'generating',
      },
    });
    await f.db.projectReportDelivery.createMany({
      data: ['queued', 'sending', 'sent'].map(status => ({
        projectId: f.actor.projectId,
        occurrenceId: occurrence.id,
        recipientKey: status,
        channel: 'email',
        authorizationHash: 'a'.repeat(64),
        status,
        providerReceipt: status === 'sent' ? 'receipt' : null,
      })),
    });
    const share = await f.db.projectReportShare.create({ data: f.scope });
    await f.db.aiContextProjectMember.create({
      data: {
        projectId: f.scope.projectId,
        userId: f.other.id,
        // Account deletion must leave a valid Project owner. Report creation
        // evidence still belongs to the original actor after that actor leaves.
        role: 'owner',
      },
    });
    await app.models.user.delete(f.owner.id);
    t.is(
      (
        await f.db.projectReportSchedule.findUniqueOrThrow({
          where: { id: schedule.id },
        })
      ).status,
      'paused'
    );
    t.is(
      (
        await f.db.projectReportShare.findUniqueOrThrow({
          where: { id: share.id },
        })
      ).status,
      'revoked'
    );
    const deliveries = await f.db.projectReportDelivery.findMany({
      where: { occurrenceId: occurrence.id },
    });
    t.is(
      deliveries.find(row => row.recipientKey === 'queued')?.status,
      'cancelled'
    );
    t.is(
      deliveries.find(row => row.recipientKey === 'sending')?.status,
      'unknown'
    );
    t.is(
      deliveries.find(row => row.recipientKey === 'sent')?.providerReceipt,
      'receipt'
    );
    t.is(
      (
        await f.db.projectReport.findUniqueOrThrow({
          where: { id: f.scope.reportId },
        })
      ).createdByActorId,
      f.owner.id
    );
    const visible = await f.content.read({ ...f.scope, actorId: f.other.id });
    t.is(visible.document.creator.actorId, f.owner.id);
    t.is(visible.document.creator.label, '已删除用户');
    t.is(visible.document.responsibility.identity.label, '已删除用户');
  }
);
