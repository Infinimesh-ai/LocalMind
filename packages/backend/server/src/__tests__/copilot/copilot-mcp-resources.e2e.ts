import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { McpAccessMode, PrismaClient } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';
import * as Y from 'yjs';
import { z } from 'zod';

import { AppModule } from '../../app.module';
import { Config, CryptoHelper } from '../../base';
import { ConfigModule } from '../../base/config';
import {
  PgWorkspaceDocStorageAdapter,
  WorkspaceOrganizationService,
  WorkspaceResourceService,
} from '../../core/doc';
import {
  decodeDocumentArchive,
  DOCUMENT_ARCHIVE_MIME,
} from '../../core/doc/document-archive';
import { WorkspaceDocOutboxPublisher } from '../../core/doc/outbox';
import { DocWriter } from '../../core/doc/writer';
import { NotificationJob } from '../../core/notification/job';
import { OfficeArtifactService } from '../../core/office/artifact-service';
import { OfficeResourceStorage } from '../../core/office/resource-storage';
import { CommentAttachmentStorage } from '../../core/storage';
import { StorageRuntimeProvider } from '../../core/storage-runtime';
import { DocumentEventsService } from '../../core/workspaces/document-events';
import { DocMode, DocRole, Models, WorkspaceRole } from '../../models';
import { BackendRuntime, createDocWithMarkdown } from '../../native';
import {
  MCP_CAPABILITIES,
  MCP_DELEGATION_CAPABILITIES,
} from '../../plugins/copilot/mcp/capabilities';
import { McpCredentialService } from '../../plugins/copilot/mcp/credential';
import {
  DOCUMENT_RECEIPT_SCHEMA,
  documentOutputSchema,
  type DocumentToolName,
} from '../../plugins/copilot/mcp/document-schema';
import { McpDocumentsService } from '../../plugins/copilot/mcp/native-documents';
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
      ConfigModule.override({
        doc: { mcpResourcesEnabled: true, mcpDocumentEditingEnabled: true },
      }),
      AppModule,
    ],
  });
});
test.beforeEach(async t => {
  Sinon.restore();
  const app = t.context.app;
  await app.initTestingDB();
  app.get(Config).doc.mcpResourcesEnabled = true;
  app.get(Config).doc.mcpDocumentEditingEnabled = true;
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

test('discovery enables explicit capabilities and leaves old defaults at three', async t => {
  const { app, credential } = t.context;
  const provider = app.get(WorkspaceMcpProvider);
  const server = await provider.for(
    credential.userId,
    credential.workspaceId,
    credential.capabilities,
    undefined,
    credential
  );
  t.deepEqual(
    server.tools.map(tool => tool.name).sort(),
    [...MCP_CAPABILITIES].sort()
  );
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

test('code blocks survive direct creation, versioned update and replay', async t => {
  const initial = 'Before\n\n```ts\nconst a = 1;\n\n```\n';
  const result = await create(t.context, {
    content: { format: 'markdown', text: initial },
    idempotencyKey: 'code-create',
  });
  if (result.toolName !== 'workspace_doc_create')
    return t.fail('wrong receipt');
  const before = await call(t.context, 'workspace_doc_read', {
    documentId: result.documentId,
  });
  if (!('content' in before)) return t.fail('missing content');
  t.true(before.contentWritable);
  t.true(before.content.text.includes('const a = 1;\n\n```'));
  const args = {
    documentId: result.documentId,
    expectedVersion: result.version,
    content: { format: 'markdown', text: `${before.content.text}\nAfter\n` },
    idempotencyKey: 'code-update',
  };
  const updated = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(t.context, 'workspace_doc_update', args)
  );
  const replay = RESOURCE_RECEIPT_SCHEMA.parse(
    await call(t.context, 'workspace_doc_update', args)
  );
  t.true(replay.replayed);
  t.is(replay.operationId, updated.operationId);
  const after = await call(t.context, 'workspace_doc_read', {
    documentId: result.documentId,
  });
  if (!('content' in after)) return t.fail('missing updated content');
  t.true(after.contentWritable);
  t.true(after.content.text.includes('const a = 1;\n\n```'));
  t.true(after.content.text.includes('After'));
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
  t.context.app.get(Config).doc.mcpDocumentEditingEnabled = true;

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
      read.content.text.replace('待更新事项', '更新后的事项') +
      '\n列表后的独立日志说明。\n\n* 新增记录\n';
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
    t.is(added.length, 2);
    for (const [, block] of added) {
      t.is(block.get('prop:meta:createdBy'), actorId);
    }
    t.true(
      added.some(
        ([, block]) =>
          block.get('sys:flavour') === 'affine:paragraph' &&
          String(block.get('prop:text')) === '列表后的独立日志说明。'
      )
    );
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

async function nativeCall(
  context: Context,
  name: DocumentToolName,
  args: unknown
) {
  const result = await context.app
    .get(McpDocumentsService)
    .execute(context.credential, name, args);
  documentOutputSchema(name).parse({ result });
  return result;
}

test('native duplication preserves metadata and comments, remaps anchors and replays one target', async t => {
  const context = t.context,
    source = await create(context),
    resource = { kind: 'blocksuite', id: source.documentId! };
  const inspection = z.object({
    version: z.string(),
    metadata: z.object({ version: z.string() }),
    items: z.array(z.object({ id: z.string(), flavour: z.string() })),
  });
  const before = inspection.parse(
    await nativeCall(context, 'workspace_doc_inspect', { resource })
  );
  const paragraph = before.items.find(
    row => row.flavour === 'affine:paragraph'
  )!;
  const comment = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_comments_apply', {
      resource,
      expectedVersion: before.version,
      expectedCommentsVersion: '0',
      idempotencyKey: randomUUID(),
      commands: [
        {
          opId: 'comment',
          type: 'comment.create',
          clientRef: 'thread',
          content: {
            version: 'localmind-blocksuite-comment/v1',
            paragraphs: [[{ insert: 'Keep source authorship' }]],
          },
          anchor: { kind: 'block', blockId: paragraph.id },
        },
      ],
    })
  );
  const current = inspection.parse(
    await nativeCall(context, 'workspace_doc_inspect', { resource })
  );
  const exportHash = z.object({ data: z.object({ fingerprint: z.string() }) });
  const original = exportHash.parse(
    await nativeCall(context, 'workspace_doc_export', {
      resource,
      expectedVersion: current.version,
      format: 'native-content',
    })
  );
  const request = {
    source: resource,
    expectedVersion: current.version,
    expectedMetadataVersion: current.metadata.version,
    expectedCommentsVersion: comment.commentsVersion,
    comments: 'copy',
    title: 'Independent copy',
    destination: { kind: 'legacy-folder', folderId: null },
    idempotencyKey: randomUUID(),
  };
  const result = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_duplicate', request)
  );
  t.not(result.resource.id, resource.id);
  t.is(result.source?.identityScope, 'document');
  const replay = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_duplicate', request)
  );
  t.true(replay.replayed);
  t.is(replay.resource.id, result.resource.id);
  const threadId = result.identities[`comment:${comment.identities.thread}`];
  const copiedThread = await context.models.comment.get(threadId);
  const sourceThread = await context.models.comment.get(
    comment.identities.thread
  );
  t.is(copiedThread?.docId, result.resource.id);
  t.is(copiedThread?.userId, sourceThread?.userId);
  t.deepEqual(copiedThread?.content, sourceThread?.content);
  t.deepEqual(copiedThread?.createdAt, sourceThread?.createdAt);
  const copied = await context.app
    .get(PgWorkspaceDocStorageAdapter)
    .getDoc(context.workspaceId, result.resource.id);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, copied!.bin);
    t.deepEqual(
      (
        doc
          .getMap<Y.Map<unknown>>('blocks')
          .get(paragraph.id)!
          .get('prop:comments') as Y.Map<unknown>
      ).toJSON(),
      { [threadId]: true }
    );
  } finally {
    doc.destroy();
  }
  t.deepEqual(
    exportHash.parse(
      await nativeCall(context, 'workspace_doc_export', {
        resource,
        expectedVersion: current.version,
        format: 'native-content',
      })
    ),
    original
  );
});

