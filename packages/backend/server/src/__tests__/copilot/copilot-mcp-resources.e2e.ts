import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { McpAccessMode, PrismaClient } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';
import * as Y from 'yjs';

import { AppModule } from '../../app.module';
import { Config, CryptoHelper } from '../../base';
import { ConfigModule } from '../../base/config';
import {
  PgWorkspaceDocStorageAdapter,
  WorkspaceOrganizationService,
} from '../../core/doc';
import { WorkspaceDocOutboxPublisher } from '../../core/doc/outbox';
import { DocWriter } from '../../core/doc/writer';
import { DocRole, Models, WorkspaceRole } from '../../models';
import { BackendRuntime, createDocWithMarkdown } from '../../native';
import {
  MCP_CAPABILITIES,
  MCP_DELEGATION_CAPABILITIES,
} from '../../plugins/copilot/mcp/capabilities';
import { McpCredentialService } from '../../plugins/copilot/mcp/credential';
import { WorkspaceMcpProvider } from '../../plugins/copilot/mcp/provider';
import {
  RESOURCE_RECEIPT_SCHEMA,
  resourceOutputSchema,
  type ResourceToolName,
} from '../../plugins/copilot/mcp/resource-schema';
import { McpResourcesService } from '../../plugins/copilot/mcp/resources';
import { CapabilityRuntime } from '../../plugins/copilot/runtime/capability-runtime';
import { IndexerService } from '../../plugins/indexer';
import { createTestingApp, type TestingApp } from '../utils';
import {
  addEditorProperties,
  DAILY_LOG_MARKDOWN,
} from './fixtures/resource-markdown';

type Context = {
  app: TestingApp;
  models: Models;
  db: PrismaClient;
  service: McpResourcesService;
  credential: Awaited<ReturnType<McpCredentialService['create']>>['credential'];
  token: string;
  workspaceId: string;
  actorId: string;
};
const test = ava.serial as TestFn<Context>;

test.before(async t => {
  t.context.app = await createTestingApp({
    imports: [
      ConfigModule.override({ doc: { mcpResourcesEnabled: true } }),
      AppModule,
    ],
  });
});
test.beforeEach(async t => {
  Sinon.restore();
  const app = t.context.app;
  await app.initTestingDB();
  app.get(Config).doc.mcpResourcesEnabled = true;
  const owner = await app.signupV1();
  const models = app.get(Models);
  const workspace = await models.workspace.create(owner.id);
  const root = new Y.Doc();
  root.getMap('meta').set('pages', new Y.Array());
  await models.doc.upsert({
    spaceId: workspace.id,
    docId: workspace.id,
    blob: Buffer.from(Y.encodeStateAsUpdate(root)),
    timestamp: Date.now(),
    editorId: owner.id,
  });
  root.destroy();
  const issued = await app.get(McpCredentialService).create({
    userId: owner.id,
    workspaceId: workspace.id,
    name: 'resource test',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: [...MCP_CAPABILITIES],
    expirationDays: 30,
  });
  Object.assign(t.context, {
    models,
    db: app.get(PrismaClient),
    service: app.get(McpResourcesService),
    credential: issued.credential,
    token: issued.token,
    workspaceId: workspace.id,
    actorId: owner.id,
  });
  Sinon.stub(app.get(CapabilityRuntime), 'streamObject').throws(
    new Error('Direct tools must not call a model')
  );
});
test.after.always(async t => {
  Sinon.restore();
  await t.context.app?.close();
});

async function call(
  context: Context,
  name: ResourceToolName,
  args: Record<string, unknown>
) {
  const result = await context.service.execute(context.credential, name, args);
  resourceOutputSchema(name).parse({ result });
  return result;
}
async function create(
  context: Context,
  overrides: Record<string, unknown> = {}
) {
  return RESOURCE_RECEIPT_SCHEMA.parse(
    await call(context, 'workspace_doc_create', {
      title: '工作日志',
      content: { format: 'markdown', text: '## 完成\n\n- 内容原样保存\n' },
      idempotencyKey: randomUUID(),
      ...overrides,
    })
  );
}

test('discovery enables 13 explicit capabilities and leaves old defaults at three', async t => {
  const { app, credential } = t.context;
  const provider = app.get(WorkspaceMcpProvider);
  const server = await provider.for(
    credential.userId,
    credential.workspaceId,
    credential.capabilities,
    undefined,
    credential
  );
  t.is(server.tools.length, 13);
  const old = await provider.for(
    credential.userId,
    credential.workspaceId,
    'READ_WRITE'
  );
  t.deepEqual(
    old.tools.map(tool => tool.name),
    [...MCP_DELEGATION_CAPABILITIES]
  );
  app.get(Config).doc.mcpResourcesEnabled = false;
  const disabled = await provider.for(
    credential.userId,
    credential.workspaceId,
    credential.capabilities,
    undefined,
    credential
  );
  t.deepEqual(
    disabled.tools.map(tool => tool.name),
    [...MCP_DELEGATION_CAPABILITIES, 'workspace_operation_get']
  );
});

test('create, read, update, replay and query persist without AI lifecycle', async t => {
  const { db } = t.context;
  const result = await create(t.context, {
    idempotencyKey: 'create',
    externalId: 'log/one',
  });
  t.is(result.toolName, 'workspace_doc_create');
  if (result.toolName !== 'workspace_doc_create') return;
  const read = await call(t.context, 'workspace_doc_read', {
    documentId: result.documentId,
  });
  t.true('content' in read && read.contentWritable);
  const args = {
    documentId: result.documentId,
    expectedVersion: result.version,
    content: { format: 'markdown', text: '修订后的正文' },
    idempotencyKey: 'update',
  };
  const updated = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(t.context, 'workspace_doc_update', args)
  );
  t.true(updated.changed);
  const replay = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(t.context, 'workspace_doc_update', args)
  );
  t.is(replay.operationId, updated.operationId);
  t.true(replay.replayed);
  const query = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(t.context, 'workspace_operation_get', {
      operationId: updated.operationId,
    })
  );
  t.is(query.operationId, updated.operationId);
  const eventsBeforeQuery = await db.mcpResourceOperationEvent.count();
  const outboxBeforeQuery = await db.workspaceDocOutbox.count();
  t.context.app.get(Config).doc.mcpResourcesEnabled = false;
  const disabledQuery = await call(t.context, 'workspace_operation_get', {
    operationId: updated.operationId,
  });
  t.is('status' in disabledQuery ? disabledQuery.status : '', 'succeeded');
  t.is(await db.mcpResourceOperationEvent.count(), eventsBeforeQuery);
  t.is(await db.workspaceDocOutbox.count(), outboxBeforeQuery);
  t.context.app.get(Config).doc.mcpResourcesEnabled = true;

  const noOp = await call(t.context, 'workspace_doc_update', {
    ...args,
    expectedVersion: 'version' in updated ? updated.version : '',
    idempotencyKey: 'no-op',
  });
  t.true('changed' in noOp && !noOp.changed, JSON.stringify(noOp));
  t.is(await db.aiSession.count(), 0);
  t.is(await db.aiAgentRun.count(), 0);
  t.is(await db.aiMcpDelegationRequest.count(), 0);
  t.is(await db.mcpResourceExternalDocument.count(), 1);
});

