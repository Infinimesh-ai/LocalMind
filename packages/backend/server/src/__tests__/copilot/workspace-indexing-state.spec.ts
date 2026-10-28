import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import ava, { type ExecutionContext, type TestFn } from 'ava';
import Sinon from 'sinon';

import { EMBEDDING_DIMENSIONS, Models } from '../../models';
import { CopilotEmbeddingJob } from '../../plugins/copilot/embedding/job';
import { EmbeddingClient } from '../../plugins/copilot/embedding/types';
import { CopilotStorage } from '../../plugins/copilot/storage';
import { CopilotWorkspaceEmbeddingConfigResolver } from '../../plugins/copilot/workspace/resolver';
import { createTestingModule, type TestingModule } from '../utils';

const test = ava.serial as TestFn<{
  module: TestingModule;
  models: Models;
  db: PrismaClient;
  workspaceId: string;
  userId: string;
  fileId: string;
}>;

test.before(async t => {
  t.context.module = await createTestingModule();
  t.context.models = t.context.module.get(Models);
  t.context.db = t.context.module.get(PrismaClient);
});
test.beforeEach(async t => {
  await t.context.module.initTestingDB();
  const user = await t.context.models.user.create({
    email: `${randomUUID()}@example.test`,
  });
  const workspace = await t.context.models.workspace.create(user.id);
  const file = await t.context.models.copilotWorkspace.addFile(workspace.id, {
    blobId: 'index-fixture',
    fileName: 'index.txt',
    mimeType: 'text/plain',
    size: 4,
  });
  Object.assign(t.context, {
    userId: user.id,
    workspaceId: workspace.id,
    fileId: file.fileId,
  });
});
test.afterEach.always(() => Sinon.restore());
test.after.always(async t => t.context.module.close());

const vector = [
  {
    index: 0,
    content: 'fixture',
    embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1),
  },
];

async function claim(
  t: ExecutionContext<{
    models: Models;
    workspaceId: string;
    fileId: string;
    userId: string;
  }>
) {
  const { models, workspaceId, fileId, userId } = t.context;
  const requestId = await models.copilotWorkspace.queueEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    { userId, retry: true }
  );
  t.truthy(requestId);
  const runId = await models.copilotWorkspace.startEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    requestId!
  );
  t.truthy(runId);
  return { requestId: requestId!, runId: runId! };
}

test('concurrent submissions claim one generation and do not duplicate the resource', async t => {
  const { models, workspaceId, fileId, userId } = t.context;
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      models.copilotWorkspace.queueEmbeddingTask(workspaceId, 'file', fileId, {
        userId,
        retry: true,
      })
    )
  );
  t.is(results.filter(Boolean).length, 1);
  t.is(await models.copilotWorkspace.countFiles(workspaceId), 1);
});

test('only final failure counts; retry persists success and rejects stale completion/failure', async t => {
  const { models, workspaceId, fileId, db } = t.context;
  const m = models.copilotWorkspace;
  const first = await claim(t);
  await m.failEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    first.requestId,
    first.runId,
    false
  );
  t.deepEqual(await m.getEmbeddingStatus(workspaceId), {
    total: 1,
    embedded: 0,
    failed: 0,
    retryable: 0,
  });
  const lastRun = (await m.startEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    first.requestId
  ))!;
  await m.failEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    first.requestId,
    lastRun,
    true
  );
  t.deepEqual(await m.getEmbeddingStatus(workspaceId), {
    total: 1,
    embedded: 0,
    failed: 1,
    retryable: 1,
  });
  const second = await claim(t);
  t.not(first.requestId, second.requestId);
  t.false(
    await m.completeEmbeddingTask(
      workspaceId,
      'file',
      fileId,
      first.requestId,
      lastRun,
      vector
    )
  );
  t.true(
    await m.completeEmbeddingTask(
      workspaceId,
      'file',
      fileId,
      second.requestId,
      second.runId,
      vector
    )
  );
  await m.failEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    first.requestId,
    lastRun,
    true
  );
  t.deepEqual(await m.getEmbeddingStatus(workspaceId), {
    total: 1,
    embedded: 1,
    failed: 0,
    retryable: 0,
  });
  t.is(
    (await db.aiWorkspaceEmbeddingTask.findFirstOrThrow()).status,
    'succeeded'
  );
  t.is(await m.countFiles(workspaceId), 1);
});

