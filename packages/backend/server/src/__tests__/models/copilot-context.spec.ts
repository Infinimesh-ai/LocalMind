import { randomUUID } from 'node:crypto';

import {
  Prisma,
  PrismaClient,
  type User,
  type Workspace,
} from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';

import { Config } from '../../base';
import {
  ContextEmbedStatus,
  CopilotContextMemoryModel,
  CopilotContextModel,
  CopilotSessionModel,
  CopilotWorkspaceConfigModel,
  EMBEDDING_DIMENSIONS,
  UserModel,
  WorkspaceModel,
} from '../../models';
import { createTestingModule, type TestingModule } from '../utils';
import { cleanObject } from '../utils/copilot';

interface Context {
  config: Config;
  module: TestingModule;
  db: PrismaClient;
  user: UserModel;
  workspace: WorkspaceModel;
  copilotSession: CopilotSessionModel;
  copilotContext: CopilotContextModel;
  copilotContextMemory: CopilotContextMemoryModel;
  copilotWorkspace: CopilotWorkspaceConfigModel;
}

const test = ava as TestFn<Context>;

test.before(async t => {
  const module = await createTestingModule();
  t.context.user = module.get(UserModel);
  t.context.workspace = module.get(WorkspaceModel);
  t.context.copilotSession = module.get(CopilotSessionModel);
  t.context.copilotContext = module.get(CopilotContextModel);
  t.context.copilotContextMemory = module.get(CopilotContextMemoryModel);
  t.context.copilotWorkspace = module.get(CopilotWorkspaceConfigModel);
  t.context.db = module.get(PrismaClient);
  t.context.config = module.get(Config);
  t.context.module = module;
});

let user: User;
let workspace: Workspace;
let sessionId: string;
let docId = 'doc1';

test.beforeEach(async t => {
  await t.context.module.initTestingDB();
  await t.context.db.aiPrompt.create({
    data: { name: 'prompt-name', model: 'gpt-5-mini', action: null },
  });
  user = await t.context.user.create({
    email: 'test@affine.pro',
  });
  workspace = await t.context.workspace.create(user.id);
  sessionId = await t.context.copilotSession.create({
    sessionId: randomUUID(),
    workspaceId: workspace.id,
    docId,
    userId: user.id,
    title: null,
    promptName: 'prompt-name',
    promptAction: null,
  });
});

test.after(async t => {
  await t.context.module.close();
});

test('should create a copilot context', async t => {
  const { id: contextId } = await t.context.copilotContext.create(sessionId);
  t.truthy(contextId);

  const context = await t.context.copilotContext.get(contextId);
  t.is(context?.id, contextId, 'should get context by id');

  const config = await t.context.copilotContext.getConfig(contextId);
  t.is(config?.workspaceId, workspace.id, 'should get context config');

  const context1 = await t.context.copilotContext.getBySessionId(sessionId);
  t.is(context1?.id, contextId, 'should get context by session id');
});

test('should get null for non-exist job', async t => {
  const job = await t.context.copilotContext.get('non-exist');
  t.snapshot(job, 'should return null for non-exist job');
});

test('should update context', async t => {
  const { id: contextId } = await t.context.copilotContext.create(sessionId);
  const config = (await t.context.copilotContext.getConfig(contextId))!;
  t.assert(config, 'should get context config');

  const doc = {
    id: docId,
    createdAt: Date.now(),
  };
  config.docs.push(doc);
  await t.context.copilotContext.update(contextId, { config });

  const config1 = await t.context.copilotContext.getConfig(contextId);
  t.deepEqual(config1, config);
});

