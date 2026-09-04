import { randomUUID } from 'node:crypto';

import {
  OfficeArtifactKind,
  OfficeRevisionOrigin,
  PrismaClient,
} from '@prisma/client';
import test from 'ava';

import { createModule } from '../../__tests__/create-module';
import { Mockers } from '../../__tests__/mocks';
import { Models } from '../index';

const module = await createModule();
const models = module.get(Models);
const db = module.get(PrismaClient);

test.after.always(async () => {
  await module.close();
});

async function createContext() {
  const owner = await module.create(Mockers.User);
  const workspace = await module.create(Mockers.Workspace, { owner });
  return { owner, workspace };
}

async function putBlob(
  workspaceId: string,
  key: string,
  mime: string,
  size: number
) {
  return await models.blob.upsert({ workspaceId, key, mime, size });
}

test('creates and idempotently reuses an imported office artifact', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.docx`;
  const stateKey = `office/${randomUUID()}-state.json`;
  const mime =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await putBlob(workspace.id, key, mime, 2048);
  await putBlob(workspace.id, stateKey, 'application/json', 512);
  const input = {
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.document,
    title: 'Quarterly report',
    sourceFileName: 'quarterly-report.docx',
    source: {
      key,
      mimeType: mime,
      byteSize: 2048,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
    compatibility: { package: 'ooxml', preservation: 'opaque-parts' },
    state: {
      key: stateKey,
      byteSize: 512,
      fingerprint: `sha256:${randomUUID()}`,
    },
    modelVersion: 'localmind-office-docx-model/v1',
    operationSummary: { type: 'import', engine: 'localmind-native-docx' },
  };

  const created = await models.officeArtifact.createOrReuseImported(input);
  const reused = await models.officeArtifact.createOrReuseImported(input);

  t.true(created.created);
  t.false(reused.created);
  t.is(reused.artifact.id, created.artifact.id);
  t.is(created.artifact.revisionCounter, 1);
  t.is(created.revision.sequence, 1);
  t.is(created.revision.origin, OfficeRevisionOrigin.import);
  t.is(created.revision.packageBlobKey, key);
  t.is(created.revision.stateBlobKey, stateKey);
  t.is(created.revision.stateByteSize, 512);
  t.is(created.revision.modelVersion, 'localmind-office-docx-model/v1');
  t.is(created.revision.parentRevisionId, null);
  t.is(
    await db.officeArtifact.count({ where: { workspaceId: workspace.id } }),
    1
  );
  t.is(
    await db.officeRevision.count({
      where: { artifactId: created.artifact.id },
    }),
    1
  );
});

test('rejects an import idempotency key reused with different evidence', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.docx`;
  const mime =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await putBlob(workspace.id, key, mime, 1024);
  const input = {
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.document,
    title: 'Document',
    sourceFileName: 'document.docx',
    source: {
      key,
      mimeType: mime,
      byteSize: 1024,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  };
  await models.officeArtifact.createOrReuseImported(input);

  await t.throwsAsync(
    models.officeArtifact.createOrReuseImported({
      ...input,
      importFingerprint: `sha256:${randomUUID()}`,
    }),
    { message: /import idempotency conflict/ }
  );
});