test('worker lease handoff and expired enqueue recovery reject old writers', async t => {
  const { models, workspaceId, fileId, db } = t.context;
  const m = models.copilotWorkspace;
  const first = await claim(t);
  const replacement = (await m.startEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    first.requestId
  ))!;
  t.false(
    await m.completeEmbeddingTask(
      workspaceId,
      'file',
      fileId,
      first.requestId,
      first.runId,
      vector
    )
  );
  await db.aiWorkspaceEmbeddingTask.updateMany({
    data: { leaseUntil: new Date(0) },
  });
  t.is((await m.getEmbeddingStatus(workspaceId)).failed, 1);
  const next = await claim(t);
  t.false(
    await m.completeEmbeddingTask(
      workspaceId,
      'file',
      fileId,
      first.requestId,
      replacement,
      vector
    )
  );
  t.true(
    await m.completeEmbeddingTask(
      workspaceId,
      'file',
      fileId,
      next.requestId,
      next.runId,
      vector
    )
  );
});

test('deleted resources cannot be resurrected by an in-flight worker', async t => {
  const { models, workspaceId, fileId } = t.context;
  const attempt = await claim(t);
  await models.copilotWorkspace.removeFile(workspaceId, fileId);
  t.false(
    await models.copilotWorkspace.completeEmbeddingTask(
      workspaceId,
      'file',
      fileId,
      attempt.requestId,
      attempt.runId,
      vector
    )
  );
  t.deepEqual(await models.copilotWorkspace.getEmbeddingStatus(workspaceId), {
    total: 0,
    embedded: 0,
    failed: 0,
    retryable: 0,
  });
});

test('historical missing source owner is failed but not advertised as retryable', async t => {
  const { models, workspaceId, fileId } = t.context;
  const m = models.copilotWorkspace;
  const requestId = (await m.queueEmbeddingTask(workspaceId, 'file', fileId))!;
  await m.failEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    requestId,
    null,
    true,
    'source_owner_missing'
  );
  t.deepEqual(await m.getEmbeddingStatus(workspaceId), {
    total: 1,
    embedded: 0,
    failed: 1,
    retryable: 0,
  });
});

test('file worker commits all chunks atomically and records failure without a contextId', async t => {
  const { module, models, workspaceId, fileId, userId, db } = t.context;
  const job = module.get(CopilotEmbeddingJob);
  class Client extends EmbeddingClient {
    override async getFileChunks() {
      return [[{ index: 0, content: 'one' }], [{ index: 1, content: 'two' }]];
    }
    async getEmbeddings(input: string[]) {
      if (input[0] === 'two') throw new Error('provider test failure');
      return vector;
    }
  }
  const client = new Client();
  Sinon.stub(job, 'embeddingClient').get(() => client);
  Reflect.set(job, 'supportEmbedding', true);
  await module
    .get(CopilotStorage)
    .put(userId, workspaceId, 'index-fixture', Buffer.from('data'));
  const requestId = (await models.copilotWorkspace.queueEmbeddingTask(
    workspaceId,
    'file',
    fileId,
    { userId }
  ))!;
  const payload = {
    userId,
    workspaceId,
    fileId,
    fileName: 'index.txt',
    blobId: 'index-fixture',
    requestId,
  };
  await t.throwsAsync(
    job.embedPendingFile(payload, { attempt: 1, maxAttempts: 2 })
  );
  t.is(await db.aiWorkspaceFileEmbedding.count(), 0);
  t.is(
    (await models.copilotWorkspace.getEmbeddingStatus(workspaceId)).failed,
    0
  );
  await t.throwsAsync(
    job.embedPendingFile(payload, { attempt: 2, maxAttempts: 2 })
  );
  t.is(
    (await models.copilotWorkspace.getEmbeddingStatus(workspaceId)).failed,
    1
  );
});

test('retry requires current workspace settings permission', async t => {
  const outsider = await t.context.models.user.create({
    email: `${randomUUID()}@example.test`,
  });
  const resolver = t.context.module.get(
    CopilotWorkspaceEmbeddingConfigResolver
  );
  await t.throwsAsync(
    resolver.retryWorkspaceEmbedding(
      { id: outsider.id } as Parameters<
        typeof resolver.retryWorkspaceEmbedding
      >[0],
      t.context.workspaceId
    )
  );
});