test('native Office duplication retains independently stored state bytes and the unchanged package', async t => {
  const context = t.context;
  const created = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_create_native', {
      resource: { kind: 'office' },
      title: 'Source.docx',
      destination: { kind: 'legacy-folder', folderId: null },
      idempotencyKey: randomUUID(),
      content: { format: 'docx', paragraphs: [{ text: 'Keep package' }] },
    })
  );
  const office = context.app.get(OfficeArtifactService),
    parent = await office.getRevision(
      context.workspaceId,
      context.actorId,
      created.resource.id
    );
  const state = await office.readRevisionAsset(
    context.workspaceId,
    context.actorId,
    created.resource.id,
    parent.id,
    'state'
  );
  const bytes = Buffer.from(
    JSON.stringify({
      ...JSON.parse(state.bytes.toString('utf8')),
      futureCopyEvidence: { exact: ['retain', 123] },
    })
  );
  const stateFingerprint = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const key = await context.app
    .get(OfficeResourceStorage)
    .put(context.workspaceId, context.actorId, 'test-state', bytes, {
      contentType: 'application/json',
      contentLength: bytes.length,
    });
  await context.models.officeArtifact.appendRevision({
    workspaceId: context.workspaceId,
    artifactId: created.resource.id,
    actorId: context.actorId,
    origin: 'user',
    expectedParentRevisionId: parent.id,
    idempotencyKey: randomUUID(),
    idempotencyFingerprint: stateFingerprint,
    package: {
      key: parent.packageBlobKey,
      mimeType: parent.packageMimeType,
      byteSize: parent.packageByteSize,
      fingerprint: parent.packageFingerprint,
    },
    state: { key, byteSize: bytes.length, fingerprint: stateFingerprint },
    modelVersion: parent.modelVersion!,
  });
  const current = z.object({ version: z.string() }).parse(
    await nativeCall(context, 'workspace_doc_inspect', {
      resource: created.resource,
    })
  );
  const copy = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_duplicate', {
      source: created.resource,
      title: 'Copied.docx',
      expectedVersion: current.version,
      comments: 'omit',
      destination: { kind: 'legacy-folder', folderId: null },
      idempotencyKey: randomUUID(),
    })
  );
  const copied = await office.getRevision(
    context.workspaceId,
    context.actorId,
    copy.resource.id
  );
  t.is(copied.packageFingerprint, parent.packageFingerprint);
  t.is(copied.stateFingerprint, stateFingerprint);
  t.deepEqual(
    (
      await office.readRevisionAsset(
        context.workspaceId,
        context.actorId,
        copy.resource.id,
        copied.id,
        'state'
      )
    ).bytes,
    bytes
  );
  const editable = JSON.parse(bytes.toString('utf8')) as {
    body: { id: string; text: string }[];
  };
  const envelope = {
    artifactId: copy.resource.id,
    expectedRevisionId: copied.id,
    source: 'user',
  };
  const edit = {
    resource: copy.resource,
    expectedVersion: copy.afterVersion,
    idempotencyKey: randomUUID(),
    batch: {
      ...envelope,
      version: 'localmind-office-command-batch/v1',
      batchId: randomUUID(),
      idempotencyKey: randomUUID(),
      commands: [
        {
          ...envelope,
          version: 'localmind-office-command/v1',
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
          operation: 'office.document.paragraph.text.set',
          target: { type: 'paragraph', blockId: editable.body[0].id },
          expectedText: editable.body[0].text,
          text: 'Edited through MCP',
        },
      ],
    },
  };
  const applied = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', edit)
  );
  const edited = await office.getRevision(
    context.workspaceId,
    context.actorId,
    copy.resource.id
  );
  const saved = JSON.parse(
    (
      await office.readRevisionAsset(
        context.workspaceId,
        context.actorId,
        copy.resource.id,
        edited.id,
        'state'
      )
    ).bytes.toString('utf8')
  ) as { futureCopyEvidence: unknown; body: { text: string }[] };
  t.deepEqual(saved.futureCopyEvidence, { exact: ['retain', 123] });
  t.is(saved.body[0].text, 'Edited through MCP');
  const invalid = await nativeCall(context, 'workspace_doc_apply', {
    ...edit,
    expectedVersion: applied.afterVersion,
    idempotencyKey: randomUUID(),
    batch: {
      ...edit.batch,
      expectedRevisionId: edited.id,
      commands: edit.batch.commands.map(command => ({
        ...command,
        expectedRevisionId: edited.id,
        target: { type: 'paragraph', blockId: 'missing' },
      })),
    },
  });
  t.is(
    z
      .object({
        error: z.object({ code: z.string() }),
        writeOutcome: z.literal('none'),
      })
      .parse(invalid).error.code,
    'invalid_input'
  );
  t.is(
    (
      await office.getRevision(
        context.workspaceId,
        context.actorId,
        copy.resource.id
      )
    ).id,
    edited.id
  );
});

test('native MCP preview, apply, no-op and immutable history preserve document identity', async t => {
  const context = t.context;
  const created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId };
  const inspected = z
    .object({
      version: z.string(),
      items: z.array(z.object({ id: z.string(), flavour: z.string() })),
    })
    .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }));
  const paragraph = inspected.items.find(
    block => block.flavour === 'affine:paragraph'
  );
  t.truthy(paragraph);
  const request = {
    resource,
    expectedVersion: inspected.version,
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'append',
        type: 'text.splice',
        target: { kind: 'block_text', blockId: paragraph?.id },
        offset: 0,
        deleteCount: 0,
        insert: [{ insert: '前缀' }],
      },
    ],
  };
  const before = await context.app
    .get(PgWorkspaceDocStorageAdapter)
    .getDoc(context.workspaceId, created.documentId!);
  const stalePlan = await nativeCall(context, 'workspace_doc_apply', {
    ...request,
    idempotencyKey: randomUUID(),
    planDigest: '0'.repeat(64),
  });
  t.is(
    z.object({ error: z.object({ code: z.string() }) }).parse(stalePlan).error
      .code,
    'plan_stale'
  );
  const preview = z
    .object({ status: z.literal('preview'), digest: z.string() })
    .parse(await nativeCall(context, 'workspace_doc_edit_preview', request));
  const afterPreview = await context.app
    .get(PgWorkspaceDocStorageAdapter)
    .getDoc(context.workspaceId, created.documentId!);
  t.deepEqual(afterPreview?.bin, before?.bin);
  const applied = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', request)
  );
  t.true(applied.changed);
  t.is(applied.digest, preview.digest);
  t.is(applied.beforeVersion, inspected.version);
  const replay = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', request)
  );
  t.true(replay.replayed);
  t.is(replay.operationId, applied.operationId);
  const noop = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', {
      ...request,
      expectedVersion: applied.afterVersion,
      idempotencyKey: randomUUID(),
      commands: [{ ...request.commands[0], insert: [] }],
    })
  );
  t.false(noop.changed);
  t.is(noop.beforeVersion, noop.afterVersion);
  const history = z
    .object({
      data: z.object({
        revisions: z.array(z.object({ revision: z.number() })),
      }),
    })
    .parse(
      await nativeCall(context, 'workspace_doc_history_list', { resource })
    );
  t.true(history.data.revisions.length >= 1);
  const restored = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_history_restore', {
      resource,
      expectedVersion: noop.afterVersion,
      idempotencyKey: randomUUID(),
      revision: history.data.revisions[0].revision,
    })
  );
  t.true(restored.changed);
  const after = await context.app
    .get(PgWorkspaceDocStorageAdapter)
    .getDoc(context.workspaceId, created.documentId!);
  const original = new Y.Doc(),
    final = new Y.Doc();
  try {
    Y.applyUpdate(original, before!.bin);
    Y.applyUpdate(final, after!.bin);
    const blocks = final.getMap<Y.Map<unknown>>('blocks');
    for (const [id, originalBlock] of original.getMap<Y.Map<unknown>>(
      'blocks'
    )) {
      const actual = blocks.get(id)!.toJSON(),
        expected = originalBlock.toJSON();
      if ('prop:meta:updatedAt' in actual) {
        t.is(actual['prop:meta:updatedBy'], context.actorId);
        delete actual['prop:meta:updatedAt'];
        delete actual['prop:meta:updatedBy'];
        delete expected['prop:meta:updatedAt'];
        delete expected['prop:meta:updatedBy'];
      }
      t.deepEqual(actual, expected);
    }
  } finally {
    original.destroy();
    final.destroy();
  }
});

test('native MCP rejects stale versions and rolls back every command when one fails', async t => {
  const context = t.context;
  const created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId };
  const inspected = z
    .object({
      version: z.string(),
      items: z.array(z.object({ id: z.string(), flavour: z.string() })),
    })
    .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }));
  const paragraph = inspected.items.find(
    block => block.flavour === 'affine:paragraph'
  );
  const command = {
    opId: 'first',
    type: 'text.splice',
    target: { kind: 'block_text', blockId: paragraph?.id },
    offset: 0,
    deleteCount: 0,
    insert: [{ insert: 'should rollback' }],
  };
  const before = await context.app
    .get(PgWorkspaceDocStorageAdapter)
    .getDoc(context.workspaceId, created.documentId!);
  const result = z
    .object({
      status: z.literal('failed'),
      error: z.object({
        code: z.string(),
        detail: z.object({ opId: z.string() }),
      }),
    })
    .parse(
      await nativeCall(context, 'workspace_doc_apply', {
        resource,
        expectedVersion: inspected.version,
        idempotencyKey: randomUUID(),
        commands: [
          command,
          {
            ...command,
            opId: 'second',
            target: { kind: 'block_text', blockId: 'missing-block' },
          },
        ],
      })
    );
  t.is(result.error.detail.opId, 'second');
  const after = await context.app
    .get(PgWorkspaceDocStorageAdapter)
    .getDoc(context.workspaceId, created.documentId!);
  t.deepEqual(after?.bin, before?.bin);
  const stale = await nativeCall(context, 'workspace_doc_apply', {
    resource,
    expectedVersion: 'stale',
    idempotencyKey: randomUUID(),
    commands: [command],
  });
  t.is(
    z.object({ error: z.object({ code: z.string() }) }).parse(stale).error.code,
    'version_conflict'
  );
});

test('native asset staging verifies bytes, persists replay and leaves document content unchanged', async t => {
  const context = t.context,
    created = await create(context);
  const resource = { kind: 'blocksuite', id: created.documentId };
  const inspected = z
    .object({ version: z.string() })
    .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }));
  const bytes = Buffer.from('asset fixture without business data');
  const { createHash } = await import('node:crypto');
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  const write = (upload: unknown) =>
    nativeCall(context, 'workspace_doc_asset_upload', {
      resource,
      expectedVersion: inspected.version,
      idempotencyKey: randomUUID(),
      upload,
    });
  const started = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({
      action: 'begin',
      mimeType: 'text/plain',
      totalBytes: bytes.length,
      fingerprint,
    })
  );
  t.truthy(started.upload);
  const uploadId = started.upload!.uploadId;
  const part = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({
      action: 'part',
      uploadId,
      number: 0,
      base64: bytes.toString('base64'),
    })
  );
  t.is(part.upload?.receivedBytes, bytes.length);
  const duplicate = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({
      action: 'part',
      uploadId,
      number: 0,
      base64: bytes.toString('base64'),
    })
  );
  t.false(duplicate.changed);
  const committed = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({ action: 'commit', uploadId })
  );
  t.is(committed.upload?.status, 'completed');
  t.is(committed.beforeVersion, committed.afterVersion);
  t.is(await context.db.mcpDocumentUploadPart.count(), 0);
  const read = z
    .object({ data: z.object({ fingerprint: z.string(), base64: z.string() }) })
    .parse(
      await nativeCall(context, 'workspace_doc_asset_read', {
        resource,
        expectedVersion: inspected.version,
        blobId: committed.upload!.blobId,
      })
    );
  t.is(read.data.fingerprint, fingerprint);
  t.deepEqual(Buffer.from(read.data.base64, 'base64'), bytes);
  const repeated = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({ action: 'commit', uploadId })
  );
  t.false(repeated.changed);
  t.is(repeated.upload?.blobId, committed.upload?.blobId);
});