test('reconciles concurrent import requests with the same evidence', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.xlsx`;
  const mime =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  await putBlob(workspace.id, key, mime, 4096);
  const input = {
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.workbook,
    title: 'Forecast',
    sourceFileName: 'forecast.xlsx',
    source: {
      key,
      mimeType: mime,
      byteSize: 4096,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  };

  const results = await Promise.all([
    models.officeArtifact.createOrReuseImported(input),
    models.officeArtifact.createOrReuseImported(input),
  ]);

  t.deepEqual(
    results
      .map(result => result.created)
      .sort((left, right) => Number(left) - Number(right)),
    [false, true]
  );
  t.is(results[0].artifact.id, results[1].artifact.id);
});

test('appends a linear revision and rejects a stale parent', async t => {
  const { owner, workspace } = await createContext();
  const mime =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const sourceKey = `office/${randomUUID()}-source.docx`;
  await putBlob(workspace.id, sourceKey, mime, 1024);
  const imported = await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.document,
    title: 'Document',
    sourceFileName: 'document.docx',
    source: {
      key: sourceKey,
      mimeType: mime,
      byteSize: 1024,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });
  const packageKey = `office/${randomUUID()}-revision.docx`;
  const stateKey = `office/${randomUUID()}-state.bin`;
  await putBlob(workspace.id, packageKey, mime, 1100);
  await putBlob(workspace.id, stateKey, 'application/octet-stream', 300);
  const revisionInput = {
    workspaceId: workspace.id,
    artifactId: imported.artifact.id,
    actorId: owner.id,
    origin: OfficeRevisionOrigin.ai,
    expectedParentRevisionId: imported.revision.id,
    idempotencyKey: `command:${randomUUID()}`,
    idempotencyFingerprint: `sha256:${randomUUID()}`,
    package: {
      key: packageKey,
      mimeType: mime,
      byteSize: 1100,
      fingerprint: `sha256:${randomUUID()}`,
    },
    state: {
      key: stateKey,
      byteSize: 300,
      fingerprint: `sha256:${randomUUID()}`,
    },
    operationSummary: {
      operation: 'office.document.text.format',
      changedRanges: 1,
    },
  };

  const appended = await models.officeArtifact.appendRevision(revisionInput);
  const reused = await models.officeArtifact.appendRevision(revisionInput);

  t.true(appended.created);
  t.false(reused.created);
  t.is(appended.revision.sequence, 2);
  t.is(appended.revision.parentRevisionId, imported.revision.id);
  t.is(appended.revision.stateBlobKey, stateKey);
  t.is(
    (
      await models.officeArtifact.getCurrentRevision(
        workspace.id,
        imported.artifact.id
      )
    )?.id,
    appended.revision.id
  );

  await t.throwsAsync(
    models.officeArtifact.appendRevision({
      ...revisionInput,
      idempotencyKey: `command:${randomUUID()}`,
      idempotencyFingerprint: `sha256:${randomUUID()}`,
    }),
    { message: /revision conflict/ }
  );
});

test('persists office revisions as immutable evidence', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.pdf`;
  await putBlob(workspace.id, key, 'application/pdf', 512);
  const imported = await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.pdf,
    title: 'Contract',
    sourceFileName: 'contract.pdf',
    source: {
      key,
      mimeType: 'application/pdf',
      byteSize: 512,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });

  await t.throwsAsync(
    db.officeRevision.update({
      where: { id: imported.revision.id },
      data: { packageFingerprint: `sha256:${randomUUID()}` },
    }),
    { message: /office_revision_immutable_restrict_check/ }
  );
});

test('rejects import origin after the initial revision', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.pptx`;
  const mime =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await putBlob(workspace.id, key, mime, 2048);
  const imported = await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.presentation,
    title: 'Review',
    sourceFileName: 'review.pptx',
    source: {
      key,
      mimeType: mime,
      byteSize: 2048,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });

  await t.throwsAsync(
    models.officeArtifact.appendRevision({
      workspaceId: workspace.id,
      artifactId: imported.artifact.id,
      actorId: owner.id,
      origin: OfficeRevisionOrigin.import,
      expectedParentRevisionId: imported.revision.id,
      idempotencyKey: `command:${randomUUID()}`,
      idempotencyFingerprint: `sha256:${randomUUID()}`,
      package: {
        key,
        mimeType: mime,
        byteSize: 2048,
        fingerprint: `sha256:${randomUUID()}`,
      },
    }),
    { message: /only valid for the initial revision/ }
  );
});

test('rejects package MIME types that do not match the artifact kind', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.pdf`;
  await putBlob(workspace.id, key, 'application/pdf', 512);

  await t.throwsAsync(
    models.officeArtifact.createOrReuseImported({
      workspaceId: workspace.id,
      actorId: owner.id,
      kind: OfficeArtifactKind.document,
      title: 'Wrong package',
      sourceFileName: 'wrong.pdf',
      source: {
        key,
        mimeType: 'application/pdf',
        byteSize: 512,
        fingerprint: `sha256:${randomUUID()}`,
      },
      importIdempotencyKey: `import:${randomUUID()}`,
      importFingerprint: `sha256:${randomUUID()}`,
    }),
    { message: /document package MIME type/ }
  );
});

