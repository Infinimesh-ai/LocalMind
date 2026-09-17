import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { McpAccessMode, PrismaClient } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';
import * as Y from 'yjs';

import { AppModule } from '../../app.module';
import { Config } from '../../base';
import { ConfigModule } from '../../base/config';
import {
  PgWorkspaceDocStorageAdapter,
  WorkspaceOrganizationService,
} from '../../core/doc';
import { WorkspaceDocOutboxPublisher } from '../../core/doc/outbox';
import { DocRole, Models, WorkspaceRole } from '../../models';
import { BackendRuntime } from '../../native';
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