test('native upload rejects another credential family and bad hashes without publishing a Blob', async t => {
  const context = t.context,
    created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId };
  const version = z
    .object({ version: z.string() })
    .parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    ).version;
  const started = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_asset_upload', {
      resource,
      expectedVersion: version,
      idempotencyKey: randomUUID(),
      upload: {
        action: 'begin',
        mimeType: 'text/plain',
        totalBytes: 3,
        fingerprint: '0'.repeat(64),
      },
    })
  );
  const uploadId = started.upload!.uploadId;
  const other = await context.app.get(McpCredentialService).create({
    userId: context.actorId,
    workspaceId: context.workspaceId,
    name: 'other family',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: ['workspace_doc_asset_upload'],
    expirationDays: 30,
  });
  const part = {
    resource,
    expectedVersion: version,
    idempotencyKey: randomUUID(),
    upload: {
      action: 'part',
      uploadId,
      number: 0,
      base64: Buffer.from('abc').toString('base64'),
    },
  };
  const denied = await context.app
    .get(McpDocumentsService)
    .execute(other.credential, 'workspace_doc_asset_upload', part);
  t.is(
    z.object({ status: z.literal('failed') }).parse(denied).status,
    'failed'
  );
  DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_asset_upload', part)
  );
  const blobs = await context.db.blob.count();
  const failed = await nativeCall(context, 'workspace_doc_asset_upload', {
    resource,
    expectedVersion: version,
    idempotencyKey: randomUUID(),
    upload: { action: 'commit', uploadId },
  });
  t.is(
    z.object({ error: z.object({ code: z.string() }) }).parse(failed).error
      .code,
    'invalid_input'
  );
  t.is(await context.db.blob.count(), blobs);
  t.is(
    (
      await context.db.mcpDocumentUpload.findUniqueOrThrow({
        where: { id: uploadId },
      })
    ).status,
    'pending'
  );
  DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_asset_upload', {
      resource,
      expectedVersion: version,
      idempotencyKey: randomUUID(),
      upload: { action: 'abort', uploadId },
    })
  );
  t.is(await context.db.mcpDocumentUploadPart.count(), 0);
});

test('native create reserves identities and atomically creates BlockSuite, Office and file resources', async t => {
  const context = t.context;
  const pageRequest = {
    resource: { kind: 'blocksuite' },
    title: 'Native fixture',
    destination: { kind: 'legacy-folder', folderId: null },
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'paragraph',
        type: 'block.create',
        clientRef: 'content',
        parentId: '$note',
        flavour: 'affine:paragraph',
        text: [{ insert: 'Original native text', attributes: { bold: true } }],
      },
    ],
  };
  const page = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_create_native', pageRequest)
  );
  const replay = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_create_native', pageRequest)
  );
  t.is(replay.resource.id, page.resource.id);
  t.true(replay.replayed);
  const inspected = z
    .object({
      items: z.array(
        z.object({ id: z.string(), properties: z.record(z.unknown()) })
      ),
    })
    .parse(
      await nativeCall(context, 'workspace_doc_inspect', {
        resource: page.resource,
      })
    );
  t.deepEqual(
    inspected.items.find(item => item.id === page.identities.content)
      ?.properties.text,
    { delta: [{ insert: 'Original native text', attributes: { bold: true } }] }
  );
  for (const [kind, content] of [
    ['file', { format: 'txt', text: '\uFEFFtext\r\n' }],
    ['office', { format: 'docx', paragraphs: [{ text: 'Native office' }] }],
    [
      'office',
      { format: 'xlsx', sheets: [{ name: 'Data', rows: [[1, 'keep']] }] },
    ],
  ] as const) {
    const request = {
      resource: { kind },
      title: `Created-${content.format}`,
      destination: { kind: 'legacy-folder', folderId: null },
      idempotencyKey: randomUUID(),
      content,
    };
    const result = DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_create_native', request)
    );
    t.is(result.resource.kind, kind);
    t.is(
      DOCUMENT_RECEIPT_SCHEMA.parse(
        await nativeCall(context, 'workspace_doc_create_native', request)
      ).resource.id,
      result.resource.id
    );
    const read = z
      .object({ resource: z.object({ id: z.string() }), version: z.string() })
      .parse(
        await nativeCall(context, 'workspace_doc_inspect', {
          resource: result.resource,
        })
      );
    t.is(read.resource.id, result.resource.id);
    t.is(read.version, result.afterVersion);
  }
});

test('native create failure leaves no partial resource and its failure receipt remains readable', async t => {
  const context = t.context;
  const request = {
    resource: { kind: 'blocksuite' },
    title: 'Rejected creation',
    destination: { kind: 'legacy-folder', folderId: null },
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'paragraph',
        type: 'block.create',
        clientRef: 'content',
        parentId: '$note',
        flavour: 'affine:paragraph',
      },
      {
        opId: 'bad',
        type: 'block.delete',
        blockId: 'missing',
        includeDescendants: false,
      },
    ],
  };
  const before = await context.db.snapshot.count();
  const failed = z
    .object({ status: z.literal('failed'), operationId: z.string() })
    .parse(await nativeCall(context, 'workspace_doc_create_native', request));
  t.is(await context.db.snapshot.count(), before);
  const replay = z
    .object({
      status: z.literal('failed'),
      operationId: z.string(),
      replayed: z.literal(true),
    })
    .parse(await nativeCall(context, 'workspace_doc_create_native', request));
  t.is(replay.operationId, failed.operationId);
});

test('native lifecycle uses explicit state versions and preserves a deletion receipt', async t => {
  const context = t.context;
  for (const resource of [
    { kind: 'blocksuite', id: (await create(context)).documentId },
    DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_create_native', {
        resource: { kind: 'file' },
        title: 'lifecycle.txt',
        content: { format: 'txt', text: 'retain until explicit delete' },
        destination: { kind: 'legacy-folder', folderId: null },
        idempotencyKey: randomUUID(),
      })
    ).resource,
  ]) {
    for (const action of ['trash', 'restore', 'trash', 'delete'] as const) {
      const state = z.object({ version: z.string() }).parse(
        await nativeCall(context, 'workspace_doc_inspect', {
          resource,
          view: 'lifecycle',
          lifecycleAction: action,
        })
      );
      const request = {
        resource,
        action,
        expectedVersion: state.version,
        idempotencyKey: randomUUID(),
      };
      const changed = DOCUMENT_RECEIPT_SCHEMA.parse(
        await nativeCall(context, 'workspace_doc_lifecycle', request)
      );
      t.is(
        changed.lifecycle,
        action === 'delete'
          ? 'deleted'
          : action === 'trash'
            ? 'trashed'
            : 'active'
      );
      const repeated = DOCUMENT_RECEIPT_SCHEMA.parse(
        await nativeCall(context, 'workspace_doc_lifecycle', request)
      );
      t.true(repeated.replayed);
      t.is(repeated.operationId, changed.operationId);
      if (action === 'delete') {
        const queried = DOCUMENT_RECEIPT_SCHEMA.parse(
          await call(context, 'workspace_operation_get', {
            operationId: changed.operationId,
          })
        );
        t.is(queried.lifecycle, 'deleted');
      }
    }
  }
});