test('rejects oversized compatibility and operation summary JSON', async t => {
  const { owner, workspace } = await createContext();
  const mime =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const sourceKey = `office/${randomUUID()}-source.docx`;
  await putBlob(workspace.id, sourceKey, mime, 1024);
  const importInput = {
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.document,
    title: 'Bounded evidence',
    sourceFileName: 'bounded.docx',
    source: {
      key: sourceKey,
      mimeType: mime,
      byteSize: 1024,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  };

  await t.throwsAsync(
    models.officeArtifact.createOrReuseImported({
      ...importInput,
      compatibility: { details: 'x'.repeat(64 * 1024) },
    }),
    { message: /compatibility must not exceed 65536 bytes/ }
  );

  const imported =
    await models.officeArtifact.createOrReuseImported(importInput);
  const packageKey = `office/${randomUUID()}-revision.docx`;
  await putBlob(workspace.id, packageKey, mime, 1100);
  await t.throwsAsync(
    models.officeArtifact.appendRevision({
      workspaceId: workspace.id,
      artifactId: imported.artifact.id,
      actorId: owner.id,
      origin: OfficeRevisionOrigin.ai,
      expectedParentRevisionId: imported.revision.id,
      idempotencyKey: `command:${randomUUID()}`,
      idempotencyFingerprint: `sha256:${randomUUID()}`,
      package: {
        key: packageKey,
        mimeType: mime,
        byteSize: 1100,
        fingerprint: `sha256:${randomUUID()}`,
      },
      operationSummary: { details: 'x'.repeat(32 * 1024) },
    }),
    { message: /operation summary must not exceed 32768 bytes/ }
  );
});

test('keeps revision counters backed by an inserted revision', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.pdf`;
  await putBlob(workspace.id, key, 'application/pdf', 512);
  const imported = await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.pdf,
    title: 'Counter guard',
    sourceFileName: 'counter.pdf',
    source: {
      key,
      mimeType: 'application/pdf',
      byteSize: 512,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });

  await t.throwsAsync(
    db.officeArtifact.update({
      where: { id: imported.artifact.id },
      data: { revisionCounter: 2 },
    }),
    { message: /office_artifact_revision_counter_guard_check/ }
  );
});

test('rejects incomplete artifacts and blob metadata bypasses in SQL', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.pdf`;
  await putBlob(workspace.id, key, 'application/pdf', 512);
  const base = {
    workspaceId: workspace.id,
    kind: OfficeArtifactKind.pdf,
    title: 'Direct artifact',
    sourceFileName: 'direct.pdf',
    sourceMimeType: 'application/pdf',
    sourceBlobKey: key,
    sourceByteSize: 512,
    sourceFingerprint: `sha256:${randomUUID()}`,
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
    createdBy: owner.id,
  };

  await t.throwsAsync(
    db.officeArtifact.create({
      data: { ...base, sourceByteSize: 513 },
    }),
    { message: /office_artifact_source_blob_guard_check/ }
  );
  await t.throwsAsync(db.officeArtifact.create({ data: base }), {
    message: /office_artifact_initial_revision_commit_guard_check/,
  });
});

test('serializes concurrent revision writers for the same parent', async t => {
  const { owner, workspace } = await createContext();
  const mime =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const sourceKey = `office/${randomUUID()}-source.xlsx`;
  await putBlob(workspace.id, sourceKey, mime, 1024);
  const imported = await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.workbook,
    title: 'Concurrent workbook',
    sourceFileName: 'concurrent.xlsx',
    source: {
      key: sourceKey,
      mimeType: mime,
      byteSize: 1024,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });
  const packageKeys = [
    `office/${randomUUID()}-a.xlsx`,
    `office/${randomUUID()}-b.xlsx`,
  ];
  await Promise.all(
    packageKeys.map(key => putBlob(workspace.id, key, mime, 1100))
  );
  const results = await Promise.allSettled(
    packageKeys.map(key =>
      models.officeArtifact.appendRevision({
        workspaceId: workspace.id,
        artifactId: imported.artifact.id,
        actorId: owner.id,
        origin: OfficeRevisionOrigin.user,
        expectedParentRevisionId: imported.revision.id,
        idempotencyKey: `command:${randomUUID()}`,
        idempotencyFingerprint: `sha256:${randomUUID()}`,
        package: {
          key,
          mimeType: mime,
          byteSize: 1100,
          fingerprint: `sha256:${randomUUID()}`,
        },
      })
    )
  );

  t.is(results.filter(result => result.status === 'fulfilled').length, 1);
  t.is(results.filter(result => result.status === 'rejected').length, 1);
  t.is(
    await db.officeRevision.count({
      where: { artifactId: imported.artifact.id },
    }),
    2
  );
});

test('protects referenced blobs and releases them with the artifact', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.pdf`;
  await putBlob(workspace.id, key, 'application/pdf', 512);
  const imported = await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.pdf,
    title: 'Blob guard',
    sourceFileName: 'blob-guard.pdf',
    source: {
      key,
      mimeType: 'application/pdf',
      byteSize: 512,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });

  await t.throwsAsync(models.blob.delete(workspace.id, key), {
    message: /Office blob is still referenced/,
  });
  await t.throwsAsync(models.blob.delete(workspace.id, key, true), {
    message: /Office blob is still referenced/,
  });
  await t.throwsAsync(
    models.blob.upsert({
      workspaceId: workspace.id,
      key,
      mime: 'application/octet-stream',
      size: 999,
    }),
    { message: /office_blob_reference_restrict_check/ }
  );

  await db.officeArtifact.delete({ where: { id: imported.artifact.id } });
  await models.blob.delete(workspace.id, key, true);
  t.is(await models.blob.get(workspace.id, key), null);
});

test('allows workspace cascade deletion with office artifacts', async t => {
  const { owner, workspace } = await createContext();
  const key = `office/${randomUUID()}.pdf`;
  await putBlob(workspace.id, key, 'application/pdf', 512);
  await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.pdf,
    title: 'Workspace cascade',
    sourceFileName: 'workspace-cascade.pdf',
    source: {
      key,
      mimeType: 'application/pdf',
      byteSize: 512,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });

  await db.workspace.delete({ where: { id: workspace.id } });
  t.is(
    await db.officeArtifact.count({ where: { workspaceId: workspace.id } }),
    0
  );
  t.is(await db.blob.count({ where: { workspaceId: workspace.id } }), 0);
});