test('should insert embedding by doc id', async t => {
  const { id: contextId } = await t.context.copilotContext.create(sessionId);

  {
    await t.context.copilotContext.insertFileEmbedding(contextId, 'file-id', [
      {
        index: 0,
        content: 'content',
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
      },
    ]);

    {
      const ret = await t.context.copilotContext.matchFileEmbedding(
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.9),
        contextId,
        1,
        1
      );
      t.snapshot(
        cleanObject(ret, ['chunk', 'content', 'distance']),
        'should match file embedding'
      );
    }

    {
      await t.context.copilotContext.deleteFileEmbedding(contextId, 'file-id');
      const ret = await t.context.copilotContext.matchFileEmbedding(
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.9),
        contextId,
        1,
        1
      );
      t.snapshot(ret, 'should return empty array when embedding is deleted');
    }
  }

  {
    await t.context.db.snapshot.create({
      data: {
        workspaceId: workspace.id,
        id: docId,
        blob: Buffer.from([1, 1]),
        state: Buffer.from([1, 1]),
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    });

    await t.context.copilotContext.insertWorkspaceEmbedding(
      workspace.id,
      docId,
      [
        {
          index: 0,
          content: 'content',
          embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
        },
      ]
    );

    {
      const ret = await t.context.copilotContext.listWorkspaceDocEmbedding(
        workspace.id,
        [docId]
      );
      t.true(
        ret.includes(docId),
        'should return doc id when embedding is inserted'
      );
    }

    {
      const ret = await t.context.copilotContext.matchWorkspaceEmbedding(
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.9),
        workspace.id,
        1,
        1,
        Prisma.sql`TRUE`
      );
      t.snapshot(
        cleanObject(ret, ['chunk', 'content', 'distance']),
        'should match workspace embedding'
      );
    }

    {
      await t.context.copilotWorkspace.updateIgnoredDocs(workspace.id, [docId]);
      const ret = await t.context.copilotContext.matchWorkspaceEmbedding(
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.9),
        workspace.id,
        1,
        1,
        Prisma.sql`TRUE`
      );
      t.snapshot(ret, 'should return empty array when doc is ignored');
    }

    {
      await t.context.copilotWorkspace.updateIgnoredDocs(
        workspace.id,
        undefined,
        [docId]
      );
      const ret = await t.context.copilotContext.matchWorkspaceEmbedding(
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.9),
        workspace.id,
        1,
        1,
        Prisma.sql`TRUE`
      );
      t.snapshot(
        cleanObject(ret, ['chunk', 'content', 'distance']),
        'should return workspace embedding'
      );
    }

    {
      await t.context.copilotContext.deleteWorkspaceEmbedding(
        workspace.id,
        docId
      );
      const ret = await t.context.copilotContext.matchWorkspaceEmbedding(
        Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.9),
        workspace.id,
        1,
        1,
        Prisma.sql`TRUE`
      );
      t.snapshot(ret, 'should return empty array when embedding deleted');
    }
  }
});

test('workspace embedding search restricts candidates before ranking', async t => {
  const scopedDocId = 'project-scoped-doc';
  const unscopedDocId = 'workspace-only-doc';
  await t.context.db.snapshot.createMany({
    data: [scopedDocId, unscopedDocId].map(id => ({
      workspaceId: workspace.id,
      id,
      blob: Buffer.from([1, 1]),
      state: Buffer.from([1, 1]),
      updatedAt: new Date(),
      createdAt: new Date(),
    })),
  });
  await Promise.all([
    t.context.copilotContext.insertWorkspaceEmbedding(
      workspace.id,
      scopedDocId,
      [
        {
          index: 0,
          content: 'scoped content',
          embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.9),
        },
      ]
    ),
    t.context.copilotContext.insertWorkspaceEmbedding(
      workspace.id,
      unscopedDocId,
      [
        {
          index: 0,
          content: 'closer but unscoped content',
          embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
        },
      ]
    ),
  ]);

  const result = await t.context.copilotContext.matchWorkspaceEmbedding(
    Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
    workspace.id,
    10,
    1,
    Prisma.sql`TRUE`,
    [scopedDocId],
    [scopedDocId]
  );
  t.deepEqual(
    result.map(chunk => chunk.docId),
    [scopedDocId]
  );
  t.deepEqual(
    await t.context.copilotContext.matchWorkspaceEmbedding(
      Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
      workspace.id,
      10,
      1,
      Prisma.sql`TRUE`,
      [],
      []
    ),
    []
  );
});

test('should reject vectors outside the 4096-dimensional contract', async t => {
  const { id: contextId } = await t.context.copilotContext.create(sessionId);
  const error = await t.throwsAsync(() =>
    t.context.copilotContext.matchFileEmbedding(
      Array.from({ length: 1024 }, () => 0.9),
      contextId,
      1,
      1
    )
  );

  t.regex(error?.message ?? '', /exactly 4096 dimensions, got 1024/);
});