test('native comments preserve anchors, detect UI replies, and roll back notifications with the batch', async t => {
  const context = t.context,
    created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId };
  const inspected = z
    .object({
      version: z.string(),
      items: z.array(z.object({ id: z.string(), flavour: z.string() })),
    })
    .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }));
  const paragraph = inspected.items.find(
    item => item.flavour === 'affine:paragraph'
  )!;
  const read = async (version: string) =>
    z
      .object({
        data: z.object({
          commentsVersion: z.string(),
          items: z.array(z.object({ id: z.string(), resolved: z.boolean() })),
        }),
      })
      .parse(
        await nativeCall(context, 'workspace_doc_comments_read', {
          resource,
          expectedVersion: version,
        })
      );
  const empty = await read(inspected.version);
  const content = {
    version: 'localmind-blocksuite-comment/v1',
    paragraphs: [[{ insert: 'Review this text', attributes: { bold: true } }]],
  };
  const request = {
    resource,
    expectedVersion: inspected.version,
    expectedCommentsVersion: empty.data.commentsVersion,
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'thread',
        type: 'comment.create',
        clientRef: 'thread',
        content,
        anchor: {
          kind: 'text',
          target: { kind: 'block_text', blockId: paragraph.id },
          offset: 0,
          length: 1,
        },
      },
      {
        opId: 'reply',
        type: 'reply.create',
        clientRef: 'reply',
        commentId: '$thread',
        content,
      },
    ],
  };
  const applied = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_comments_apply', request)
  );
  t.not(applied.beforeVersion, applied.afterVersion);
  t.not(applied.commentsVersion, empty.data.commentsVersion);
  const id = applied.identities.thread;
  const snapshot = await context.app
    .get(PgWorkspaceDocStorageAdapter)
    .getDoc(context.workspaceId, created.documentId!);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot!.bin);
  const text = doc
    .getMap<Y.Map<unknown>>('blocks')
    .get(paragraph.id)!
    .get('prop:text') as Y.Text;
  t.true(text.toDelta()[0].attributes?.[`comment-${id}`]);
  doc.destroy();
  const events = await context.db.documentEventOutbox.count();
  t.is(events, 3);
  const replay = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_comments_apply', request)
  );
  t.true(replay.replayed);
  t.is(await context.db.comment.count(), 1);
  t.is(await context.db.reply.count(), 1);
  const failure = await nativeCall(context, 'workspace_doc_comments_apply', {
    ...request,
    expectedVersion: applied.afterVersion,
    expectedCommentsVersion: applied.commentsVersion,
    idempotencyKey: randomUUID(),
    commands: [
      request.commands[0],
      { opId: 'bad', type: 'comment.delete', commentId: 'missing' },
    ],
  });
  t.is(
    z.object({ status: z.literal('failed') }).parse(failure).status,
    'failed'
  );
  t.is(await context.db.comment.count(), 1);
  t.is(await context.db.documentEventOutbox.count(), events);
  await context.models.comment.createReply({
    commentId: id,
    userId: context.actorId,
    content: { text: 'UI reply' },
  });
  const stale = await nativeCall(context, 'workspace_doc_comments_apply', {
    resource,
    expectedVersion: applied.afterVersion,
    expectedCommentsVersion: applied.commentsVersion,
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'resolve',
        type: 'comment.resolve',
        commentId: id,
        resolved: true,
      },
    ],
  });
  t.is(
    z.object({ error: z.object({ code: z.string() }) }).parse(stale).error.code,
    'version_conflict'
  );
  const current = await read(applied.afterVersion);
  const resolved = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_comments_apply', {
      resource,
      expectedVersion: applied.afterVersion,
      expectedCommentsVersion: current.data.commentsVersion,
      idempotencyKey: randomUUID(),
      commands: [
        {
          opId: 'resolve',
          type: 'comment.resolve',
          commentId: id,
          resolved: true,
        },
      ],
    })
  );
  t.true((await read(resolved.afterVersion)).data.items[0].resolved);
  const noop = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_comments_apply', {
      resource,
      expectedVersion: resolved.afterVersion,
      expectedCommentsVersion: resolved.commentsVersion,
      idempotencyKey: randomUUID(),
      commands: [
        {
          opId: 'resolve',
          type: 'comment.resolve',
          commentId: id,
          resolved: true,
        },
      ],
    })
  );
  t.false(noop.changed);
  t.is(noop.commentsVersion, resolved.commentsVersion);
});

test('native access shares UI policy and never infers member management from content editing', async t => {
  const context = t.context,
    created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId };
  const version = z
    .object({ version: z.string() })
    .parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    ).version;
  const read = async () =>
    z.object({ data: z.object({ accessVersion: z.string() }) }).parse(
      await nativeCall(context, 'workspace_doc_access_read', {
        resource,
        expectedVersion: version,
      })
    );
  const before = await read(),
    member = await context.app.signupV1();
  const request = {
    resource,
    expectedVersion: version,
    expectedAccessVersion: before.data.accessVersion,
    idempotencyKey: randomUUID(),
    command: { type: 'member.set', userIds: [member.id], role: 'editor' },
  };
  const applied = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_access_update', request)
  );
  t.is(applied.beforeVersion, applied.afterVersion);
  t.not(applied.accessVersion, before.data.accessVersion);
  t.is(
    (
      await context.models.docUser.get(
        context.workspaceId,
        resource.id!,
        member.id
      )
    )?.type,
    DocRole.Editor
  );
  t.true(
    DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_access_update', request)
    ).replayed
  );
  const noop = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_access_update', {
      ...request,
      expectedAccessVersion: applied.accessVersion,
      idempotencyKey: randomUUID(),
    })
  );
  t.false(noop.changed);
  const contentOnly = await context.app.get(McpCredentialService).create({
    userId: context.actorId,
    workspaceId: context.workspaceId,
    name: 'content-only',
    accessMode: McpAccessMode.READ_WRITE,
    capabilities: ['workspace_doc_apply'],
    expirationDays: 30,
  });
  const denied = await context.app
    .get(McpDocumentsService)
    .execute(contentOnly.credential, 'workspace_doc_access_update', {
      ...request,
      expectedAccessVersion: applied.accessVersion,
      idempotencyKey: randomUUID(),
    });
  t.is(
    z.object({ error: z.object({ code: z.string() }) }).parse(denied).error
      .code,
    'capability_denied'
  );
  const transferred = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_access_update', {
      ...request,
      expectedAccessVersion: applied.accessVersion,
      idempotencyKey: randomUUID(),
      command: { type: 'owner.transfer', userId: member.id },
    })
  );
  t.is(
    (await context.models.docUser.getOwner(context.workspaceId, resource.id!))
      ?.userId,
    member.id
  );
  t.truthy(transferred.accessVersion);
  const ownerRemoval = await nativeCall(
    context,
    'workspace_doc_access_update',
    {
      ...request,
      expectedAccessVersion: transferred.accessVersion,
      idempotencyKey: randomUUID(),
      command: { type: 'member.remove', userId: member.id },
    }
  );
  t.is(
    z.object({ status: z.literal('failed') }).parse(ownerRemoval).status,
    'failed'
  );
});

const bundleChunk = z.object({
  data: z.object({
    bundleVersion: z.string(),
    proof: z.string(),
    nextOffset: z.number().nullable(),
    base64: z.string(),
  }),
});
async function exportTestBundle(
  context: Context,
  resource: { kind: 'blocksuite' | 'office' | 'file'; id: string },
  version: string
) {
  const first = bundleChunk.parse(
    await nativeCall(context, 'workspace_doc_export', {
      resource,
      expectedVersion: version,
      format: 'native-bundle',
      limit: 512,
    })
  );
  const chunks = [Buffer.from(first.data.base64, 'base64')];
  let offset = first.data.nextOffset;
  while (offset !== null) {
    const next = bundleChunk.parse(
      await nativeCall(context, 'workspace_doc_export', {
        resource,
        expectedVersion: version,
        format: 'native-bundle',
        limit: 512,
        offset,
        expectedBundleVersion: first.data.bundleVersion,
      })
    );
    chunks.push(Buffer.from(next.data.base64, 'base64'));
    offset = next.data.nextOffset;
  }
  return {
    bytes: Buffer.concat(chunks),
    proof: first.data.proof,
    version: first.data.bundleVersion,
  };
}

test('native bundle preserves opaque roots, attachments and comment evidence with version-bound chunks', async t => {
  const context = t.context;
  const created = await create(context);
  const resource = { kind: 'blocksuite' as const, id: created.documentId! };
  const pending = new Y.Doc();
  pending.getMap('future-extension').set('opaque', { retain: ['all', 17] });
  await context.models.doc.createUpdates([
    {
      spaceId: context.workspaceId,
      docId: resource.id,
      blob: Buffer.from(Y.encodeStateAsUpdate(pending)),
      timestamp: Date.now(),
      editorId: context.actorId,
    },
  ]);
  pending.destroy();
  const comment = await context.models.comment.create({
    workspaceId: context.workspaceId,
    docId: resource.id,
    userId: context.actorId,
    content: { text: 'source comment' },
  });
  const attachmentBytes = Buffer.from('retained comment attachment');
  const attachments = context.app.get(CommentAttachmentStorage),
    attachmentId = randomUUID();
  await attachments.put(
    context.workspaceId,
    resource.id,
    attachmentId,
    'evidence.txt',
    attachmentBytes,
    context.actorId
  );
  await context.models.comment.update({
    id: comment.id,
    content: {
      text: 'source comment',
      attachments: [
        {
          url: attachments.getUrl(
            context.workspaceId,
            resource.id,
            attachmentId
          ),
          opaque: 'retain',
        },
      ],
    },
  });
  const inspection = z
    .object({ version: z.string() })
    .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }));
  const bundle = await exportTestBundle(context, resource, inspection.version);
  t.is(createHash('sha256').update(bundle.bytes).digest('hex'), bundle.version);
  const archive = decodeDocumentArchive(bundle.bytes);
  t.is(archive.comments?.comments[0].id, comment.id);
  t.is(archive.commentAssets[0].base64, attachmentBytes.toString('base64'));
  const blobId = await context.app
    .get(OfficeResourceStorage)
    .putGenerated(
      context.workspaceId,
      context.actorId,
      bundle.bytes,
      DOCUMENT_ARCHIVE_MIME,
      async () => {}
    );
  const request = {
    resource: { kind: 'blocksuite' },
    format: 'native-bundle',
    blobId,
    proof: bundle.proof,
    title: 'Restored archive',
    destination: { kind: 'legacy-folder', folderId: null },
    idempotencyKey: randomUUID(),
  };
  const restored = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_import', request)
  );
  t.is(restored.archive?.fingerprint, bundle.version);
  t.true(
    DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_import', request)
    ).replayed
  );
  const body = z.object({ data: z.object({ base64: z.string() }) }).parse(
    await nativeCall(context, 'workspace_doc_export', {
      resource: restored.resource,
      expectedVersion: restored.afterVersion,
      format: 'native-content',
    })
  );
  const document = new Y.Doc();
  Y.applyUpdate(document, Buffer.from(body.data.base64, 'base64'));
  t.deepEqual(document.getMap('future-extension').get('opaque'), {
    retain: ['all', 17],
  });
  document.destroy();
  const copied = await context.models.comment.get(
    restored.identities[`comment:${comment.id}`]
  );
  t.is(copied?.userId, comment.userId);
  t.deepEqual(copied?.createdAt, comment.createdAt);
  t.true(
    JSON.stringify(copied?.content).includes(
      `/docs/${restored.resource.id}/comment-attachments/`
    )
  );
  const savedAttachment = await attachments.get(
    context.workspaceId,
    restored.resource.id,
    attachmentId
  );
  const parts: Buffer[] = [];
  for await (const part of savedAttachment.body!) parts.push(Buffer.from(part));
  t.deepEqual(Buffer.concat(parts), attachmentBytes);
  const currentCount = await context.db.comment.count();
  const invalid = await nativeCall(context, 'workspace_doc_import', {
    ...request,
    proof: bundle.proof.replace('document-archive:', 'wrong-context:'),
    idempotencyKey: randomUUID(),
  });
  t.is(
    z.object({ error: z.object({ code: z.string() }) }).parse(invalid).error
      .code,
    'invalid_input'
  );
  t.is(await context.db.comment.count(), currentCount);
  await context.models.comment.resolve({ id: comment.id, resolved: true });
  const stale = await nativeCall(context, 'workspace_doc_export', {
    resource,
    expectedVersion: inspection.version,
    format: 'native-bundle',
    offset: 512,
    expectedBundleVersion: bundle.version,
  });
  t.is(
    z.object({ error: z.object({ code: z.string() }) }).parse(stale).error.code,
    'cursor_stale'
  );
});