test('editor-authored log updates preserve blocks and provenance through direct MCP', async t => {
  const { app, workspaceId, actorId, db } = t.context;
  const created = await create(t.context, {
    content: { format: 'markdown', text: DAILY_LOG_MARKDOWN },
    externalId: 'daily-log/editor-fixture',
  });
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const documentId = created.documentId;
  const storage = app.get(PgWorkspaceDocStorageAdapter);
  const original = await storage.getDoc(workspaceId, documentId);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, original!.bin);
    const vector = Y.encodeStateVector(doc);
    addEditorProperties(doc);
    await storage.pushDocUpdates(
      workspaceId,
      documentId,
      [Y.encodeStateAsUpdate(doc, vector)],
      actorId
    );
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const before = new Map(
      [...blocks].map(([id, block]) => [id, block.toJSON()])
    );
    const read = await call(t.context, 'workspace_doc_read', { documentId });
    if (!('content' in read)) return t.fail(JSON.stringify(read));
    t.true(read.contentWritable);
    const updatedMarkdown =
      read.content.text.replace('待更新事项', '更新后的事项') + '* 新增记录\n';
    const args = {
      documentId,
      expectedVersion: read.version,
      content: { format: 'markdown', text: updatedMarkdown },
      idempotencyKey: 'editor-log-update',
    };
    const start = Date.now();
    const receipt = RESOURCE_RECEIPT_SCHEMA.parse(
      await call(t.context, 'workspace_doc_update', args)
    );
    t.is(receipt.status, 'succeeded');
    t.true(receipt.changed);
    const stored = await storage.getDoc(workspaceId, documentId);
    Y.applyUpdate(doc, stored!.bin);
    for (const [id, old] of before) {
      const block = blocks.get(id)!;
      t.truthy(block, `retained block ${id}`);
      if (!old['prop:meta:createdAt']) continue;
      t.is(block.get('prop:meta:createdAt'), old['prop:meta:createdAt']);
      t.is(block.get('prop:meta:createdBy'), old['prop:meta:createdBy']);
      if (old['prop:text'] === '待更新事项') {
        t.is(block.get('prop:meta:updatedBy'), actorId);
        t.true(Number(block.get('prop:meta:updatedAt')) >= start);
      } else {
        t.is(block.get('prop:meta:updatedAt'), old['prop:meta:updatedAt']);
        t.is(block.get('prop:meta:updatedBy'), old['prop:meta:updatedBy']);
      }
    }
    const added = [...blocks].filter(([id]) => !before.has(id));
    t.is(added.length, 1);
    t.is(added[0][1].get('prop:meta:createdBy'), actorId);
    const after = await call(t.context, 'workspace_doc_read', { documentId });
    if (!('content' in after)) return t.fail(JSON.stringify(after));
    t.true(after.contentWritable);
    t.is(after.title, read.title);
    t.deepEqual(after.locations, read.locations);
    t.is(after.content.text, updatedMarkdown);
    const events = await db.workspaceDocOutbox.findMany({
      select: { id: true },
    });
    const replay = RESOURCE_RECEIPT_SCHEMA.parse(
      await call(t.context, 'workspace_doc_update', args)
    );
    t.true(replay.replayed);
    t.is(replay.operationId, receipt.operationId);
    const noOp = await call(t.context, 'workspace_doc_update', {
      ...args,
      expectedVersion: after.version,
      idempotencyKey: 'editor-log-no-op',
    });
    t.true('changed' in noOp && !noOp.changed);
    const stale = await call(t.context, 'workspace_doc_update', {
      ...args,
      idempotencyKey: 'editor-log-stale',
    });
    t.is('error' in stale ? stale.error.code : '', 'version_conflict');
    t.is(
      await db.workspaceDocOutbox.count({
        where: { id: { notIn: events.map(row => row.id) } },
      }),
      0
    );
    const unchanged = await storage.getDoc(workspaceId, documentId);
    t.deepEqual(Buffer.from(unchanged!.bin), Buffer.from(stored!.bin));
  } finally {
    doc.destroy();
  }
});

test('non-default editor state rejects MCP updates without body writes', async t => {
  const { app, workspaceId, actorId, db } = t.context;
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const storage = app.get(PgWorkspaceDocStorageAdapter);
  const original = await storage.getDoc(workspaceId, created.documentId);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, original!.bin);
    const vector = Y.encodeStateVector(doc);
    addEditorProperties(doc);
    const paragraph = [...doc.getMap<Y.Map<unknown>>('blocks').values()].find(
      b => b.get('sys:flavour') === 'affine:paragraph'
    )!;
    paragraph.set('prop:collapsed', true);
    await storage.pushDocUpdates(
      workspaceId,
      created.documentId,
      [Y.encodeStateAsUpdate(doc, vector)],
      actorId
    );
    const read = await call(t.context, 'workspace_doc_read', {
      documentId: created.documentId,
    });
    if (!('content' in read)) return t.fail(JSON.stringify(read));
    t.false(read.contentWritable);
    const before = await storage.getDoc(workspaceId, created.documentId);
    const outbox = await db.workspaceDocOutbox.findMany({
      select: { id: true },
    });
    const rejected = await call(t.context, 'workspace_doc_update', {
      documentId: created.documentId,
      expectedVersion: read.version,
      content: { format: 'markdown', text: 'replacement' },
      idempotencyKey: 'reject-collapsed',
    });
    t.is(
      'error' in rejected ? rejected.error.code : '',
      'unsupported_document_structure'
    );
    t.is('writeOutcome' in rejected ? rejected.writeOutcome : '', 'none');
    const after = await storage.getDoc(workspaceId, created.documentId);
    t.deepEqual(Buffer.from(after!.bin), Buffer.from(before!.bin));
    t.is(
      await db.workspaceDocOutbox.count({
        where: { id: { notIn: outbox.map(row => row.id) } },
      }),
      0
    );
  } finally {
    doc.destroy();
  }
});

test('atomic create and placement rolls back on a storage failure, then recovers using original key', async t => {
  const { app, db } = t.context;
  const move = Sinon.stub(
    app.get(WorkspaceOrganizationService),
    'moveResourceDocument'
  ).rejects(new Error('injected failure'));
  const args = {
    title: 'atomic',
    content: { format: 'markdown', text: 'body' },
    idempotencyKey: 'atomic',
  };
  const uncertain = await call(t.context, 'workspace_doc_create', args);
  t.true('writeOutcome' in uncertain && uncertain.writeOutcome === 'unknown');
  t.is(await db.workspaceDoc.count(), 0);
  t.is(await db.workspaceDocOutbox.count(), 0);
  move.restore();
  const recovered = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(t.context, 'workspace_doc_create', args)
  );
  t.is(
    recovered.operationId,
    'operationId' in uncertain ? (uncertain.operationId ?? '') : ''
  );
  t.is(await db.workspaceDoc.count(), 1);
});