test('should preserve and backfill pending embedding chunks', async t => {
  const { id: contextId } = await t.context.copilotContext.create(sessionId);
  const workspaceDocId = randomUUID();
  const workspaceFileId = randomUUID();
  const workspaceBlobId = randomUUID();
  const memoryId = randomUUID();

  await t.context.db.snapshot.create({
    data: {
      workspaceId: workspace.id,
      id: workspaceDocId,
      blob: Buffer.from([1, 1]),
      state: Buffer.from([1, 1]),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await t.context.db.aiWorkspaceFiles.create({
    data: {
      workspaceId: workspace.id,
      fileId: workspaceFileId,
      blobId: 'workspace-file-blob',
      fileName: 'workspace.txt',
      mimeType: 'text/plain',
      size: 7,
    },
  });
  await t.context.db.blob.create({
    data: {
      workspaceId: workspace.id,
      key: workspaceBlobId,
      mime: 'text/plain',
      size: 4,
    },
  });
  await t.context.db.aiContextMemory.create({
    data: {
      id: memoryId,
      ownerUserId: user.id,
      workspaceId: workspace.id,
      scope: 'workspace',
      kind: 'auto_memory',
      content: 'remember this',
      fingerprint: randomUUID(),
    },
  });

  await t.context.db.$executeRaw`
    INSERT INTO "ai_context_embeddings"
      ("id", "context_id", "file_id", "chunk", "content", "embedding", "updated_at")
    VALUES (${randomUUID()}, ${contextId}, 'context-file', 0, 'context content', NULL, NOW())
  `;
  await t.context.db.$executeRaw`
    INSERT INTO "ai_workspace_embeddings"
      ("workspace_id", "doc_id", "chunk", "content", "embedding", "updated_at")
    VALUES (${workspace.id}, ${workspaceDocId}, 0, 'document content', NULL, NOW())
  `;
  await t.context.db.$executeRaw`
    INSERT INTO "ai_workspace_file_embeddings"
      ("workspace_id", "file_id", "chunk", "content", "embedding")
    VALUES (${workspace.id}, ${workspaceFileId}, 0, 'file content', NULL)
  `;
  await t.context.db.$executeRaw`
    INSERT INTO "ai_workspace_blob_embeddings"
      ("workspace_id", "blob_id", "chunk", "content", "embedding")
    VALUES (${workspace.id}, ${workspaceBlobId}, 0, 'blob content', NULL)
  `;

  const pending =
    await t.context.copilotContext.listPendingEmbeddingBackfill(10);
  t.deepEqual(pending.map(row => row.kind).toSorted(), [
    'context_file',
    'memory',
    'workspace_blob',
    'workspace_document',
    'workspace_file',
  ]);
  t.true(
    pending.some(
      row =>
        row.kind === 'context_file' &&
        row.contextId === contextId &&
        row.userId === user.id
    )
  );

  const contextFiles = [
    {
      id: 'context-file',
      chunkSize: 1,
      name: 'context.txt',
      mimeType: 'text/plain',
      status: ContextEmbedStatus.finished,
      error: null,
      blobId: 'context-blob',
      createdAt: Date.now(),
    },
  ];
  await t.context.copilotContext.mergeFileStatus(contextId, contextFiles);
  t.is(contextFiles[0].status, ContextEmbedStatus.processing);

  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1);
  await Promise.all([
    t.context.copilotContext.insertFileEmbedding(contextId, 'context-file', [
      { index: 0, content: 'context content', embedding: vector },
    ]),
    t.context.copilotContext.insertWorkspaceEmbedding(
      workspace.id,
      workspaceDocId,
      [{ index: 0, content: 'document content', embedding: vector }]
    ),
    t.context.copilotWorkspace.insertFileEmbeddings(
      workspace.id,
      workspaceFileId,
      [{ index: 0, content: 'file content', embedding: vector }]
    ),
    t.context.copilotWorkspace.insertBlobEmbeddings(
      workspace.id,
      workspaceBlobId,
      [{ index: 0, content: 'blob content', embedding: vector }]
    ),
    t.context.copilotContextMemory.putEmbedding(memoryId, vector),
  ]);

  t.deepEqual(
    await t.context.copilotContext.listPendingEmbeddingBackfill(10),
    []
  );
  await t.context.copilotContext.mergeFileStatus(contextId, contextFiles);
  t.is(contextFiles[0].status, ContextEmbedStatus.finished);
});

test('should check embedding table', async t => {
  {
    const ret = await t.context.copilotContext.checkEmbeddingAvailable();
    t.snapshot(ret, 'should return true when embedding table is available');
  }

  // {
  //   await t.context.db
  //     .$executeRaw`DROP TABLE IF EXISTS "ai_context_embeddings"`;
  //   const ret = await t.context.copilotContext.checkEmbeddingAvailable();
  //   t.false(ret, 'should return false when embedding table is not available');
  // }
});

test('should merge doc status correctly', async t => {
  const createDoc = (id: string, status?: string) => ({
    id,
    createdAt: Date.now(),
    ...(status && { status: status as any }),
  });

  const createDocWithEmbedding = async (docId: string) => {
    await t.context.db.snapshot.create({
      data: {
        workspaceId: workspace.id,
        id: docId,
        blob: Buffer.from([1, 1]),
        state: Buffer.from([1, 1]),
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    });

    await t.context.copilotContext.insertWorkspaceEmbedding(
      workspace.id,
      docId,
      [
        {
          index: 0,
          content: 'content',
          embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
        },
      ]
    );
  };

  const emptyResult = await t.context.copilotContext.mergeDocStatus(
    workspace.id,
    []
  );
  t.deepEqual(emptyResult, []);

  const basicDocs = [
    createDoc('doc1'),
    createDoc('doc2'),
    createDoc('doc3', 'failed'),
    createDoc('doc4', 'processing'),
  ];
  const basicResult = await t.context.copilotContext.mergeDocStatus(
    workspace.id,
    basicDocs
  );
  t.snapshot(
    basicResult.map(d => ({ id: d.id, status: d.status })),
    'basic doc status merge'
  );

  {
    await createDocWithEmbedding('doc5');

    const mixedDocs = [
      createDoc('doc5'),
      createDoc('doc5', 'processing'),
      createDoc('doc6'),
      createDoc('doc6', 'failed'),
      createDoc('doc7'),
    ];
    const mixedResult = await t.context.copilotContext.mergeDocStatus(
      workspace.id,
      mixedDocs
    );
    t.snapshot(
      mixedResult.map(d => ({ id: d.id, status: d.status })),
      'mixed doc status merge'
    );

    const hasEmbeddingStub = Sinon.stub(
      t.context.copilotContext,
      'listWorkspaceDocEmbedding'
    ).resolves([]);

    const stubResult = await t.context.copilotContext.mergeDocStatus(
      workspace.id,
      [createDoc('doc5')]
    );
    t.is(stubResult[0].status, ContextEmbedStatus.processing);

    hasEmbeddingStub.restore();
  }

  {
    const testCases = [
      {
        workspaceId: 'invalid-workspace',
        docs: [{ id: 'doc1', createdAt: Date.now() }],
      },
      {
        workspaceId: workspace.id,
        docs: [{ id: 'doc1', createdAt: Date.now(), status: undefined as any }],
      },
      {
        workspaceId: workspace.id,
        docs: Array.from({ length: 100 }, (_, i) => ({
          id: `doc-${i}`,
          createdAt: Date.now() + i,
        })),
      },
    ];

    const results = await Promise.all(
      testCases.map(testCase =>
        t.context.copilotContext.mergeDocStatus(
          testCase.workspaceId,
          testCase.docs
        )
      )
    );

    t.snapshot(
      results.map((result, index) => ({
        case: index,
        length: result.length,
        statuses: result.map(d => d.status),
      })),
      'edge cases results'
    );
  }
});

test('should handle concurrent mergeDocStatus calls', async t => {
  await t.context.db.snapshot.create({
    data: {
      workspaceId: workspace.id,
      id: 'concurrent-doc',
      blob: Buffer.from([1, 1]),
      state: Buffer.from([1, 1]),
      updatedAt: new Date(),
      createdAt: new Date(),
    },
  });

  await t.context.copilotContext.insertWorkspaceEmbedding(
    workspace.id,
    'concurrent-doc',
    [
      {
        index: 0,
        content: 'content',
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
      },
    ]
  );

  const concurrentDocs = [
    [{ id: 'concurrent-doc', createdAt: Date.now() }],
    [{ id: 'concurrent-doc', createdAt: Date.now() + 1000 }],
    [{ id: 'non-existent-doc', createdAt: Date.now() }],
  ];

  const results = await Promise.all(
    concurrentDocs.map(docs =>
      t.context.copilotContext.mergeDocStatus(workspace.id, docs)
    )
  );

  t.snapshot(
    results.map((result, index) => ({
      call: index + 1,
      status: result[0].status,
    })),
    'concurrent calls results'
  );
});