for (const kind of ['office', 'file'] as const)
  test(`native ${kind} bundle restores exact package/file and independent state fingerprints`, async t => {
    const context = t.context;
    const created = DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_create_native', {
        resource: { kind },
        title: kind === 'office' ? 'Archive.docx' : 'Archive.txt',
        destination: { kind: 'legacy-folder', folderId: null },
        idempotencyKey: randomUUID(),
        content:
          kind === 'office'
            ? {
                format: 'docx',
                paragraphs: [{ text: 'Preserve native package' }],
              }
            : { format: 'txt', text: 'Line 1\r\n\r\nLine 3\r\n' },
      })
    );
    const bundle = await exportTestBundle(
      context,
      created.resource,
      created.afterVersion
    );
    const source = decodeDocumentArchive(bundle.bytes);
    const blobId = await context.app
      .get(OfficeResourceStorage)
      .putGenerated(
        context.workspaceId,
        context.actorId,
        bundle.bytes,
        DOCUMENT_ARCHIVE_MIME,
        async () => {}
      );
    const restored = DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_import', {
        resource: { kind },
        title: kind === 'office' ? 'Restored.docx' : 'Restored.txt',
        format: 'native-bundle',
        blobId,
        proof: bundle.proof,
        destination: { kind: 'legacy-folder', folderId: null },
        idempotencyKey: randomUUID(),
      })
    );
    const after = decodeDocumentArchive(
      (
        await exportTestBundle(
          context,
          restored.resource,
          restored.afterVersion
        )
      ).bytes
    );
    t.deepEqual(after.content, source.content);
    t.deepEqual(after.officeState, source.officeState);
  });

test('atomic native edit previews without writes and commits body, title and anchored threads together', async t => {
  const context = t.context,
    created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId! };
  const shape = z.object({
    version: z.string(),
    title: z.string(),
    metadata: z.object({ version: z.string() }),
    items: z.array(z.object({ id: z.string(), flavour: z.string() })),
  });
  const before = shape.parse(
    await nativeCall(context, 'workspace_doc_inspect', { resource })
  );
  const note = before.items.find(item => item.flavour === 'affine:note')!;
  const request = {
    resource,
    expectedVersion: before.version,
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'body',
        type: 'block.create',
        parentId: note.id,
        clientRef: 'new-paragraph',
        flavour: 'affine:paragraph',
        text: [{ insert: 'Atomic paragraph' }],
      },
    ],
    metadata: {
      expectedMetadataVersion: before.metadata.version,
      properties: { title: 'Atomic title' },
    },
    comments: {
      expectedCommentsVersion: '0',
      commands: [
        {
          opId: 'thread',
          type: 'comment.create',
          clientRef: 'thread',
          content: {
            version: 'localmind-blocksuite-comment/v1',
            paragraphs: [[{ insert: 'Atomic comment' }]],
          },
          anchor: {
            kind: 'text',
            target: {
              kind: 'block_text',
              blockId: '$new-paragraph',
              field: 'text',
            },
            offset: 0,
            length: 6,
          },
        },
        {
          opId: 'reply',
          type: 'reply.create',
          commentId: '$thread',
          clientRef: 'reply',
          content: {
            version: 'localmind-blocksuite-comment/v1',
            paragraphs: [[{ insert: 'Atomic reply' }]],
          },
        },
      ],
    },
  };
  const counts = async () => [
    await context.db.comment.count(),
    await context.db.reply.count(),
    await context.db.documentEventOutbox.count(),
  ];
  const previousCounts = await counts();
  const preview = z
    .object({
      status: z.literal('preview'),
      digest: z.string(),
      identities: z.record(z.string()),
    })
    .parse(await nativeCall(context, 'workspace_doc_edit_preview', request));
  t.deepEqual(await counts(), previousCounts);
  t.deepEqual(
    shape.parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    ),
    before
  );
  const applied = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', {
      ...request,
      planDigest: preview.digest,
    })
  );
  t.true(applied.changed);
  t.deepEqual(applied.identities, preview.identities);
  const after = shape.parse(
    await nativeCall(context, 'workspace_doc_inspect', { resource })
  );
  t.is(after.title, 'Atomic title');
  t.not(after.version, before.version);
  t.is(after.items.length, before.items.length + 1);
  const comments = z
    .object({
      data: z.object({
        items: z.array(z.object({ id: z.string(), anchorState: z.string() })),
      }),
    })
    .parse(
      await nativeCall(context, 'workspace_doc_comments_read', {
        resource,
        expectedVersion: after.version,
      })
    );
  t.deepEqual(comments.data.items, [
    { id: applied.identities['comment:thread'], anchorState: 'attached' },
  ]);
  const replay = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', {
      ...request,
      planDigest: preview.digest,
    })
  );
  t.true(replay.replayed);
  t.is(await context.db.comment.count(), 1);
  t.is(await context.db.reply.count(), 1);
});

test('atomic edit refuses a companion capability or invalid anchor before changing body or title', async t => {
  const context = t.context,
    created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId! };
  const shape = z.object({
    version: z.string(),
    title: z.string(),
    metadata: z.object({ version: z.string() }),
    items: z.array(z.object({ id: z.string(), flavour: z.string() })),
  });
  const before = shape.parse(
    await nativeCall(context, 'workspace_doc_inspect', { resource })
  );
  const paragraph = before.items.find(
    item => item.flavour === 'affine:paragraph'
  )!;
  const request = {
    resource,
    expectedVersion: before.version,
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'body',
        type: 'text.splice',
        target: { kind: 'block_text', blockId: paragraph.id, field: 'text' },
        offset: 0,
        deleteCount: 0,
        insert: [{ insert: 'Must roll back' }],
      },
    ],
    metadata: {
      expectedMetadataVersion: before.metadata.version,
      properties: { title: 'Must roll back' },
    },
    comments: {
      expectedCommentsVersion: '0',
      commands: [
        {
          opId: 'thread',
          type: 'comment.create',
          clientRef: 'thread',
          content: {
            version: 'localmind-blocksuite-comment/v1',
            paragraphs: [[{ insert: 'Invalid anchor' }]],
          },
          anchor: { kind: 'block', blockId: 'missing-block' },
        },
      ],
    },
  };
  for (const tool of [
    'workspace_doc_edit_preview',
    'workspace_doc_apply',
  ] as const) {
    const result = await nativeCall(context, tool, request);
    t.is('error' in result ? result.error.code : null, 'invalid_input');
    t.deepEqual(
      shape.parse(
        await nativeCall(context, 'workspace_doc_inspect', { resource })
      ),
      before
    );
    t.is(await context.db.comment.count(), 0);
  }
  const limited = await context.app.get(McpCredentialService).create({
    userId: context.actorId,
    workspaceId: context.workspaceId,
    name: 'Body only',
    accessMode: 'READ_WRITE',
    capabilities: [
      'workspace_doc_apply',
      'workspace_doc_edit_preview',
      'workspace_doc_properties_update',
    ],
    expirationDays: 30,
  });
  const result = await context.app
    .get(McpDocumentsService)
    .execute(limited.credential, 'workspace_doc_apply', {
      ...request,
      idempotencyKey: randomUUID(),
    });
  t.is('error' in result ? result.error.code : null, 'capability_denied');
  t.deepEqual(
    shape.parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    ),
    before
  );
});

test('physical object journal survives document rollback and collects only unreferenced objects', async t => {
  const context = t.context,
    storage = context.app.get(OfficeResourceStorage);
  let orphan = '';
  await t.throwsAsync(
    context.app
      .get(WorkspaceResourceService)
      .snapshot(
        { workspaceId: context.workspaceId, actorId: context.actorId },
        async () => {
          orphan = await storage.putGenerated(
            context.workspaceId,
            context.actorId,
            Buffer.from('orphan fixture'),
            'text/plain',
            async () => {}
          );
          throw new Error('fixture rollback');
        }
      ),
    { message: 'fixture rollback' }
  );
  t.is(await context.models.blob.get(context.workspaceId, orphan), null);
  t.is(await context.db.documentObjectStage.count(), 1);
  const published = await storage.putGenerated(
    context.workspaceId,
    context.actorId,
    Buffer.from('published fixture'),
    'text/plain',
    async () => {}
  );
  await context.db.documentObjectStage.updateMany({
    data: { expiresAt: new Date(0) },
  });
  const removed: string[] = [];
  while (
    await context.models.documentObjectStage.collectOne(async key => {
      removed.push(key);
    })
  ) {
    /* bounded by these two fixture rows */
  }
  t.deepEqual(removed, [`${context.workspaceId}/${orphan}`]);
  t.truthy(await context.models.blob.get(context.workspaceId, published));
  t.is(await context.db.documentObjectStage.count(), 0);
});