test('same-key and externalId concurrency creates exactly one document', async t => {
  const args = {
    title: 'concurrent',
    content: { format: 'markdown', text: '' },
    externalId: 'daily/one',
    idempotencyKey: 'same',
  };
  const both = await Promise.all([
    call(t.context, 'workspace_doc_create', args),
    call(t.context, 'workspace_doc_create', args),
  ]);
  t.is(
    'operationId' in both[0] ? both[0].operationId : '',
    'operationId' in both[1] ? both[1].operationId : ''
  );
  t.is(await t.context.db.workspaceDoc.count(), 1);
  const conflict = await call(t.context, 'workspace_doc_create', {
    ...args,
    title: 'different',
  });
  t.is('error' in conflict ? conflict.error.code : '', 'idempotency_conflict');
  const external = await call(t.context, 'workspace_doc_create', {
    ...args,
    idempotencyKey: 'different',
  });
  t.is('error' in external ? external.error.code : '', 'external_id_conflict');
  t.is(await t.context.db.workspaceDoc.count(), 1);
});

test('pending sync updates invalidate read versions and compaction preserves version', async t => {
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const storage = t.context.app.get(PgWorkspaceDocStorageAdapter);
  const before = await storage.getDoc(
    t.context.workspaceId,
    created.documentId
  );
  const doc = new Y.Doc();
  Y.applyUpdate(doc, before!.bin);
  const vector = Y.encodeStateVector(doc);
  for (const block of doc.getMap<Y.Map<unknown>>('blocks').values())
    if (block.get('sys:flavour') === 'affine:page')
      (block.get('prop:title') as Y.Text).insert(0, 'WEB ');
  await storage.pushDocUpdates(
    t.context.workspaceId,
    created.documentId,
    [Y.encodeStateAsUpdate(doc, vector)],
    t.context.actorId
  );
  const conflict = await call(t.context, 'workspace_doc_update', {
    documentId: created.documentId,
    expectedVersion: created.version,
    content: { format: 'markdown', text: 'stale' },
    idempotencyKey: 'stale',
  });
  t.is('error' in conflict ? conflict.error.code : '', 'version_conflict');
  const read = await call(t.context, 'workspace_doc_read', {
    documentId: created.documentId,
  });
  t.true('title' in read && read.title.startsWith('WEB '));
  await storage.getDoc(t.context.workspaceId, created.documentId);
  const after = await call(t.context, 'workspace_doc_read', {
    documentId: created.documentId,
  });
  t.is(
    'version' in after ? after.version : '',
    'version' in read ? read.version : ''
  );
  doc.destroy();
});

test('folder version, conflict and create-in-folder are atomic', async t => {
  const listing = await call(t.context, 'workspace_folder_list', {});
  if (!('directoryVersion' in listing)) return t.fail(JSON.stringify(listing));
  const folder = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(t.context, 'workspace_folder_create', {
      title: '九月',
      expectedDirectoryVersion: listing.directoryVersion,
      idempotencyKey: 'folder',
    })
  );
  if (folder.toolName !== 'workspace_folder_create') return t.fail();
  const stale = await call(t.context, 'workspace_folder_create', {
    title: '十月',
    expectedDirectoryVersion: listing.directoryVersion,
    idempotencyKey: 'stale-folder',
  });
  t.is('error' in stale ? stale.error.code : '', 'directory_version_conflict');
  const doc = await create(t.context, { folderId: folder.folderId });
  t.true('folderId' in doc && doc.folderId === folder.folderId);
  const inFolder = await call(t.context, 'workspace_doc_list', {
    folderId: folder.folderId,
  });
  t.is('items' in inFolder ? inFolder.items.length : 0, 1);
});

test('credential rotation retains identity, revocation blocks writes and receipt lookup', async t => {
  const original = await create(t.context, { idempotencyKey: 'rotation' });
  const credentials = t.context.app.get(McpCredentialService);
  const rotated = await credentials.rotate(
    t.context.credential.id,
    t.context.actorId,
    t.context.workspaceId,
    30
  );
  t.context.credential = rotated.credential;
  const replay = await create(t.context, { idempotencyKey: 'rotation' });
  t.is(replay.operationId, original.operationId);
  await credentials.revoke(
    rotated.credential.id,
    t.context.actorId,
    t.context.workspaceId
  );
  const denied = await call(t.context, 'workspace_doc_create', {
    title: 'denied',
    content: { format: 'markdown', text: '' },
    idempotencyKey: 'denied',
  });
  t.is('error' in denied ? denied.error.code : '', 'capability_denied');
});

test('outbox delivery failure cannot change a committed receipt', async t => {
  const created = await create(t.context);
  t.true((await t.context.db.workspaceDocOutbox.count()) > 0);
  t.context.app.queue.add.rejects(new Error('offline'));
  await t.context.app.get(WorkspaceDocOutboxPublisher).publish();
  const receipt = await call(t.context, 'workspace_operation_get', {
    operationId: created.operationId,
  });
  t.is('status' in receipt ? receipt.status : '', 'succeeded');
  t.true((await t.context.db.workspaceDocOutbox.count()) > 0);
  t.context.app.queue.add.resetBehavior();
  await t.context.app.get(WorkspaceDocOutboxPublisher).publish();
  t.is(await t.context.db.workspaceDocOutbox.count(), 0);
});

async function folder(context: Context, title: string) {
  const listing = await call(context, 'workspace_folder_list', {});
  if (!('directoryVersion' in listing))
    throw new Error('Missing directory version');
  const result = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(context, 'workspace_folder_create', {
      title,
      expectedDirectoryVersion: listing.directoryVersion,
      idempotencyKey: randomUUID(),
    })
  );
  if (result.toolName !== 'workspace_folder_create')
    throw new Error('Missing folder');
  return result;
}

async function credentialWith(context: Context, capabilities: string[]) {
  const issued = await context.app.get(McpCredentialService).create({
    userId: context.actorId,
    workspaceId: context.workspaceId,
    name: 'subset',
    capabilities,
    accessMode: capabilities.some(name =>
      [
        'workspace_doc_create',
        'workspace_doc_update',
        'workspace_doc_update_meta',
        'workspace_folder_create',
        'workspace_folder_move_document',
        'delegate_to_localmind',
        'control_localmind_task',
      ].includes(name)
    )
      ? 'READ_WRITE'
      : 'READ_ONLY',
    expirationDays: 30,
  });
  return { ...context, credential: issued.credential, token: issued.token };
}

const code = (value: Awaited<ReturnType<typeof call>>) =>
  'error' in value ? value.error.code : '';

test('HTTP discovery and strict calls enforce subsets, endpoint binding and explicit actors', async t => {
  const subset = await credentialWith(t.context, [
    'workspace_doc_read',
    'workspace_operation_get',
  ]);
  const rpc = (
    workspaceId: string,
    method: string,
    params: Record<string, unknown>
  ) =>
    subset.app
      .POST(`/api/workspaces/${workspaceId}/mcp`)
      .set('Authorization', `Bearer ${subset.token}`)
      .send({ jsonrpc: '2.0', id: 1, method, params });
  const listed = await rpc(subset.workspaceId, 'tools/list', {}).expect(200);
  t.deepEqual(
    listed.body.result.tools.map((item: { name: string }) => item.name),
    ['workspace_doc_read', 'workspace_operation_get']
  );
  const denied = await rpc(subset.workspaceId, 'tools/call', {
    name: 'workspace_doc_create',
    arguments: {},
  }).expect(200);
  t.is(
    denied.body.result.structuredContent.result.error.code,
    'capability_denied'
  );
  const delegate = await rpc(subset.workspaceId, 'tools/call', {
    name: 'delegate_to_localmind',
    arguments: {},
  }).expect(200);
  t.is(delegate.body.error.code, -32602);
  const malformed = await rpc(subset.workspaceId, 'tools/call', {
    name: 'workspace_doc_read',
    arguments: [],
  }).expect(200);
  t.is(malformed.body.error.code, -32602);
  t.is(
    code(
      await call(subset, 'workspace_doc_read', {
        documentId: 'x',
        actorId: 'forged',
      })
    ),
    'invalid_input'
  );
  const wrong = await rpc(randomUUID(), 'tools/list', {});
  t.is(wrong.status, 401);
});

