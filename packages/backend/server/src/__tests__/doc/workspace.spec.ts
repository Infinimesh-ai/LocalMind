import { PrismaClient } from '@prisma/client';
import test from 'ava';
import * as Sinon from 'sinon';
import { applyUpdate, Doc as YDoc, encodeStateAsUpdate } from 'yjs';

import {
  DocStorageModule,
  PgWorkspaceDocStorageAdapter as Adapter,
} from '../../core/doc';
import { Models } from '../../models';
import { createTestingModule, type TestingModule } from '../utils';

let m: TestingModule;
let db: PrismaClient;
let adapter: Adapter;
let models: Models;

test.before('init testing module', async () => {
  m = await createTestingModule({
    imports: [DocStorageModule],
  });
  db = m.get(PrismaClient);
  adapter = m.get(Adapter);
  models = m.get(Models);
  // @ts-expect-error private method
  Sinon.stub(adapter, 'createDocHistory');
});

test.beforeEach(async () => {
  await m.initTestingDB();
});

test.after.always(async () => {
  await m?.close();
});

test('should have timestamp update', async t => {
  const doc = new YDoc();
  const text = doc.getText('content');
  const updates: Buffer[] = [];

  doc.on('update', update => {
    updates.push(Buffer.from(update));
  });

  text.insert(0, 'hello');
  text.insert(5, 'world');
  text.insert(5, ' ');

  await adapter.pushDocUpdates('2', '2', updates);

  let records = await db.update.findMany({
    where: {
      workspaceId: '2',
      id: '2',
    },
  });

  let firstTimestamp = records[0].createdAt.getTime();
  t.deepEqual(
    records.map(({ createdAt }) => createdAt.getTime()),
    [firstTimestamp, firstTimestamp + 1, firstTimestamp + 2]
  );

  // merge
  await adapter.getDoc('2', '2');

  // change timestamp again
  await adapter.pushDocUpdates('2', '2', updates);

  records = await db.update.findMany({
    where: {
      workspaceId: '2',
      id: '2',
    },
  });

  firstTimestamp = records[0].createdAt.getTime();
  t.deepEqual(
    records.map(({ createdAt }) => createdAt.getTime()),
    [firstTimestamp, firstTimestamp + 1, firstTimestamp + 2]
  );

  // push a new update
  await adapter.pushDocUpdates('2', '2', updates.slice(0, 1));

  // let the manager ignore update with the new seq num
  // @ts-expect-error private method
  const stub = Sinon.stub(adapter, 'getDocUpdates').resolves(
    records.map(record => ({
      bin: record.blob,
      timestamp: record.createdAt.getTime(),
    }))
  );

  await adapter.getDoc('2', '2');
  stub.restore();

  // should not merge in one run
  t.not(await db.update.count(), 0);
});

test('should retry if failed to insert updates', async t => {
  const stub = Sinon.stub(models.doc, 'createUpdates');
  stub.onCall(0).rejects(new Error());
  stub.onCall(1).resolves({ count: 1, timestamps: [Date.now()] });

  try {
    await t.notThrowsAsync(() =>
      adapter.pushDocUpdates('1', '1', [Buffer.from([0, 0])])
    );
    t.is(stub.callCount, 2);
  } finally {
    stub.restore();
  }
});

test('should throw if meet max retry times', async t => {
  const stub = Sinon.stub(models.doc, 'createUpdates');
  stub.rejects(new Error());

  try {
    await t.throwsAsync(
      () => adapter.pushDocUpdates('1', '1', [Buffer.from([0, 0])]),
      { message: 'Failed to store doc updates.' }
    );
    t.is(stub.callCount, 4);
  } finally {
    stub.restore();
  }
});

