import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { openPdfPackage } from '@localmind/office/pdf';
import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
} from '@localmind/office/report';
import {
  createMinimalPdfFixture,
  createMinimalPptxFixture,
  createMinimalXlsxFixture,
} from '@localmind/office/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { OFFICE_FORMATS, OfficeImportService } from '../../core/office';
import { ProjectBlobStorage, ProjectResourceService } from '../../core/project';
import { ProjectReportSourceService } from '../../core/project-report/source-service';
import { createDocWithMarkdown } from '../../native';
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
const period = {
  start: '2026-01-01T00:00:00Z',
  end: '2027-01-01T00:00:00Z',
  timeZone: 'UTC',
  weekStartsOn: 1 as const,
};
async function fixture() {
  const db = app.get(PrismaClient);
  const owner = await app.createUser(`source-${randomUUID()}@example.invalid`);
  const project = await db.aiContextProject.create({
    data: {
      name: 'Synthetic source acceptance',
      members: { create: { userId: owner.id, role: 'owner' } },
    },
  });
  const actor = { actorId: owner.id, projectId: project.id };
  const source = app.get(ProjectReportSourceService);
  const resources = app.get(ProjectResourceService);
  const bounded = <T>(work: () => Promise<T>) =>
    app
      .get<TransactionHost<TransactionalAdapterPrisma>>(TransactionHost)
      .withTransaction({ timeout: 30000 }, work);
  return { db, owner, actor, source, resources, bounded };
}

test.serial(
  'A11/A12 actual Page, Edgeless, text and four Office packages produce document evidence with explicit unreadable gaps',
  async t => {
    t.timeout(180000);
    const f = await fixture();
    for (const kind of ['page', 'edgeless'] as const) {
      await f.bounded(() =>
        f.resources.createDocument({
          ...f.actor,
          kind,
          title: `Synthetic ${kind}`,
          markdown: `${kind} document progress: three acceptance checks passed.`,
          requestKey: kind,
        })
      );
    }
    const blob = await f.bounded(() =>
      app.get(ProjectBlobStorage).put({
        ...f.actor,
        bytes: Buffer.from('Plain text document progress.'),
        mimeType: 'text/plain',
      })
    );
    await f.bounded(() =>
      f.resources.createFile({
        ...f.actor,
        title: 'progress.txt',
        blobKey: blob.key,
        requestKey: 'text',
      })
    );
    const emptyPdf = await openPdfPackage(await createMinimalPdfFixture());
    emptyPdf.document.removePage(0);
    const imagePage = emptyPdf.document.addPage();
    const image = await emptyPdf.document.embedPng(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
        'base64'
      )
    );
    imagePage.drawImage(image, { x: 50, y: 50, width: 50, height: 50 });
    const formats = [
      {
        format: 'docx' as const,
        bytes: await readFile(
          new URL(
            '../../../../../common/native/fixtures/demo.docx',
            import.meta.url
          )
        ),
        name: 'docx',
      },
      {
        format: 'xlsx' as const,
        bytes: createMinimalXlsxFixture(),
        name: 'xlsx',
      },
      {
        format: 'pptx' as const,
        bytes: createMinimalPptxFixture(),
        name: 'pptx',
      },
      {
        format: 'pdf' as const,
        bytes: await createMinimalPdfFixture(),
        name: 'pdf',
      },
      {
        format: 'pdf' as const,
        bytes: await emptyPdf.document.save(),
        name: 'image-only',
      },
    ];
    for (const item of formats) {
      const stored = await f.bounded(() =>
        app.get(ProjectBlobStorage).put({
          ...f.actor,
          bytes: Buffer.from(item.bytes),
          mimeType: OFFICE_FORMATS[item.format].mimeType,
        })
      );
      await f.bounded(() =>
        app.get(OfficeImportService).import({
          ...f.actor,
          title: item.name,
          sourceFileName: `${item.name}.${item.format}`,
          sourceBlobKey: stored.key,
          importIdempotencyKey: item.name,
        })
      );
    }
    const damaged = await f.bounded(() =>
      app.get(ProjectBlobStorage).put({
        ...f.actor,
        bytes: Buffer.from('%PDF-1.7\n damaged %%EOF'),
        mimeType: 'application/pdf',
      })
    );
    await f.bounded(() =>
      f.resources.createFile({
        ...f.actor,
        title: 'damaged.pdf',
        blobKey: damaged.key,
        requestKey: 'damaged',
      })
    );
    const capture = await f.source.discover({
      ...f.actor,
      selection: { kind: 'all' },
      cutoffAt: new Date().toISOString(),
      period,
    });
    t.is(capture.resources.length, 9);
    t.true(capture.enumerationComplete);
    const snapshots = [];
    for (const item of capture.resources)
      snapshots.push(await f.source.read(f.actor, item, 250000));
    t.is(snapshots.filter(item => item.source.status === 'parsed').length, 7);
    t.true(
      snapshots.some(
        item =>
          item.source.kind === 'page' && item.text.includes('three acceptance')
      )
    );
    t.true(
      snapshots.some(
        item =>
          item.source.kind === 'edgeless' &&
          item.text.includes('three acceptance')
      )
    );
    t.true(
      snapshots.some(
        item => item.source.kind === 'workbook' && item.text.includes('Revenue')
      )
    );
    t.true(
      snapshots.some(
        item =>
          item.source.kind === 'presentation' &&
          item.text.includes('Hello LocalMind')
      )
    );
    t.true(
      snapshots.some(
        item =>
          item.source.kind === 'pdf' &&
          item.text.includes('LocalMind native PDF')
      )
    );
    t.is(
      snapshots.find(item => item.source.title === 'image-only')?.source.reason,
      'no_extractable_text_ocr_unavailable'
    );
    t.is(
      snapshots.find(item => item.source.title === 'damaged.pdf')?.source
        .reason,
      'unsupported_encrypted_or_damaged_source'
    );
    const budget = await f.source.read(f.actor, capture.resources[0]!, 0);
    t.is(budget.source.status, 'omitted');
    t.is(budget.source.reason, 'total_text_budget');
    await t.throwsAsync(() =>
      f.source['readPdf'](Buffer.from('%PDF-1.7\n broken %%EOF'), 1000)
    );
  }
);