test('different keys racing on one external identity bind once; credential families are isolated', async t => {
  const args = {
    title: 'same title',
    content: { format: 'markdown', text: 'body' },
    externalId: 'external',
  };
  const results = await Promise.all(
    ['one', 'two'].map(idempotencyKey =>
      call(t.context, 'workspace_doc_create', { ...args, idempotencyKey })
    )
  );
  t.is(
    results.filter(
      result => 'status' in result && result.status === 'succeeded'
    ).length,
    1
  );
  t.is(
    results.filter(result => code(result) === 'external_id_conflict').length,
    1
  );
  const original = results.find(
    result => 'status' in result && result.status === 'succeeded'
  )!;
  const other = await credentialWith(t.context, [
    'workspace_doc_create',
    'workspace_doc_list',
    'workspace_operation_get',
  ]);
  t.is(
    code(
      await call(other, 'workspace_operation_get', {
        operationId: 'operationId' in original ? original.operationId : '',
      })
    ),
    'operation_not_found'
  );
  const created = await create(other, { ...args, idempotencyKey: 'other' });
  t.not(
    created.operationId,
    'operationId' in original ? original.operationId : ''
  );
  t.is(await t.context.db.workspaceDoc.count(), 2);
});

test('external identity and receipts survive trash and permanent deletion without recreating content', async t => {
  const created = await create(t.context, {
    externalId: 'deleted',
    idempotencyKey: 'original',
  });
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  await t.context.app
    .get(WorkspaceOrganizationService)
    .applyRootOperations(t.context.workspaceId, t.context.actorId, [
      { op: 'set_document_trashed', docId: created.documentId, trashed: true },
    ]);
  t.is(
    code(
      await call(t.context, 'workspace_doc_read', {
        documentId: created.documentId,
      })
    ),
    'resource_not_found'
  );
  t.is(
    code(
      await call(t.context, 'workspace_operation_get', {
        operationId: created.operationId,
      })
    ),
    'operation_not_found'
  );
  await t.context.models.doc.delete(t.context.workspaceId, created.documentId);
  const repeated = await call(t.context, 'workspace_doc_create', {
    title: 'again',
    content: { format: 'markdown', text: '' },
    externalId: 'deleted',
    idempotencyKey: 'new',
  });
  t.is(code(repeated), 'resource_not_found');
  t.truthy(
    (await t.context.db.mcpResourceExternalDocument.findFirst())?.deletedAt
  );
  t.is(
    await t.context.db.mcpResourceOperation.count({
      where: { status: 'succeeded' },
    }),
    1
  );
});

test('directory pagination binds revision and scope; hidden placements never appear at root or partially move', async t => {
  const hidden = await folder(t.context, 'hidden');
  await folder(t.context, 'visible');
  const doc = await create(t.context, { folderId: hidden.folderId });
  if (doc.toolName !== 'workspace_doc_create') return t.fail();
  const page = await call(t.context, 'workspace_folder_list', { limit: 1 });
  if (!('nextCursor' in page) || !page.nextCursor) return t.fail();
  t.is(
    code(
      await call(t.context, 'workspace_folder_list', {
        cursor: page.nextCursor,
        limit: 2,
      })
    ),
    'invalid_input'
  );
  await folder(t.context, 'new');
  t.is(
    code(
      await call(t.context, 'workspace_folder_list', {
        cursor: page.nextCursor,
        limit: 1,
      })
    ),
    'cursor_stale'
  );
  await t.context.db.workspaceDirectoryGrant.create({
    data: {
      workspaceId: t.context.workspaceId,
      directoryId: hidden.folderId,
      principalId: t.context.actorId,
      canRead: false,
      canWrite: false,
      canCreateFolder: false,
      canOrganize: false,
    },
  });
  const root = await call(t.context, 'workspace_doc_list', { folderId: null });
  t.deepEqual('items' in root ? root.items : null, []);
  const read = await call(t.context, 'workspace_doc_read', {
    documentId: doc.documentId,
  });
  t.deepEqual('locations' in read ? read.locations : null, []);
  t.is(
    code(
      await call(t.context, 'workspace_operation_get', {
        operationId: doc.operationId,
      })
    ),
    'operation_not_found'
  );
  const folders = await call(t.context, 'workspace_folder_list', {});
  if (!('directoryVersion' in folders)) return t.fail();
  t.false(JSON.stringify(folders).includes(hidden.folderId));
  const moved = await call(t.context, 'workspace_folder_move_document', {
    documentId: doc.documentId,
    folderId: null,
    expectedDirectoryVersion: folders.directoryVersion,
    idempotencyKey: 'hidden-move',
  });
  t.is(code(moved), 'permission_denied');
  const raw = await t.context.app
    .get(WorkspaceOrganizationService)
    .readFoldersForAdministration(t.context.workspaceId, t.context.actorId);
  t.true(
    raw.some(
      row => row.data === doc.documentId && row.parentId === hidden.folderId
    )
  );
});

test('concurrent title and body updates compare one shared version; no-op retains it', async t => {
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const both = await Promise.all([
    call(t.context, 'workspace_doc_update_meta', {
      documentId: created.documentId,
      title: 'new title',
      expectedVersion: created.version,
      idempotencyKey: 'title',
    }),
    call(t.context, 'workspace_doc_update', {
      documentId: created.documentId,
      content: { format: 'markdown', text: 'new body' },
      expectedVersion: created.version,
      idempotencyKey: 'body',
    }),
  ]);
  t.is(
    both.filter(result => 'status' in result && result.status === 'succeeded')
      .length,
    1
  );
  t.is(both.filter(result => code(result) === 'version_conflict').length, 1);
  const read = await call(t.context, 'workspace_doc_read', {
    documentId: created.documentId,
  });
  if (!('content' in read)) return t.fail();
  const noop = await call(t.context, 'workspace_doc_update_meta', {
    documentId: created.documentId,
    title: read.title,
    expectedVersion: read.version,
    idempotencyKey: 'title-noop',
  });
  t.true('changed' in noop && !noop.changed);
  t.is('version' in noop ? noop.version : '', read.version);
});