test('should be able to merge updates as snapshot', async t => {
  const doc = new YDoc();
  const text = doc.getText('content');
  text.insert(0, 'hello');
  const update = encodeStateAsUpdate(doc);

  await db.workspace.create({
    data: {
      id: '1',
      accessPolicy: { create: {} },
    },
  });

  await db.update.createMany({
    data: [
      {
        id: '1',
        workspaceId: '1',
        blob: Buffer.from(update),
        createdAt: new Date(Date.now() + 1),
        createdBy: null,
      },
    ],
  });

  t.deepEqual(
    Buffer.from((await adapter.getDoc('1', '1'))!.bin),
    Buffer.from(update)
  );

  let appendUpdate = Buffer.from([]);
  doc.on('update', update => {
    appendUpdate = Buffer.from(update);
  });
  text.insert(5, 'world');

  await db.update.create({
    data: {
      workspaceId: '1',
      id: '1',
      blob: appendUpdate,
      createdAt: new Date(),
      createdBy: null,
    },
  });

  {
    const { bin } = (await adapter.getDoc('1', '1'))!;
    const dbDoc = new YDoc();
    applyUpdate(dbDoc, bin);

    t.is(dbDoc.getText('content').toString(), 'helloworld');
    t.deepEqual(encodeStateAsUpdate(dbDoc), encodeStateAsUpdate(doc));
  }
});

test('should be able to merge updates into snapshot', async t => {
  const updates: Buffer[] = [];
  {
    const doc = new YDoc();
    doc.on('update', data => {
      updates.push(Buffer.from(data));
    });

    const text = doc.getText('content');
    text.insert(0, 'hello');
    text.insert(5, 'world');
    text.insert(5, ' ');
    text.insert(11, '!');
  }

  {
    await adapter.pushDocUpdates('1', '1', updates.slice(0, 2));
    // merge
    const { bin } = (await adapter.getDoc('1', '1'))!;
    const doc = new YDoc();
    applyUpdate(doc, bin);

    t.is(doc.getText('content').toString(), 'helloworld');
  }

  {
    await adapter.pushDocUpdates('1', '1', updates.slice(2));
    // merge
    const { bin } = (await adapter.getDoc('1', '1'))!;
    const doc = new YDoc();
    applyUpdate(doc, bin);

    t.is(doc.getText('content').toString(), 'hello world!');
  }

  t.is(await db.update.count(), 0);
});

test('should allocate new updates after a future snapshot timestamp', async t => {
  const updates: Buffer[] = [];
  {
    const doc = new YDoc();
    doc.on('update', data => {
      updates.push(Buffer.from(data));
    });

    const text = doc.getText('content');
    text.insert(0, 'hello');
    text.insert(5, 'world');
    text.insert(5, ' ');
    text.insert(11, '!');
  }

  await adapter.pushDocUpdates('2', '1', updates.slice(0, 2)); // 'helloworld'
  // merge
  await adapter.getDoc('2', '1');
  // fake the snapshot is a lot newer
  const futureSnapshotTimestamp = Date.now() + 10000;
  await db.snapshot.update({
    where: {
      workspaceId_id: {
        workspaceId: '2',
        id: '1',
      },
    },
    data: {
      updatedAt: new Date(futureSnapshotTimestamp),
    },
  });

  {
    const timestamp = await adapter.pushDocUpdates('2', '1', updates.slice(2)); // 'hello world!'
    t.is(timestamp, futureSnapshotTimestamp + 2);
    const { bin } = (await adapter.getDoc('2', '1'))!;

    // The write is ordered after the persisted snapshot, so the merge can
    // advance the snapshot without dropping the update.
    const doc = new YDoc();
    applyUpdate(doc, bin);
    t.is(doc.getText('content').toString(), 'hello world!');
  }

  {
    const doc = new YDoc();
    applyUpdate(doc, (await adapter.getDoc('2', '1'))!.bin);
    t.is(doc.getText('content').toString(), 'hello world!');

    // The merged updates are removed after the snapshot advances.
    t.is(await db.update.count(), 0);
  }
});