test.serial(
  'A14/A15 frozen source revision survives edits, historical fallback is explicit and private memory or forged work-order sources cannot become evidence',
  async t => {
    const f = await fixture();
    const resource = await f.bounded(() =>
      f.resources.createDocument({
        ...f.actor,
        title: 'Source',
        markdown: 'Before snapshot: planned.',
        requestKey: 'source',
      })
    );
    const captured = await f.source.discover({
      ...f.actor,
      selection: { kind: 'all' },
      cutoffAt: new Date().toISOString(),
      period,
    });
    const lease = await app.models.projectResourceEditLease.acquire({
      ...f.actor,
      resourceId: resource.id,
      tabId: 'source-editor',
      kind: 'user',
    });
    await f.bounded(() =>
      f.resources.saveDocument({
        ...f.actor,
        resourceId: resource.id,
        bytes: Buffer.from(
          createDocWithMarkdown(
            'Source',
            'After snapshot: completed.',
            resource.id
          )
        ),
        expectedContentVersion: 1,
        requestKey: 'edit',
        editLease: {
          leaseId: lease.lease!.leaseId,
          tabId: 'source-editor',
          kind: 'user',
        },
      })
    );
    const fixed = await f.source.read(f.actor, captured.resources[0]!, 10000);
    t.true(fixed.text.includes('Before snapshot'));
    t.false(fixed.text.includes('After snapshot'));
    t.is(fixed.source.revision, '1');
    const old = await f.source.discover({
      ...f.actor,
      selection: { kind: 'all' },
      cutoffAt: '2000-01-01T00:00:00Z',
      period,
    });
    t.true(old.resources[0]!.historicalGap);
    await f.bounded(() =>
      app.models.copilotContextMemory.createProjectSummary(
        f.owner.id,
        f.actor.projectId,
        'Shared project goal: synthetic acceptance.'
      )
    );
    await f.bounded(() =>
      app.models.copilotContextMemory.put({
        ownerUserId: f.owner.id,
        scope: 'user',
        kind: 'auto_memory',
        visibility: 'private',
        content: 'PRIVATE_MEMBER_PROGRESS_MUST_NOT_BE_SHARED',
      })
    );
    const background = await f.source.background({
      ...f.actor,
      cutoffAt: new Date().toISOString(),
    });
    t.is(background.snapshots.length, 1);
    t.true(background.snapshots[0]!.text.includes('Shared project goal'));
    t.false(JSON.stringify(background).includes('PRIVATE_MEMBER_PROGRESS'));
    const document = createReportDocument({
      title: 'Source acceptance',
      creator: { actorId: f.owner.id, label: 'Creator' },
      template: BUILTIN_REPORT_TEMPLATES[0]!.content,
      period,
      now: new Date().toISOString(),
    });
    document.sources = [fixed.source];
    await t.notThrowsAsync(() =>
      f.source.validateSources({ ...f.actor, document })
    );
    await t.throwsAsync(() =>
      f.source.validateSources({
        ...f.actor,
        document: {
          ...document,
          sources: [{ ...fixed.source, fingerprint: '0'.repeat(64) }],
        },
      })
    );
    await t.throwsAsync(() =>
      f.source.validateSources({
        ...f.actor,
        document: {
          ...document,
          sources: [{ ...fixed.source, kind: 'work_order' }],
        },
      })
    );
  }
);