test('all pending updates are read, beyond the compactor batch size', async t => {
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const storage = t.context.app.get(PgWorkspaceDocStorageAdapter);
  const snapshot = await storage.getDoc(
    t.context.workspaceId,
    created.documentId
  );
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot!.bin);
  const title = [...doc.getMap<Y.Map<unknown>>('blocks').values()]
    .find(block => block.get('sys:flavour') === 'affine:page')!
    .get('prop:title') as Y.Text;
  const updates = [];
  for (let index = 0; index < 110; index++) {
    const vector = Y.encodeStateVector(doc);
    title.insert(title.length, String(index % 10));
    updates.push({
      spaceId: t.context.workspaceId,
      docId: created.documentId,
      blob: Buffer.from(Y.encodeStateAsUpdate(doc, vector)),
      timestamp: Date.now(),
      editorId: t.context.actorId,
    });
  }
  await t.context.models.doc.createUpdates(updates);
  const read = await call(t.context, 'workspace_doc_read', {
    documentId: created.documentId,
  });
  t.is('title' in read ? read.title : '', title.toString());
  t.true(
    (await t.context.db.update.count({ where: { id: created.documentId } })) >
      100
  );
  doc.destroy();
});

for (const revoke of ['credential', 'user', 'workspace'] as const) {
  test(`authority is checked again after lock wait: ${revoke}`, async t => {
    const { db, workspaceId, actorId, credential } = t.context;
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    const lock = db.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`permission:workspace:${workspaceId}`}, 0))`;
        entered.resolve();
        await released.promise;
        if (revoke === 'credential')
          await tx.mcpCredential.update({
            where: { id: credential.id },
            data: { revokedAt: new Date() },
          });
        if (revoke === 'user')
          await tx.user.update({
            where: { id: actorId },
            data: { disabled: true },
          });
        if (revoke === 'workspace')
          await tx.workspaceMember.updateMany({
            where: { workspaceId, userId: actorId },
            data: { state: 'suspended' },
          });
      },
      { timeout: 30000 }
    );
    await entered.promise;
    const original = t.context.models.mcpResourceOperation.lockAuthority.bind(
      t.context.models.mcpResourceOperation
    );
    Sinon.stub(
      t.context.models.mcpResourceOperation,
      'lockAuthority'
    ).callsFake(async args => {
      waiting.resolve();
      await original(args);
    });
    const operation = call(t.context, 'workspace_doc_create', {
      title: 'must not write',
      content: { format: 'markdown', text: '' },
      idempotencyKey: revoke,
    });
    await waiting.promise;
    released.resolve();
    await lock;
    const denied = await operation;
    t.true(
      ['capability_denied', 'permission_denied'].includes(code(denied)),
      JSON.stringify(denied)
    );
    t.is(await db.workspaceDoc.count(), 0);
    t.is(await db.workspaceDocOutbox.count(), 0);
  });
}

test('active duplicates and operation queries never start a second write', async t => {
  const organization = t.context.app.get(WorkspaceOrganizationService);
  const original = organization.moveResourceDocument.bind(organization);
  const entered = Promise.withResolvers<void>(),
    released = Promise.withResolvers<void>();
  Sinon.stub(organization, 'moveResourceDocument').callsFake(async args => {
    entered.resolve();
    await released.promise;
    return await original(args);
  });
  const args = {
    title: 'active',
    content: { format: 'markdown', text: '' },
    idempotencyKey: 'active',
  };
  const writing = call(t.context, 'workspace_doc_create', args);
  await entered.promise;
  const active = await call(t.context, 'workspace_doc_create', args);
  t.is('status' in active ? active.status : '', 'processing');
  // Queries must not wait for the writer's directory/content locks.
  const queried = await call(t.context, 'workspace_operation_get', {
    operationId: 'operationId' in active ? active.operationId : '',
  });
  t.is('status' in queried ? queried.status : '', 'processing');
  released.resolve();
  const [committed, observed] = await Promise.all([writing, queried]);
  t.true(
    'status' in observed &&
      ['processing', 'succeeded'].includes(observed.status)
  );
  t.is(await t.context.db.workspaceDoc.count(), 1);
  const replay = await call(t.context, 'workspace_doc_create', args);
  t.is(
    'operationId' in replay ? replay.operationId : '',
    'operationId' in committed ? committed.operationId : ''
  );
});

test('database constraints retain immutable identities, evidence and terminal receipts', async t => {
  const created = await create(t.context, { externalId: 'immutable' });
  const { db } = t.context;
  await t.throwsAsync(
    db.mcpResourceOperation.update({
      where: { id: created.operationId },
      data: { idempotencyKey: 'rewritten' },
    })
  );
  await t.throwsAsync(
    db.mcpResourceOperation.update({
      where: { id: created.operationId },
      data: { status: 'processing', completedAt: null },
    })
  );
  await t.throwsAsync(
    db.mcpResourceOperationEvent.updateMany({
      where: { operationId: created.operationId },
      data: { status: 'failed' },
    })
  );
  await t.throwsAsync(
    db.mcpResourceOperation.delete({ where: { id: created.operationId } })
  );
  await t.throwsAsync(
    db.mcpCredential.delete({ where: { id: t.context.credential.id } })
  );
  t.is(
    (
      await db.mcpResourceOperation.findUniqueOrThrow({
        where: { id: created.operationId },
      })
    ).status,
    'succeeded'
  );
  const evidence = JSON.stringify(
    await db.mcpResourceOperation.findMany({ include: { events: true } })
  );
  t.false(evidence.includes('内容原样保存'));
  t.false(evidence.includes(t.context.token));
  const rejected = await call(t.context, 'workspace_doc_create', {
    title: 'bad',
    content: { format: 'markdown', text: '![image](blob:bad)' },
    idempotencyKey: 'failed-binding',
  });
  if (!('operationId' in rejected) || !rejected.operationId) return t.fail();
  const failed = await db.mcpResourceOperation.findUniqueOrThrow({
    where: { id: rejected.operationId },
  });
  await t.throwsAsync(
    db.mcpResourceExternalDocument.create({
      data: {
        workspaceId: failed.workspaceId,
        credentialFamilyId: failed.credentialFamilyId,
        documentId: failed.documentId!,
        operationId: failed.id,
        externalId: 'bad-binding',
      },
    })
  );
});

test('unsupported and oversized replacements never change the stored body', async t => {
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const args = {
    documentId: created.documentId,
    expectedVersion: created.version,
  };
  t.is(
    code(
      await call(t.context, 'workspace_doc_update', {
        ...args,
        content: { format: 'markdown', text: '中'.repeat(400000) },
        idempotencyKey: 'too-large',
      })
    ),
    'content_too_large'
  );
  t.is(
    code(
      await call(t.context, 'workspace_doc_update', {
        ...args,
        content: { format: 'markdown', text: '![image](blob:secret)' },
        idempotencyKey: 'lossy',
      })
    ),
    'unsupported_document_structure'
  );
  const read = await call(t.context, 'workspace_doc_read', {
    documentId: created.documentId,
  });
  t.is('version' in read ? read.version : '', created.version);
  t.is(
    code(
      await call(t.context, 'workspace_doc_read', {
        documentId: t.context.workspaceId,
      })
    ),
    'resource_not_found'
  );
  t.is(
    code(
      await call(t.context, 'workspace_doc_read', {
        documentId: 'project-only-resource',
      })
    ),
    'resource_not_found'
  );
});

for (const mode of ['before-commit', 'after-commit']) {
  test(`process termination ${mode} recovers from the original key after restart`, async t => {
    const key = `restart-${mode}`;
    const child = fork(
      fileURLToPath(
        new URL('./fixtures/mcp-resource-process.ts', import.meta.url)
      ),
      [mode, t.context.credential.id, key],
      {
        execArgv: [
          '--import',
          fileURLToPath(
            new URL('../../../../../../tools/cli/register.js', import.meta.url)
          ),
          '--import',
          fileURLToPath(new URL('../../prelude.ts', import.meta.url)),
        ],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      }
    );
    let errors = '';
    child.stderr?.on('data', chunk => {
      errors = (errors + chunk.toString()).slice(-2000);
    });
    t.teardown(() => {
      child.kill('SIGKILL');
    });
    const observed = await Promise.race([
      once(child, 'message').then(([message]) => message as { phase: string }),
      once(child, 'exit').then(() => {
        throw new Error(`Fixture process exited: ${errors}`);
      }),
    ]);
    t.is(observed.phase, mode === 'before-commit' ? 'staged' : 'committed');
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const operation = await t.context.db.mcpResourceOperation.findFirstOrThrow({
      where: { idempotencyKey: key },
    });
    t.is(
      operation.status,
      mode === 'before-commit' ? 'processing' : 'succeeded'
    );
    const result = RESOURCE_RECEIPT_SCHEMA.parse(
      await call(t.context, 'workspace_doc_create', {
        title: 'restart',
        content: { format: 'markdown', text: 'durable body' },
        idempotencyKey: key,
      })
    );
    t.is(result.operationId, operation.id);
    t.is(await t.context.db.workspaceDoc.count(), 1);
    t.is(await t.context.db.mcpResourceOperation.count(), 1);
  });
}

test('indexed and fallback search return bounded plain text and do not expose unreadable documents', async t => {
  const { app, models, db, workspaceId } = t.context;
  const visible = await create(t.context, { title: 'needle visible' });
  const hidden = await create(t.context, { title: 'needle hidden' });
  if (
    visible.toolName !== 'workspace_doc_create' ||
    hidden.toolName !== 'workspace_doc_create'
  )
    return t.fail();
  const user = await app.signupV1();
  await models.workspaceMember.setActive(
    workspaceId,
    user.id,
    WorkspaceRole.Collaborator
  );
  await models.doc.setDefaultRole(
    workspaceId,
    visible.documentId,
    DocRole.None
  );
  await models.doc.setDefaultRole(workspaceId, hidden.documentId, DocRole.None);
  await models.docUser.set(
    workspaceId,
    visible.documentId,
    user.id,
    DocRole.Editor
  );
  const other = await credentialWith({ ...t.context, actorId: user.id }, [
    'workspace_doc_keyword_search',
    'workspace_doc_list',
    'workspace_doc_read',
    'workspace_doc_update_meta',
    'workspace_operation_get',
  ]);
  const index = Sinon.stub(
    app.get(IndexerService),
    'searchDocsByKeyword'
  ).resolves([
    {
      docId: visible.documentId,
      title: 'needle visible',
      highlight: '<b>needle</b> &amp; result',
    },
    { docId: hidden.documentId, title: 'needle hidden', highlight: 'secret' },
  ] as never);
  const indexed = await call(other, 'workspace_doc_keyword_search', {
    query: 'needle',
  });
  t.like(indexed, {
    retrievalMode: 'index',
    partial: true,
    coverage: 'indexed',
  });
  t.false(JSON.stringify(indexed).includes(hidden.documentId));
  t.false(JSON.stringify(indexed).includes('<b>'));
  index.rejects(new Error('index offline'));
  const fallback = await call(other, 'workspace_doc_keyword_search', {
    query: 'needle',
  });
  t.like(fallback, {
    retrievalMode: 'bounded_scan',
    partial: true,
    coverage: 'bounded',
    reason: 'index_unavailable',
  });
  t.false(JSON.stringify(fallback).includes(hidden.documentId));
  const read = await call(other, 'workspace_doc_read', {
    documentId: visible.documentId,
  });
  if (!('version' in read)) return t.fail(JSON.stringify(read));
  const updated = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(other, 'workspace_doc_update_meta', {
      documentId: visible.documentId,
      title: 'member edit',
      expectedVersion: read.version,
      idempotencyKey: 'member',
    })
  );
  await models.docUser.delete(workspaceId, visible.documentId, user.id);
  t.is(
    code(
      await call(other, 'workspace_operation_get', {
        operationId: updated.operationId,
      })
    ),
    'operation_not_found'
  );
  t.is(
    code(
      await call(other, 'workspace_doc_read', {
        documentId: visible.documentId,
      })
    ),
    'resource_not_found'
  );
  t.is(await db.aiAgentRun.count(), 0);
});

test('native snapshot writer cannot bypass an active resource content lock', async t => {
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const storage = t.context.app.get(PgWorkspaceDocStorageAdapter);
  const snapshot = await storage.getDoc(
    t.context.workspaceId,
    created.documentId
  );
  const native = new BackendRuntime();
  await native.start();
  t.teardown(async () => {
    await native.stop();
  });
  await t.context.db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`doc:content-write:${t.context.workspaceId}:${created.documentId}`}, 0))`;
    await t.throwsAsync(
      native.upsertDocSnapshot(
        t.context.workspaceId,
        created.documentId,
        Buffer.from(snapshot!.bin),
        snapshot!.timestamp + 1,
        t.context.actorId
      )
    );
  });
  const before = await call(t.context, 'workspace_doc_read', {
    documentId: created.documentId,
  });
  t.true(
    await native.upsertDocSnapshot(
      t.context.workspaceId,
      created.documentId,
      Buffer.from(snapshot!.bin),
      snapshot!.timestamp,
      t.context.actorId
    )
  );
  const after = await call(t.context, 'workspace_doc_read', {
    documentId: created.documentId,
  });
  t.is(
    'version' in after ? after.version : '',
    'version' in before ? before.version : ''
  );
});

