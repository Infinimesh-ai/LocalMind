import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { DocxSemanticState } from '@localmind/office/docx';
import test from 'ava';
import Sinon from 'sinon';

import {
  OFFICE_DOCX_STATE_MIME_TYPE,
  OfficeDocxImportService,
} from '../../core/office';
import type { PermissionAccess } from '../../core/permission';
import type { WorkspaceBlobStorage } from '../../core/storage';
import type { Models } from '../../models';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function allowOfficePermissions() {
  return {
    user: Sinon.stub().returns({
      workspace: Sinon.stub().returns({ assert: Sinon.stub().resolves() }),
    }),
  } as unknown as PermissionAccess;
}

test('imports trusted DOCX bytes and persists a native semantic state contract', async t => {
  const sourceBytes = await readFile(
    new URL('../../../../../common/native/fixtures/demo.docx', import.meta.url)
  );
  let stateObject:
    | { key: string; body: Buffer; contentType: string | undefined }
    | undefined;
  const createOrReuseImported = Sinon.stub().callsFake(async input => ({
    created: true,
    artifact: {
      id: 'artifact-1',
      sourceFingerprint: input.source.fingerprint,
    },
    revision: {
      id: 'revision-1',
      stateBlobKey: input.state?.key,
      stateFingerprint: input.state?.fingerprint,
      modelVersion: input.modelVersion,
    },
  }));
  const models = {
    blob: {
      get: Sinon.stub().resolves({
        key: 'imports/demo.docx',
        size: sourceBytes.byteLength,
        mime: DOCX_MIME,
        status: 'completed',
        deletedAt: null,
      }),
    },
    officeArtifact: { createOrReuseImported },
  } as unknown as Models;
  const storage = {
    get: Sinon.stub().resolves({
      body: Readable.from(sourceBytes),
      metadata: {
        contentType: DOCX_MIME,
        contentLength: sourceBytes.byteLength,
        lastModified: new Date(),
      },
    }),
    put: Sinon.stub().callsFake(async (_workspaceId, key, body, metadata) => {
      stateObject = {
        key,
        body: Buffer.from(body),
        contentType: metadata?.contentType,
      };
    }),
  } as unknown as WorkspaceBlobStorage;
  const service = new OfficeDocxImportService(
    models,
    storage,
    allowOfficePermissions()
  );

  const imported = await service.import({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    sourceBlobKey: 'imports/demo.docx',
    title: 'Native DOCX demo',
    sourceFileName: 'demo.docx',
    importIdempotencyKey: 'docx-import-demo',
  });

  t.regex(imported.sourceFingerprint, /^sha256:[0-9a-f]{64}$/);
  t.regex(imported.stateFingerprint, /^sha256:[0-9a-f]{64}$/);
  t.is(imported.revision.stateBlobKey, imported.stateBlobKey);
  t.is(imported.revision.stateFingerprint, imported.stateFingerprint);
  t.is(imported.revision.modelVersion, 'localmind-office-docx-model/v1');
  t.is(imported.artifact.sourceFingerprint, imported.sourceFingerprint);
  t.regex(
    imported.packageBlobKey,
    /^office\/package\/docx\/[0-9a-f]{64}\.docx$/
  );
  t.is(stateObject?.contentType, OFFICE_DOCX_STATE_MIME_TYPE);

  const state = JSON.parse(
    stateObject?.body.toString('utf8') ?? '{}'
  ) as DocxSemanticState;
  t.is(state.schemaVersion, 'localmind-office-docx-state/v1');
  t.true(state.stats.paragraphs > 0);
  t.true(state.package.opaqueParts.length > 0);

  const modelInput = createOrReuseImported.firstCall.args[0];
  t.is(modelInput.source.key, imported.packageBlobKey);
  t.is(modelInput.source.fingerprint, imported.sourceFingerprint);
  t.is(modelInput.state.fingerprint, imported.stateFingerprint);
  t.regex(modelInput.importFingerprint, /^sha256:[0-9a-f]{64}$/);
  t.is(modelInput.compatibility.engine, 'localmind-native-docx');
  t.is((storage.put as Sinon.SinonStub).callCount, 2);
});

test('rejects mismatched object metadata before parsing or persistence', async t => {
  const models = {
    blob: {
      get: Sinon.stub().resolves({
        key: 'imports/tampered.docx',
        size: 100,
        mime: DOCX_MIME,
        status: 'completed',
        deletedAt: null,
      }),
    },
    officeArtifact: { createOrReuseImported: Sinon.stub() },
  } as unknown as Models;
  const body = Readable.from(Buffer.alloc(99));
  const storage = {
    get: Sinon.stub().resolves({
      body,
      metadata: {
        contentType: DOCX_MIME,
        contentLength: 99,
        lastModified: new Date(),
      },
    }),
    put: Sinon.stub(),
  } as unknown as WorkspaceBlobStorage;
  const service = new OfficeDocxImportService(
    models,
    storage,
    allowOfficePermissions()
  );

  await t.throwsAsync(
    service.import({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      sourceBlobKey: 'imports/tampered.docx',
      title: 'Tampered',
      sourceFileName: 'tampered.docx',
      importIdempotencyKey: 'docx-import-tampered',
    }),
    { message: /object metadata does not match/ }
  );
  t.true(body.destroyed);
  t.false(
    (models.officeArtifact.createOrReuseImported as Sinon.SinonStub).called
  );
  t.false((storage.put as Sinon.SinonStub).called);
});

test('checks workspace permissions before reading DOCX source metadata', async t => {
  const models = {
    blob: { get: Sinon.stub() },
  } as unknown as Models;
  const storage = {} as WorkspaceBlobStorage;
  const denied = new Error('permission denied');
  const ac = {
    user: Sinon.stub().returns({
      workspace: Sinon.stub().returns({
        assert: Sinon.stub().rejects(denied),
      }),
    }),
  } as unknown as PermissionAccess;
  const service = new OfficeDocxImportService(models, storage, ac);

  await t.throwsAsync(
    service.import({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      sourceBlobKey: 'imports/denied.docx',
      title: 'Denied',
      sourceFileName: 'denied.docx',
      importIdempotencyKey: 'docx-import-denied',
    }),
    { is: denied }
  );
  t.false((models.blob.get as Sinon.SinonStub).called);
});