test.serial(
  'A14b participant work orders become status-only business evidence without private delivery content',
  async t => {
    const f = await fixture();
    const [recipient, bystander] = await Promise.all(
      ['wo-recipient', 'wo-bystander'].map(name =>
        app.createUser(`${name}-${randomUUID()}@example.invalid`)
      )
    );
    await f.db.aiContextProjectMember.createMany({
      data: [recipient, bystander].map(user => ({
        projectId: f.actor.projectId,
        userId: user.id,
        role: 'member',
      })),
    });
    const otherProject = await f.db.aiContextProject.create({
      data: {
        name: 'Other project',
        members: { create: { userId: f.owner.id, role: 'owner' } },
      },
    });
    const dispatch = await f.db.workOrderDispatch.create({
      data: {
        senderId: f.owner.id,
        status: 'confirmed',
        draftFingerprint: 'd'.repeat(64),
        draft: { secret: 'SECRET_DISPATCH_DRAFT' },
        requestKey: 'report-dispatch',
        expiresAt: new Date(Date.now() + 86400000),
        confirmedAt: new Date(),
      },
    });
    const order = async (
      title: string,
      status: string,
      projectId: string | null = f.actor.projectId
    ) =>
      f.db.workOrder.create({
        data: {
          dispatchId: dispatch.id,
          sourceProjectIdSnapshot: projectId,
          senderId: f.owner.id,
          recipientId: recipient.id,
          status,
          version: status === 'delivered' ? 3 : 1,
          title,
          purpose: 'SECRET_PURPOSE_BODY',
          requirementsFingerprint: 'e'.repeat(64),
          completedAt: status === 'delivered' ? new Date() : null,
          requirements: {
            create: [
              {
                itemKey: 'summary',
                kind: 'text',
                title: 'Acceptance summary',
                instructions: 'SECRET_INSTRUCTIONS',
                validationMode: 'non_empty_text',
                ordinal: 0,
              },
              {
                itemKey: 'optional',
                kind: 'text',
                title: 'Optional appendix',
                instructions: 'optional',
                required: false,
                validationMode: 'non_empty_text',
                ordinal: 1,
              },
            ],
          },
        },
        include: { requirements: true },
      });
    const delivered = await order('Synthetic acceptance', 'delivered');
    const pending = await order('Synthetic follow-up', 'open');
    await order('Other project order', 'open', otherProject.id);
    const requirementId = delivered.requirements[0]!.id;
    const revision = await f.db.workOrderDeliveryRevision.create({
      data: {
        workOrderId: delivered.id,
        revision: 1,
        submittedBy: recipient.id,
        requirementsFingerprint: 'e'.repeat(64),
        receiptFingerprint: 'r'.repeat(64),
        validationEvidence: { secret: 'SECRET_VALIDATION' },
      },
    });
    await f.db.workOrderDeliveryItem.create({
      data: {
        deliveryRevisionId: revision.id,
        workOrderId: delivered.id,
        requirementId,
        textValue: 'SECRET_DELIVERY_TEXT',
      },
    });
    await f.db.workOrderDeliveryDraft.create({
      data: {
        workOrderId: pending.id,
        ownerId: recipient.id,
        items: [{ text: 'SECRET_DRAFT_TEXT' }],
      },
    });
    await f.db.workOrderBlob.create({
      data: {
        workOrderId: pending.id,
        ownerId: recipient.id,
        requirementId: pending.requirements[0]!.id,
        requestKey: 'staged',
        key: 'SECRET_STAGED_KEY',
        fileName: 'SECRET_STAGED.md',
        mimeType: 'text/markdown',
        byteSize: 10,
        fingerprint: 'f'.repeat(64),
      },
    });
    await f.db.workOrderExchange.create({
      data: {
        workOrderId: pending.id,
        actorId: recipient.id,
        kind: 'question',
        body: 'SECRET_EXCHANGE_BODY',
        fingerprint: 'a'.repeat(64),
        requestKey: 'exchange',
      },
    });
    const read = (actorId: string) =>
      f.source.workOrders({
        actorId,
        projectId: f.actor.projectId,
        cutoffAt: new Date(Date.now() + 60000).toISOString(),
        period,
      });
    const recipientView = await read(recipient.id);
    t.true(recipientView.complete);
    t.is(recipientView.snapshots.length, 2);
    const serialized = JSON.stringify(recipientView);
    for (const secret of [
      'SECRET_DISPATCH_DRAFT',
      'SECRET_PURPOSE_BODY',
      'SECRET_INSTRUCTIONS',
      'SECRET_VALIDATION',
      'SECRET_DELIVERY_TEXT',
      'SECRET_DRAFT_TEXT',
      'SECRET_STAGED',
      'SECRET_EXCHANGE_BODY',
      'Optional appendix',
      'Other project order',
    ])
      t.false(serialized.includes(secret), secret);
    const recipientDelivered = recipientView.snapshots.find(
      item => item.source.resourceId === delivered.id
    )!;
    t.is(recipientDelivered.source.kind, 'work_order');
    t.is(recipientDelivered.source.status, 'parsed');
    t.is(recipientDelivered.source.revision, 'delivered:3:1');
    t.is(recipientDelivered.source.locator, 'work-order:3');
    t.true(recipientDelivered.text.includes('已交付完成'));
    t.true(recipientDelivered.text.includes('Acceptance summary'));
    t.true(recipientDelivered.text.includes('最新交付为第 1 版'));
    t.true(recipientDelivered.text.includes('交付项 1 个'));
    // The dispatch is unreleased while the follow-up is open: sender sees status only.
    const senderView = await read(f.owner.id);
    t.is(senderView.snapshots.length, 2);
    const senderDelivered = senderView.snapshots.find(
      item => item.source.resourceId === delivered.id
    )!;
    t.is(senderDelivered.source.revision, 'delivered:3:0');
    t.true(senderDelivered.text.includes('已交付完成'));
    t.false(senderDelivered.text.includes('最新交付'));
    t.false(senderDelivered.text.includes('完成时间'));
    t.is((await read(bystander.id)).snapshots.length, 0);

    const document = createReportDocument({
      title: 'Work-order evidence',
      creator: { actorId: recipient.id, label: 'Recipient' },
      template: BUILTIN_REPORT_TEMPLATES[0]!.content,
      period,
      now: new Date().toISOString(),
    });
    const validate = (actorId: string, source = recipientDelivered.source) =>
      f.source.validateSources({
        actorId,
        projectId: f.actor.projectId,
        document: { ...document, sources: [source] },
      });
    await t.notThrowsAsync(() => validate(recipient.id));
    await t.throwsAsync(() => validate(bystander.id));
    await t.throwsAsync(() =>
      validate(recipient.id, {
        ...recipientDelivered.source,
        fingerprint: '0'.repeat(64),
      })
    );
    await f.db.workOrder.update({
      where: { id: delivered.id },
      data: { version: 4 },
    });
    // The prior version remains historical evidence; the new version needs a
    // fresh server-built fingerprint.
    await t.notThrowsAsync(() => validate(recipient.id));
    await t.throwsAsync(() =>
      validate(recipient.id, {
        ...recipientDelivered.source,
        revision: 'delivered:4:1',
      })
    );
    await t.throwsAsync(() =>
      validate(recipient.id, {
        ...recipientDelivered.source,
        revision: 'delivered:5:1',
      })
    );
    const refreshed = (await read(recipient.id)).snapshots.find(
      item => item.source.resourceId === delivered.id
    )!;
    t.is(refreshed.source.revision, 'delivered:4:1');
    t.not(refreshed.source.fingerprint, recipientDelivered.source.fingerprint);
    await t.notThrowsAsync(() => validate(recipient.id, refreshed.source));

    // Releasing the dispatch exposes delivery metadata to the sender.
    await f.db.workOrder.update({
      where: { id: pending.id },
      data: { status: 'cancelled', version: 2 },
    });
    const released = (await read(f.owner.id)).snapshots.find(
      item => item.source.resourceId === delivered.id
    )!;
    t.is(released.source.revision, 'delivered:4:1');
    t.true(released.text.includes('最新交付为第 1 版'));
    t.false(JSON.stringify(released).includes('SECRET_DELIVERY_TEXT'));

    // A participant who leaves the project loses the evidence immediately.
    await f.db.aiContextProjectMember.delete({
      where: {
        projectId_userId: {
          projectId: f.actor.projectId,
          userId: recipient.id,
        },
      },
    });
    await t.throwsAsync(() => read(recipient.id));
    await t.throwsAsync(() => validate(recipient.id, refreshed.source));
  }
);