async function syncPropertyUpdate(
  context: Context,
  documentId: string,
  source: 'current' | 'legacy',
  mode: string | null
) {
  const { workspaceId, actorId, app } = context;
  const storage = app.get(PgWorkspaceDocStorageAdapter);
  const docId =
    source === 'current' ? `db$${workspaceId}$docProperties` : workspaceId;
  const snapshot = await storage.getDoc(workspaceId, docId);
  const doc = new Y.Doc();
  try {
    if (snapshot) Y.applyUpdate(doc, snapshot.bin);
    const vector = Y.encodeStateVector(doc);
    if (source === 'current') {
      const row = doc.getMap(documentId);
      row.set('id', documentId);
      row.set('primaryMode', mode);
    } else {
      const properties = doc.getMap('affine:workspace-properties');
      if (!properties.has('pageProperties'))
        properties.set('pageProperties', new Y.Map());
      const pages = properties.get('pageProperties') as Y.Map<unknown>;
      pages.set(
        documentId,
        new Y.Map([
          [
            'system',
            new Y.Map([['primaryMode', new Y.Map([['value', mode]])]]),
          ],
        ])
      );
    }
    return {
      docId,
      update: Y.encodeStateAsUpdate(doc, vector),
      workspaceId,
      actorId,
    };
  } finally {
    doc.destroy();
  }
}

