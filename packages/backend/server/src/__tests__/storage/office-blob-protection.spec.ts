import { randomUUID } from 'node:crypto';

import { OfficeArtifactKind } from '@prisma/client';
import ava, { TestFn } from 'ava';
import Sinon from 'sinon';

import { StorageModule, WorkspaceBlobStorage } from '../../core/storage';
import { StorageRuntimeProvider } from '../../core/storage-runtime';
import { Models } from '../../models';
import { MockUser, MockWorkspace } from '../mocks';
import { createTestingModule, TestingModule } from '../utils';

interface Context {
  module: TestingModule;
  models: Models;
  storage: WorkspaceBlobStorage;
  deleteObject: Sinon.SinonStub;
}

const test = ava as TestFn<Context>;

test.before(async t => {
  t.context.deleteObject = Sinon.stub();
  t.context.module = await createTestingModule({
    imports: [StorageModule],
    tapModule: builder => {
      builder.overrideProvider(StorageRuntimeProvider).useValue({
        deleteObject: t.context.deleteObject,
      });
    },
  });
  t.context.models = t.context.module.get(Models);
  t.context.storage = t.context.module.get(WorkspaceBlobStorage);
});

test.beforeEach(t => {
  t.context.deleteObject.reset();
});

test.after.always(async t => {
  await t.context.module?.close();
});

test('does not delete object storage bytes for a referenced Office blob', async t => {
  const owner = await t.context.module.create(MockUser);
  const workspace = await t.context.module.create(MockWorkspace, {
    owner: { id: owner.id },
  });
  const key = `office/${randomUUID()}.pdf`;
  await t.context.models.blob.upsert({
    workspaceId: workspace.id,
    key,
    mime: 'application/pdf',
    size: 512,
  });
  await t.context.models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.pdf,
    title: 'Protected PDF',
    sourceFileName: 'protected.pdf',
    source: {
      key,
      mimeType: 'application/pdf',
      byteSize: 512,
      fingerprint: `sha256:${randomUUID()}`,
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: `sha256:${randomUUID()}`,
  });

  await t.throwsAsync(t.context.storage.delete(workspace.id, key, true), {
    message: /Office blob is still referenced/,
  });
  t.false(t.context.deleteObject.called);
});