test('document notification retries preserve one notification and unrelated outbox events make progress', async t => {
  const context = t.context,
    source = await create(context);
  const input = {
    userId: context.actorId,
    body: {
      workspaceId: context.workspaceId,
      createdByUserId: context.actorId,
      commentId: 'fixture-comment',
      doc: { id: source.documentId!, title: 'Notice', mode: DocMode.page },
    },
  };
  const first = await context.models.notification.createComment(
    input,
    'stable-delivery'
  );
  await context.models.notification.markAsRead(first.id, context.actorId);
  const retry = await context.models.notification.createComment(
    input,
    'stable-delivery'
  );
  t.is(retry.id, first.id);
  t.true(retry.read);
  t.is(await context.db.notification.count(), 1);
  await context.models.documentComments.event(
    'failed-fixture',
    context.workspaceId,
    { type: 'fixture' }
  );
  await context.models.documentComments.event(
    'successful-fixture',
    context.workspaceId,
    { type: 'fixture' }
  );
  const seen: string[] = [];
  await context.models.documentComments.deliverBatch(async row => {
    seen.push(row.id);
    if (row.id === 'failed-fixture') throw new Error('retryable');
  });
  t.true(seen.includes('successful-fixture'));
  const pending = await context.db.documentEventOutbox.findUnique({
    where: { id: 'failed-fixture' },
  });
  t.is(pending?.attempts, 1);
  t.true(pending!.nextAttemptAt > new Date());
  t.is(
    await context.db.documentEventOutbox.findUnique({
      where: { id: 'successful-fixture' },
    }),
    null
  );
});

test('atomic companion storage failure rolls back the already edited body and metadata', async t => {
  const context = t.context,
    source = await create(context),
    resource = { kind: 'blocksuite', id: source.documentId! };
  const shape = z.object({
    version: z.string(),
    title: z.string(),
    metadata: z.object({ version: z.string() }),
    items: z.array(z.object({ id: z.string(), flavour: z.string() })),
  });
  const before = shape.parse(
    await nativeCall(context, 'workspace_doc_inspect', { resource })
  );
  const paragraph = before.items.find(
    item => item.flavour === 'affine:paragraph'
  )!;
  let titleInsideTransaction = '';
  const failing = Sinon.stub(context.models.comment, 'create').callsFake(
    async () => {
      titleInsideTransaction = (
        await context.app
          .get(WorkspaceResourceService)
          .describe(
            { workspaceId: context.workspaceId, actorId: context.actorId },
            resource.id
          )
      ).title;
      throw new Error('fixture comment storage failure');
    }
  );
  const outboxBefore = await context.db.documentEventOutbox.count();
  const request = {
    resource,
    expectedVersion: before.version,
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'body',
        type: 'text.splice',
        target: { kind: 'block_text', blockId: paragraph.id },
        offset: 0,
        deleteCount: 0,
        insert: [{ insert: 'atomic change' }],
      },
    ],
    metadata: {
      expectedMetadataVersion: before.metadata.version,
      properties: { title: 'Inside transaction' },
    },
    comments: {
      expectedCommentsVersion: '0',
      commands: [
        {
          opId: 'thread',
          type: 'comment.create',
          clientRef: 'thread',
          content: {
            version: 'localmind-blocksuite-comment/v1',
            paragraphs: [[{ insert: 'thread' }]],
          },
          anchor: { kind: 'block', blockId: paragraph.id },
        },
      ],
    },
  };
  const result = await nativeCall(context, 'workspace_doc_apply', request);
  t.is('status' in result ? result.status : null, 'needs_reconciliation');
  t.is(titleInsideTransaction, 'Inside transaction');
  t.deepEqual(
    shape.parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    ),
    before
  );
  t.is(await context.db.comment.count(), 0);
  t.is(await context.db.documentEventOutbox.count(), outboxBefore);
  failing.restore();
  const recovered = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', request)
  );
  t.true(recovered.changed);
  t.is(await context.db.comment.count(), 1);
  t.true(
    DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_apply', request)
    ).replayed
  );
});

test('Markdown plan becomes stale when a referenced document version changes', async t => {
  const context = t.context,
    source = await create(context),
    target = await create(context, {
      idempotencyKey: randomUUID(),
      title: 'Reference target',
    });
  const resource = { kind: 'blocksuite', id: source.documentId! };
  const before = z
    .object({
      version: z.string(),
      items: z.array(z.object({ id: z.string(), flavour: z.string() })),
    })
    .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }));
  const paragraph = before.items.find(
      item => item.flavour === 'affine:paragraph'
    )!,
    note = before.items.find(item => item.flavour === 'affine:note')!;
  const request = {
    resource,
    expectedVersion: before.version,
    idempotencyKey: randomUUID(),
    commands: [
      {
        opId: 'markdown',
        type: 'markdown.rewrite',
        parentId: note.id,
        selectedBlockIds: [paragraph.id],
        mode: 'update_preserve',
        markdown: '**Mapped native text**',
        marksPolicy: 'preserve_existing',
        mappings: [{ path: '0', blockId: paragraph.id }],
      },
      {
        opId: 'reference',
        type: 'text.splice',
        target: { kind: 'block_text', blockId: paragraph.id },
        offset: 18,
        deleteCount: 0,
        insert: [
          {
            insert: ' ref',
            attributes: {
              reference: { type: 'LinkedPage', pageId: target.documentId },
            },
          },
        ],
      },
    ],
  };
  const preview = z
    .object({ digest: z.string() })
    .parse(await nativeCall(context, 'workspace_doc_edit_preview', request));
  await context.app
    .get(DocWriter)
    .updateDocMeta(
      context.workspaceId,
      target.documentId!,
      { title: 'Changed dependency' },
      context.actorId
    );
  const stale = await nativeCall(context, 'workspace_doc_apply', {
    ...request,
    planDigest: preview.digest,
  });
  t.is('error' in stale ? stale.error.code : null, 'plan_stale');
  t.is(
    z
      .object({ version: z.string() })
      .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }))
      .version,
    before.version
  );
  const current = z.object({ digest: z.string() }).parse(
    await nativeCall(context, 'workspace_doc_edit_preview', {
      ...request,
      idempotencyKey: randomUUID(),
    })
  );
  t.not(current.digest, preview.digest);
});

test('notification continuation covers more than fifty authors and retries use one durable delivery identity', async t => {
  const context = t.context,
    source = await create(context),
    docId = source.documentId!;
  const users = Array.from({ length: 53 }, () => ({
    id: randomUUID(),
    name: 'Fixture',
    email: `${randomUUID()}@example.test`,
  }));
  await context.db.user.createMany({ data: users });
  await context.db.workspaceMember.createMany({
    data: users.map(user => ({
      workspaceId: context.workspaceId,
      userId: user.id,
      role: 'member',
      state: 'active',
    })),
  });
  const comment = await context.models.comment.create({
    workspaceId: context.workspaceId,
    docId,
    userId: context.actorId,
    content: {},
  });
  await context.db.reply.createMany({
    data: users.map(user => ({
      workspaceId: context.workspaceId,
      docId,
      userId: user.id,
      commentId: comment.id,
      content: {},
    })),
  });
  const eventId = randomUUID(),
    payload = {
      type: 'comment.notification',
      resourceId: docId,
      actorId: context.actorId,
      commentId: comment.id,
      replyId: 'fixture-reply',
      mentions: [users[0].id],
      title: 'Fixture',
      mode: 'page',
    };
  await context.models.documentComments.event(
    eventId,
    context.workspaceId,
    payload
  );
  const queue = context.app.queue,
    deliveries: { userId: string; deliveryKey: string }[] = [];
  const stub = queue.add.callsFake(async (name, input) => {
    if (name !== 'notification.sendComment') return;
    const delivery = z
      .object({ userId: z.string(), deliveryKey: z.string() })
      .parse(input);
    deliveries.push(delivery);
    if (deliveries.length === 3) throw new Error('fixture queue interruption');
    return undefined;
  });
  await context.app.get(DocumentEventsService).deliver();
  await context.db.documentEventOutbox.updateMany({
    data: { nextAttemptAt: new Date(0) },
  });
  await context.app.get(DocumentEventsService).deliver();
  t.deepEqual(
    [...new Set(deliveries.map(delivery => delivery.userId))].sort(),
    users.map(user => user.id).sort()
  );
  t.true(deliveries.every(delivery => delivery.deliveryKey === eventId));
  t.is(await context.db.documentEventOutbox.count(), 0);
  t.true(deliveries.length > users.length);
  stub.resetBehavior();
  stub.resolves();
});