for (const source of ['current', 'legacy'] as const) {
  test(`primary mode from ${source} properties invalidates versions and blocks canvas replacement`, async t => {
    const created = await create(t.context);
    if (created.toolName !== 'workspace_doc_create') return t.fail();
    const { app, workspaceId, actorId } = t.context;
    const storage = app.get(PgWorkspaceDocStorageAdapter);
    const mode = await syncPropertyUpdate(
      t.context,
      created.documentId,
      source,
      'edgeless'
    );
    await storage.pushDocUpdates(
      workspaceId,
      mode.docId,
      [mode.update],
      actorId
    );
    const read = await call(t.context, 'workspace_doc_read', {
      documentId: created.documentId,
    });
    if (!('content' in read)) return t.fail(JSON.stringify(read));
    t.is(read.documentType, 'edgeless');
    t.false(read.contentWritable);
    t.not(read.version, created.version);
    const listing = await call(t.context, 'workspace_doc_list', {});
    t.true(
      'items' in listing &&
        listing.items.some(
          item => 'documentType' in item && item.documentType === 'edgeless'
        )
    );
    const args = {
      documentId: created.documentId,
      content: { format: 'markdown', text: 'must not replace' },
      idempotencyKey: randomUUID(),
    };
    t.is(
      code(
        await call(t.context, 'workspace_doc_update', {
          ...args,
          expectedVersion: created.version,
        })
      ),
      'version_conflict'
    );
    t.is(
      code(
        await call(t.context, 'workspace_doc_update', {
          ...args,
          idempotencyKey: randomUUID(),
          expectedVersion: read.version,
        })
      ),
      'unsupported_document_kind'
    );
    const unchanged = await call(t.context, 'workspace_doc_read', {
      documentId: created.documentId,
    });
    t.deepEqual(
      'content' in unchanged ? unchanged.content : null,
      read.content
    );
    const titled = await call(t.context, 'workspace_doc_update_meta', {
      documentId: created.documentId,
      title: 'Canvas title',
      expectedVersion: read.version,
      idempotencyKey: randomUUID(),
    });
    t.true('changed' in titled && titled.changed);
  });
}

test('current non-null mode overrides legacy; null and deleted rows fall back; missing mode is page', async t => {
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const { app, workspaceId, actorId } = t.context;
  const storage = app.get(PgWorkspaceDocStorageAdapter);
  const check = async (expected: 'page' | 'edgeless') => {
    const read = await call(t.context, 'workspace_doc_read', {
      documentId: created.documentId,
    });
    t.is('documentType' in read ? read.documentType : '', expected);
    t.is(
      'contentWritable' in read && read.contentWritable,
      expected === 'page'
    );
  };
  await check('page');
  for (const [source, value, expected] of [
    ['legacy', 'edgeless', 'edgeless'],
    ['current', 'page', 'page'],
    ['current', null, 'edgeless'],
    ['current', '', 'page'],
    ['current', 'edgeless', 'edgeless'],
    ['legacy', 'page', 'edgeless'],
  ] as const) {
    const mode = await syncPropertyUpdate(
      t.context,
      created.documentId,
      source,
      value
    );
    await storage.pushDocUpdates(
      workspaceId,
      mode.docId,
      [mode.update],
      actorId
    );
    await check(expected);
  }
  await app
    .get(WorkspaceOrganizationService)
    .applyDataOperations(workspaceId, actorId, actorId, 'document_properties', [
      { op: 'delete', key: created.documentId },
    ]);
  await check('page');
});

