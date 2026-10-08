import { setImmediate as nextTurn } from 'node:timers/promises';

import test from 'ava';
import { ClsServiceManager } from 'nestjs-cls';
import sinon from 'sinon';

import { WorkspaceDocOutboxPublisher } from '../outbox';

function fixture() {
  const deliverBatch = sinon.stub().resolves(0);
  const isTransactionActive = sinon.stub().returns(false);
  const publisher = new WorkspaceDocOutboxPublisher(
    { workspaceDocOutbox: { deliverBatch } } as never,
    { emitAsync: sinon.stub().resolves() } as never,
    { add: sinon.stub().resolves() } as never,
    ClsServiceManager.getClsService(),
    { isTransactionActive } as never
  );
  return { publisher, deliverBatch, isTransactionActive };
}

test('immediate requests coalesce and never publish inside a caller transaction', async t => {
  const { publisher, deliverBatch, isTransactionActive } = fixture();
  try {
    isTransactionActive.returns(true);
    publisher.requestPublish();
    await nextTurn();
    t.false(deliverBatch.called);
    isTransactionActive.returns(false);
    publisher.requestPublish();
    publisher.requestPublish();
    await nextTurn();
    t.is(deliverBatch.callCount, 1);
  } finally {
    await publisher.onModuleDestroy();
  }
});

test('a commit arriving during delivery schedules another batch without concurrent delivery', async t => {
  const { publisher, deliverBatch } = fixture();
  let resolve!: (count: number) => void;
  deliverBatch.onFirstCall().returns(
    new Promise<number>(done => {
      resolve = done;
    })
  );
  try {
    const first = publisher.publish();
    publisher.requestPublish();
    await nextTurn();
    t.is(deliverBatch.callCount, 1);
    resolve(0);
    await first;
    await nextTurn();
    t.is(deliverBatch.callCount, 2);
  } finally {
    await publisher.onModuleDestroy();
  }
});

test('full batches drain promptly and failures remain retryable by the periodic publisher', async t => {
  const { publisher, deliverBatch } = fixture();
  try {
    deliverBatch.onFirstCall().resolves(50);
    deliverBatch.onSecondCall().rejects(new Error('delivery failed'));
    await publisher.publish();
    await nextTurn();
    t.is(deliverBatch.callCount, 2);
    await publisher.publish();
    t.is(deliverBatch.callCount, 3);
  } finally {
    await publisher.onModuleDestroy();
  }
});

test('shutdown cancels a scheduled wakeup', async t => {
  const { publisher, deliverBatch } = fixture();
  publisher.requestPublish();
  await publisher.onModuleDestroy();
  await nextTurn();
  t.false(deliverBatch.called);
});