test('physical staging cleanup retries an object-store failure and deletes only the orphan bytes', async t => {
  const context = t.context,
    storage = context.app.get(OfficeResourceStorage),
    rt = context.app.get(StorageRuntimeProvider);
  let orphan = '';
  await t.throwsAsync(
    context.app
      .get(WorkspaceResourceService)
      .snapshot(
        { workspaceId: context.workspaceId, actorId: context.actorId },
        async () => {
          orphan = await storage.putGenerated(
            context.workspaceId,
            context.actorId,
            Buffer.from('actual orphan'),
            'text/plain',
            async () => {}
          );
          throw new Error('rollback');
        }
      )
  );
  const key = `${context.workspaceId}/${orphan}`;
  t.truthy(await rt.headObject('blob', key));
  await context.db.documentObjectStage.updateMany({
    data: { expiresAt: new Date(0) },
  });
  await context.models.documentObjectStage.collectOne(async () => {
    throw new Error('fixture outage');
  });
  t.truthy(await rt.headObject('blob', key));
  t.is(await context.db.documentObjectStage.count(), 1);
  await context.db.documentObjectStage.updateMany({
    data: { expiresAt: new Date(0) },
  });
  await context.models.documentObjectStage.collectOne(key =>
    rt.deleteObject('blob', key)
  );
  t.falsy(await rt.headObject('blob', key));
  t.is(await context.db.documentObjectStage.count(), 0);
});

test('Workspace staging imports the first file without a placeholder and resumes from exact received parts', async t => {
  const context = t.context,
    before = await context.db.snapshot.count(),
    bytes = Buffer.from('first native file\r\n\r\n');
  const resource = { kind: 'workspace', id: context.workspaceId },
    version = 'workspace-staging/v1';
  const write = (upload: unknown) =>
    nativeCall(context, 'workspace_doc_asset_upload', {
      resource,
      expectedVersion: version,
      idempotencyKey: randomUUID(),
      upload,
    });
  const begin = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({
      action: 'begin',
      totalBytes: bytes.length,
      mimeType: 'text/plain',
      fingerprint: createHash('sha256').update(bytes).digest('hex'),
    })
  );
  const uploadId = begin.upload!.uploadId;
  const firstStatus = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({ action: 'status', uploadId })
  );
  t.false(firstStatus.changed);
  t.deepEqual(firstStatus.upload?.receivedParts, []);
  await write({
    action: 'part',
    uploadId,
    number: 0,
    base64: bytes.toString('base64'),
  });
  const resumed = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({ action: 'status', uploadId })
  );
  t.deepEqual(resumed.upload?.receivedParts, [0]);
  t.is(resumed.upload?.receivedBytes, bytes.length);
  t.is(await context.db.snapshot.count(), before);
  const committed = DOCUMENT_RECEIPT_SCHEMA.parse(
    await write({ action: 'commit', uploadId })
  );
  t.is(await context.db.snapshot.count(), before);
  const receipt = await call(context, 'workspace_operation_get', {
    operationId: committed.operationId,
  });
  t.true(DOCUMENT_RECEIPT_SCHEMA.parse(receipt).replayed);
  const imported = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_import', {
      resource: { kind: 'file' },
      title: 'First.txt',
      blobId: committed.upload!.blobId,
      destination: { kind: 'legacy-folder', folderId: null },
      idempotencyKey: randomUUID(),
    })
  );
  const result = z.object({ data: z.object({ base64: z.string() }) }).parse(
    await nativeCall(context, 'workspace_doc_export', {
      resource: imported.resource,
      expectedVersion: imported.afterVersion,
      format: 'native-content',
    })
  );
  t.deepEqual(Buffer.from(result.data.base64, 'base64'), bytes);
  const denied = await nativeCall(context, 'workspace_doc_asset_upload', {
    resource: { ...resource, id: randomUUID() },
    expectedVersion: version,
    idempotencyKey: randomUUID(),
    upload: { action: 'status', uploadId },
  });
  t.is('error' in denied ? denied.error.code : null, 'invalid_input');
});

test('actor staging capacity is released by expiry and staged bytes are removed in bounded cleanup', async t => {
  const context = t.context;
  const request = {
    resource: { kind: 'workspace', id: context.workspaceId },
    expectedVersion: 'workspace-staging/v1',
    upload: {
      action: 'begin',
      totalBytes: 1,
      mimeType: 'text/plain',
      fingerprint: createHash('sha256').update('a').digest('hex'),
    },
  };
  const uploads = [];
  for (let i = 0; i < 8; i++)
    uploads.push(
      DOCUMENT_RECEIPT_SCHEMA.parse(
        await nativeCall(context, 'workspace_doc_asset_upload', {
          ...request,
          idempotencyKey: randomUUID(),
        })
      )
    );
  const refused = await nativeCall(context, 'workspace_doc_asset_upload', {
    ...request,
    idempotencyKey: randomUUID(),
  });
  t.is('error' in refused ? refused.error.code : null, 'quota_exceeded');
  await nativeCall(context, 'workspace_doc_asset_upload', {
    ...request,
    idempotencyKey: randomUUID(),
    upload: {
      action: 'part',
      uploadId: uploads[0].upload!.uploadId,
      number: 0,
      base64: 'YQ==',
    },
  });
  t.is(await context.db.mcpDocumentUploadPart.count(), 1);
  // Reconstruct a historical expired fixture; expiry itself is immutable.
  const historical = await context.db.mcpDocumentUpload.findMany();
  const historicalParts = await context.db.mcpDocumentUploadPart.findMany();
  await context.db.mcpDocumentUpload.deleteMany();
  await context.db.mcpDocumentUpload.createMany({
    data: historical.map(upload => ({ ...upload, expiresAt: new Date(0) })),
  });
  await context.db.mcpDocumentUploadPart.createMany({ data: historicalParts });
  await context.models.mcpDocumentUpload.expire();
  t.is(await context.db.mcpDocumentUploadPart.count(), 0);
  t.is(
    await context.db.mcpDocumentUpload.count({ where: { status: 'expired' } }),
    8
  );
  t.is(
    DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_asset_upload', {
        ...request,
        idempotencyKey: randomUUID(),
      })
    ).upload?.status,
    'pending'
  );
});

test('another authorized member restores a signed archive and loses this ability when source access is revoked', async t => {
  const context = t.context,
    created = await create(context),
    resource = { kind: 'blocksuite' as const, id: created.documentId! };
  const version = z
    .object({ version: z.string() })
    .parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    ).version;
  const bundle = await exportTestBundle(context, resource, version);
  const blobId = await context.app
    .get(OfficeResourceStorage)
    .putGenerated(
      context.workspaceId,
      context.actorId,
      bundle.bytes,
      DOCUMENT_ARCHIVE_MIME,
      async () => {}
    );
  const member = await context.app.signupV1();
  await context.db.workspaceMember.create({
    data: {
      workspaceId: context.workspaceId,
      userId: member.id,
      role: 'member',
      state: 'active',
    },
  });
  const issued = await context.app.get(McpCredentialService).create({
    workspaceId: context.workspaceId,
    userId: member.id,
    name: 'Archive member',
    accessMode: 'READ_WRITE',
    capabilities: ['workspace_doc_import', 'workspace_operation_get'],
    expirationDays: 30,
  });
  const request = {
    resource: { kind: 'blocksuite' },
    title: 'Shared archive',
    format: 'native-bundle',
    blobId,
    proof: bundle.proof,
    destination: { kind: 'legacy-folder', folderId: null },
    idempotencyKey: randomUUID(),
  };
  const copied = DOCUMENT_RECEIPT_SCHEMA.parse(
    await context.app
      .get(McpDocumentsService)
      .execute(issued.credential, 'workspace_doc_import', request)
  );
  t.true(copied.changed);
  t.not(copied.resource.id, resource.id);
  await context.models.doc.setDefaultRole(
    context.workspaceId,
    resource.id,
    DocRole.None
  );
  const refused = await context.app
    .get(McpDocumentsService)
    .execute(issued.credential, 'workspace_doc_import', {
      ...request,
      idempotencyKey: randomUUID(),
    });
  t.true('error' in refused);
});