for (const source of ['current', 'legacy'] as const) {
  test(`a ${source} mode change committed while replacement waits is rejected`, async t => {
    const created = await create(t.context);
    if (created.toolName !== 'workspace_doc_create') return t.fail();
    const { models, workspaceId, actorId } = t.context;
    const mode = await syncPropertyUpdate(
      t.context,
      created.documentId,
      source,
      'edgeless'
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const changing = models.doc.createUpdates(
      [
        {
          spaceId: workspaceId,
          docId: mode.docId,
          blob: Buffer.from(mode.update),
          timestamp: Date.now(),
          editorId: actorId,
        },
      ],
      undefined,
      async () => {
        entered.resolve();
        await release.promise;
      }
    );
    await entered.promise;
    const waiting = Promise.withResolvers<void>();
    const read = models.doc.readAuthoritative.bind(models.doc);
    const stub = Sinon.stub(models.doc, 'readAuthoritative').callsFake(
      async (...args) => {
        if (args[1] === mode.docId) waiting.resolve();
        return await read(...args);
      }
    );
    try {
      const writing = call(t.context, 'workspace_doc_update', {
        documentId: created.documentId,
        expectedVersion: created.version,
        content: { format: 'markdown', text: 'stale' },
        idempotencyKey: randomUUID(),
      });
      await waiting.promise;
      release.resolve();
      await changing;
      t.is(code(await writing), 'version_conflict');
    } finally {
      release.resolve();
      await changing;
      stub.restore();
    }
  });

  test(`replacement holds ${source} mode lock until body commit`, async t => {
    const created = await create(t.context);
    if (created.toolName !== 'workspace_doc_create') return t.fail();
    const { app, db, workspaceId, actorId } = t.context;
    const storage = app.get(PgWorkspaceDocStorageAdapter);
    const mode = await syncPropertyUpdate(
      t.context,
      created.documentId,
      source,
      'edgeless'
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const writer = app.get(DocWriter);
    const update = writer.updateDoc.bind(writer);
    const stub = Sinon.stub(writer, 'updateDoc').callsFake(async (...args) => {
      entered.resolve();
      await release.promise;
      return await update(...args);
    });
    const writing = call(t.context, 'workspace_doc_update', {
      documentId: created.documentId,
      expectedVersion: created.version,
      content: { format: 'markdown', text: 'committed before canvas switch' },
      idempotencyKey: randomUUID(),
    });
    try {
      await entered.promise;
      const [probe] = await db.$queryRaw<
        Array<{ acquired: boolean }>
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${`doc:content-write:${workspaceId}:${mode.docId}`}, 0)) AS acquired`;
      t.false(probe.acquired);
      const changing = storage.pushDocUpdates(
        workspaceId,
        mode.docId,
        [mode.update],
        actorId
      );
      release.resolve();
      t.is('error' in (await writing), false);
      await changing;
      const read = await call(t.context, 'workspace_doc_read', {
        documentId: created.documentId,
      });
      t.is('documentType' in read ? read.documentType : '', 'edgeless');
      t.true(
        'content' in read &&
          read.content.text.includes('committed before canvas switch')
      );
    } finally {
      release.resolve();
      await writing;
      stub.restore();
    }
  });
}

const paginationIds = [
  '_',
  '-',
  'a',
  'A',
  'b',
  'B',
  '0',
  '9',
  'a-',
  'a_',
  'aa',
  'aA',
];
async function paginationFixture(context: Context, mixedTimes = false) {
  const { models, workspaceId, actorId } = context;
  const storage = context.app.get(PgWorkspaceDocStorageAdapter);
  const root = new Y.Doc();
  const existing = await storage.getDoc(workspaceId, workspaceId);
  if (existing) Y.applyUpdate(root, existing.bin);
  const pages = root.getMap('meta').get('pages') as Y.Array<unknown>;
  pages.delete(0, pages.length);
  const directory = new Y.Doc();
  for (const [i, id] of paginationIds.entries()) {
    pages.push([{ id, title: id }]);
    const row = directory.getMap(id);
    for (const [key, value] of Object.entries({
      id,
      type: 'folder',
      parentId: null,
      data: id,
      index: `a${i}`,
    }))
      row.set(key, value);
    await models.doc.upsertMeta(workspaceId, id, { title: id });
    await models.doc.upsert({
      spaceId: workspaceId,
      docId: id,
      blob: Buffer.from(createDocWithMarkdown(id, 'body', id)),
      timestamp: 1000 + (mixedTimes ? i % 3 : 0),
      editorId: actorId,
    });
  }
  for (const [docId, doc] of [
    [workspaceId, root],
    [`db$${workspaceId}$folders`, directory],
  ] as const) {
    // Merge with the initialized CRDT instead of replacing it with an unrelated
    // snapshot that can conflict with an in-flight root compaction.
    await storage.pushDocUpdates(
      workspaceId,
      docId,
      [Y.encodeStateAsUpdate(doc)],
      actorId
    );
    doc.destroy();
  }
}

for (const mixedTimes of [false, true]) {
  test(`resource pagination traverses code-unit IDs without gaps: mixed times=${mixedTimes}`, async t => {
    await paginationFixture(t.context, mixedTimes);
    const expectedDocs = [...paginationIds].sort(
      (a, b) =>
        (mixedTimes
          ? (paginationIds.indexOf(b) % 3) - (paginationIds.indexOf(a) % 3)
          : 0) || (a < b ? -1 : a > b ? 1 : 0)
    );
    for (const name of [
      'workspace_folder_list',
      'workspace_doc_list',
    ] as const) {
      for (const limit of [1, 5, 6, 12, 100]) {
        const found: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await call(t.context, name, {
            limit,
            ...(cursor ? { cursor } : {}),
          });
          if (!('items' in page) || !('nextCursor' in page))
            return t.fail(JSON.stringify(page));
          found.push(
            ...page.items.map(item =>
              'documentId' in item
                ? item.documentId
                : 'folderId' in item
                  ? item.folderId
                  : 'unexpected'
            )
          );
          cursor = page.nextCursor ?? undefined;
          if (found.length > paginationIds.length)
            return t.fail('pagination repeated items');
        } while (cursor);
        t.deepEqual(
          found,
          name === 'workspace_doc_list'
            ? expectedDocs
            : [...paginationIds].sort()
        );
      }
      const first = await call(t.context, name, { limit: 1 });
      if (!('nextCursor' in first) || !first.nextCursor) return t.fail();
      const crypto = t.context.app.get(CryptoHelper);
      const legacy = JSON.parse(crypto.decrypt(first.nextCursor));
      delete legacy.sortVersion;
      t.is(
        code(
          await call(t.context, name, {
            limit: 1,
            cursor: crypto.encrypt(JSON.stringify(legacy)),
          })
        ),
        'cursor_stale'
      );
      const tampered = Buffer.from(first.nextCursor, 'base64');
      tampered[tampered.length - 1] ^= 1;
      t.is(
        code(
          await call(t.context, name, {
            limit: 1,
            cursor: tampered.toString('base64'),
          })
        ),
        'invalid_input'
      );
    }
    for (const [name, filter] of [
      ['workspace_folder_list', { parentId: 'A' }],
      ['workspace_doc_list', { folderId: 'A' }],
      ['workspace_doc_list', { externalId: 'missing' }],
    ] as const) {
      const empty = await call(t.context, name, filter);
      t.deepEqual('items' in empty ? empty.items : null, []);
      t.is('nextCursor' in empty ? empty.nextCursor : 'missing', null);
    }
  });
}

test('document scan budget continues after empty pages and respects folder/external filters', async t => {
  const { app, models, workspaceId, actorId } = t.context;
  const targetFolder = await folder(t.context, 'target');
  const target = await create(t.context, {
    folderId: targetFolder.folderId,
    externalId: 'selected',
  });
  if (target.toolName !== 'workspace_doc_create') return t.fail();
  const storage = app.get(PgWorkspaceDocStorageAdapter);
  const rootSnapshot = await storage.getDoc(workspaceId, workspaceId);
  const root = new Y.Doc();
  Y.applyUpdate(root, rootSnapshot!.bin);
  const vector = Y.encodeStateVector(root);
  const pages = root.getMap('meta').get('pages') as Y.Array<unknown>;
  const time = Date.now() + 10000;
  for (let i = 0; i < 201; i++) {
    const id = `skip-${i}`;
    pages.push([{ id }]);
    await models.doc.upsertMeta(workspaceId, id, { title: id });
    await models.doc.upsert({
      spaceId: workspaceId,
      docId: id,
      blob: Buffer.from(createDocWithMarkdown(id, 'skip', id)),
      timestamp: time,
      editorId: actorId,
    });
  }
  await storage.pushDocUpdates(
    workspaceId,
    workspaceId,
    [Y.encodeStateAsUpdate(root, vector)],
    actorId
  );
  root.destroy();
  const first = await call(t.context, 'workspace_doc_list', {
    folderId: targetFolder.folderId,
    limit: 1,
  });
  if (!('items' in first) || !('nextCursor' in first)) return t.fail();
  t.deepEqual(first.items, []);
  t.truthy(first.nextCursor);
  const next = await call(t.context, 'workspace_doc_list', {
    folderId: targetFolder.folderId,
    limit: 1,
    cursor: first.nextCursor,
  });
  t.deepEqual(
    'items' in next
      ? next.items.map(item => ('documentId' in item ? item.documentId : null))
      : null,
    [target.documentId]
  );
  t.is('nextCursor' in next ? next.nextCursor : 'missing', null);
  const external = await call(t.context, 'workspace_doc_list', {
    externalId: 'selected',
    limit: 1,
  });
  t.deepEqual(
    'items' in external
      ? external.items.map(item =>
          'documentId' in item ? item.documentId : null
        )
      : null,
    [target.documentId]
  );
});

test('listing observes committed modes without inverting a body/properties writer lock', async t => {
  const created = await create(t.context);
  if (created.toolName !== 'workspace_doc_create') return t.fail();
  const { models, workspaceId, actorId } = t.context;
  const pending = new Y.Doc();
  pending.getMap('concurrency-fixture').set('pending', true);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const writing = models.doc.createUpdates(
    [
      {
        spaceId: workspaceId,
        docId: created.documentId,
        blob: Buffer.from(Y.encodeStateAsUpdate(pending)),
        timestamp: Date.now(),
        editorId: actorId,
      },
    ],
    undefined,
    async () => {
      entered.resolve();
      await release.promise;
    }
  );
  pending.destroy();
  try {
    await entered.promise;
    const list = await call(t.context, 'workspace_doc_list', {});
    t.deepEqual(
      'items' in list
        ? list.items.map(item =>
            'documentId' in item ? item.documentId : null
          )
        : null,
      [created.documentId]
    );
    t.true(
      'items' in list &&
        list.items.some(
          item => 'documentType' in item && item.documentType === 'page'
        )
    );
  } finally {
    release.resolve();
    await writing;
  }
});