for (const kind of ['office', 'file'] as const) {
  test(`atomic ${kind} edit previews without objects and rolls back body with failing metadata`, async t => {
    const context = t.context;
    const created = DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_create_native', {
        resource: { kind },
        title: kind === 'office' ? 'Atomic.docx' : 'Atomic.txt',
        destination: { kind: 'legacy-folder', folderId: null },
        idempotencyKey: randomUUID(),
        content:
          kind === 'office'
            ? { format: 'docx', paragraphs: [{ text: 'Before' }] }
            : { format: 'txt', text: 'Before\r\n' },
      })
    );
    const resource = created.resource;
    const shape = z.object({
      version: z.string(),
      title: z.string(),
      metadata: z.object({ version: z.string() }),
      items: z.array(z.object({ data: z.string() })),
    });
    const before = shape.parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    );
    const state =
      kind === 'office'
        ? JSON.parse(
            Buffer.concat(
              before.items.map(item => Buffer.from(item.data, 'base64'))
            ).toString('utf8')
          )
        : null;
    const officeRevision =
      kind === 'office'
        ? await context.app
            .get(OfficeArtifactService)
            .getRevision(context.workspaceId, context.actorId, resource.id)
        : null;
    const commandBase = {
      version: 'localmind-office-command/v1',
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      artifactId: resource.id,
      expectedRevisionId: officeRevision?.id,
      source: 'user',
    };
    const request = {
      resource,
      expectedVersion: before.version,
      idempotencyKey: randomUUID(),
      ...(kind === 'file'
        ? {
            commands: [
              {
                opId: 'edit',
                type: 'file.text.splice',
                offset: 0,
                deleteCount: 6,
                insert: 'After',
              },
            ],
          }
        : {
            batch: {
              version: 'localmind-office-command-batch/v1',
              batchId: randomUUID(),
              idempotencyKey: randomUUID(),
              artifactId: resource.id,
              expectedRevisionId: officeRevision!.id,
              source: 'user',
              commands: [
                {
                  ...commandBase,
                  operation: 'office.document.paragraph.text.set',
                  target: { type: 'paragraph', blockId: state.body[0].id },
                  expectedText: 'Before',
                  text: 'After',
                },
              ],
            },
          }),
      metadata: {
        expectedMetadataVersion: before.metadata.version,
        properties: { title: 'After title' },
      },
    };
    const counts = async () => [
      await context.db.blob.count(),
      await context.db.officeRevision.count(),
      await context.db.workspaceFileRevision.count(),
      await context.db.documentObjectStage.count(),
    ];
    const initialCounts = await counts();
    const preview = await nativeCall(
      context,
      'workspace_doc_edit_preview',
      request
    );
    t.is('status' in preview ? preview.status : null, 'preview');
    t.deepEqual(await counts(), initialCounts);
    // Validation uses preview=true. Fail only after the body has written within the transaction.
    const service = context.app.get(McpDocumentsService);
    const hook = service as unknown as {
      updateProperties: (...args: unknown[]) => Promise<unknown>;
    };
    const original = hook.updateProperties.bind(service);
    const failure = Sinon.stub(hook, 'updateProperties').callsFake(
      async (...args) => {
        if (args[2] !== true)
          throw new Error('fixture metadata storage failure');
        return original(...args);
      }
    );
    const refused = await nativeCall(context, 'workspace_doc_apply', request);
    t.is('status' in refused ? refused.status : null, 'needs_reconciliation');
    t.deepEqual(
      shape.parse(
        await nativeCall(context, 'workspace_doc_inspect', { resource })
      ),
      before
    );
    // External objects have durable cleanup evidence, but no committed resource revision.
    t.deepEqual((await counts()).slice(0, 3), initialCounts.slice(0, 3));
    failure.restore();
    const applied = DOCUMENT_RECEIPT_SCHEMA.parse(
      await nativeCall(context, 'workspace_doc_apply', request)
    );
    t.true(applied.changed);
    const after = shape.parse(
      await nativeCall(context, 'workspace_doc_inspect', { resource })
    );
    t.is(after.title, 'After title');
    t.not(after.version, before.version);
    t.true(
      Buffer.concat(after.items.map(item => Buffer.from(item.data, 'base64')))
        .toString('utf8')
        .includes('After')
    );
    t.true(
      DOCUMENT_RECEIPT_SCHEMA.parse(
        await nativeCall(context, 'workspace_doc_apply', request)
      ).replayed
    );
  });
}

test('queued comment delivery rechecks the recipient access after revocation', async t => {
  const context = t.context,
    created = await create(context),
    member = await context.app.signupV1();
  await context.db.workspaceMember.create({
    data: {
      workspaceId: context.workspaceId,
      userId: member.id,
      role: 'member',
      state: 'active',
    },
  });
  const body = {
    workspaceId: context.workspaceId,
    createdByUserId: context.actorId,
    commentId: randomUUID(),
    doc: {
      id: created.documentId!,
      title: 'Notification fixture',
      mode: DocMode.page,
    },
  };
  const job = context.app.get(NotificationJob);
  await job.sendComment({ userId: member.id, deliveryKey: randomUUID(), body });
  const count = await context.db.notification.count({
    where: { userId: member.id },
  });
  t.is(count, 1);
  await context.models.doc.setDefaultRole(
    context.workspaceId,
    created.documentId!,
    DocRole.None
  );
  await job.sendComment({ userId: member.id, deliveryKey: randomUUID(), body });
  t.is(
    await context.db.notification.count({ where: { userId: member.id } }),
    count
  );
});

test('native write rollback switch retains reads and receipts without affecting v1 capabilities', async t => {
  const context = t.context,
    created = await create(context),
    resource = { kind: 'blocksuite', id: created.documentId! };
  const read = z
    .object({
      version: z.string(),
      metadata: z.object({ version: z.string() }),
    })
    .parse(await nativeCall(context, 'workspace_doc_inspect', { resource }));
  const write = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_properties_update', {
      resource,
      expectedVersion: read.version,
      expectedMetadataVersion: read.metadata.version,
      idempotencyKey: randomUUID(),
      properties: { title: 'Before rollback' },
    })
  );
  context.app.get(Config).doc.mcpDocumentEditingEnabled = false;
  const names = context.app
    .get(McpDocumentsService)
    .tools(context.credential, MCP_CAPABILITIES)
    .map(tool => tool.name);
  const enabled = new Set(names);
  t.true(enabled.has('workspace_doc_inspect'));
  t.false(enabled.has('workspace_doc_apply'));
  const inspected = await nativeCall(context, 'workspace_doc_inspect', {
    resource,
  });
  t.is(
    z.object({ title: z.string() }).parse(inspected).title,
    'Before rollback'
  );
  const denied = await nativeCall(context, 'workspace_doc_properties_update', {
    resource,
    expectedVersion: write.afterVersion,
    expectedMetadataVersion: write.metadataVersion,
    idempotencyKey: randomUUID(),
    properties: { title: 'Must not write' },
  });
  t.is('error' in denied ? denied.error.code : null, 'capability_denied');
  t.true(
    DOCUMENT_RECEIPT_SCHEMA.parse(
      await call(context, 'workspace_operation_get', {
        operationId: write.operationId,
      })
    ).replayed
  );
  t.truthy(await create(context, { title: 'v1 still authorized' }));
});

test('continuous Office typing preserves opaque paragraph state through declared identity promotion', async t => {
  const context = t.context;
  const created = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_create_native', {
      resource: { kind: 'office' },
      title: 'Identity.docx',
      destination: { kind: 'legacy-folder', folderId: null },
      idempotencyKey: randomUUID(),
      content: { format: 'docx', paragraphs: [{ text: 'Keep' }, { text: '' }] },
    })
  );
  const office = context.app.get(OfficeArtifactService),
    parent = await office.getRevision(
      context.workspaceId,
      context.actorId,
      created.resource.id
    );
  const original = await office.readRevisionAsset(
    context.workspaceId,
    context.actorId,
    created.resource.id,
    parent.id,
    'state'
  );
  const state = z
    .object({ body: z.array(z.object({ id: z.string() }).passthrough()) })
    .passthrough()
    .parse(JSON.parse(original.bytes.toString('utf8')));
  const stored = {
    ...state,
    futureRoot: { keep: true },
    body: state.body.map((block, index) => ({
      ...block,
      futureAnnotation: { identity: index },
    })),
  };
  const bytes = Buffer.from(JSON.stringify(stored)),
    stateFingerprint = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const key = await context.app
    .get(OfficeResourceStorage)
    .put(context.workspaceId, context.actorId, 'identity-state', bytes, {
      contentType: 'application/json',
      contentLength: bytes.length,
    });
  const appended = await context.models.officeArtifact.appendRevision({
    workspaceId: context.workspaceId,
    artifactId: created.resource.id,
    actorId: context.actorId,
    origin: 'user',
    expectedParentRevisionId: parent.id,
    idempotencyKey: randomUUID(),
    idempotencyFingerprint: stateFingerprint,
    package: {
      key: parent.packageBlobKey,
      mimeType: parent.packageMimeType,
      byteSize: parent.packageByteSize,
      fingerprint: parent.packageFingerprint,
    },
    state: { key, byteSize: bytes.length, fingerprint: stateFingerprint },
    modelVersion: parent.modelVersion!,
  });
  const before = z.object({ version: z.string() }).parse(
    await nativeCall(context, 'workspace_doc_inspect', {
      resource: created.resource,
    })
  );
  const command = {
    version: 'localmind-office-command/v1',
    commandId: 'typing',
    idempotencyKey: randomUUID(),
    artifactId: created.resource.id,
    expectedRevisionId: appended.revision.id,
    source: 'user',
    operation: 'office.document.edit',
    identities: state.body.map((block, index) => ({
      blockId: block.id,
      id: `paragraph:0000000${index + 1}`,
    })),
    patches: [
      {
        targets: ['paragraph:00000002'],
        paragraphs: [
          {
            id: 'paragraph:00000002',
            runs: [{ text: 'Typed into the empty paragraph' }],
          },
        ],
      },
    ],
  };
  const request = {
    resource: created.resource,
    expectedVersion: before.version,
    idempotencyKey: randomUUID(),
    batch: {
      version: 'localmind-office-command-batch/v1',
      batchId: 'typing',
      idempotencyKey: randomUUID(),
      artifactId: created.resource.id,
      expectedRevisionId: appended.revision.id,
      source: 'user',
      commands: [command],
    },
  };
  const preview = await nativeCall(
    context,
    'workspace_doc_edit_preview',
    request
  );
  t.is('status' in preview ? preview.status : null, 'preview');
  const applied = DOCUMENT_RECEIPT_SCHEMA.parse(
    await nativeCall(context, 'workspace_doc_apply', request)
  );
  t.true(applied.preservationVerified);
  const current = await office.getRevision(
    context.workspaceId,
    context.actorId,
    created.resource.id
  );
  const reopened = await office.readRevisionAsset(
    context.workspaceId,
    context.actorId,
    created.resource.id,
    current.id,
    'state'
  );
  const result = z
    .object({
      futureRoot: z.unknown(),
      body: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          futureAnnotation: z.unknown(),
        })
      ),
    })
    .parse(JSON.parse(reopened.bytes.toString('utf8')));
  t.deepEqual(result, {
    futureRoot: { keep: true },
    body: [
      {
        id: 'paragraph:00000001',
        text: 'Keep',
        futureAnnotation: { identity: 0 },
      },
      {
        id: 'paragraph:00000002',
        text: 'Typed into the empty paragraph',
        futureAnnotation: { identity: 1 },
      },
    ],
  });
  t.deepEqual(
    (
      await office.readRevisionAsset(
        context.workspaceId,
        context.actorId,
        created.resource.id,
        appended.revision.id,
        'state'
      )
    ).bytes,
    bytes
  );
});
