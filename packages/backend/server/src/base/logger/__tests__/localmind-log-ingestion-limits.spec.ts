import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';

import { Prisma } from '@prisma/client';
import test from 'ava';

import { shouldPersistHttpCompletion } from '../../../middleware/timing';
import { GraphQLCompletionSummary } from '../../graphql/logger-plugin';
import {
  type LocalMindLogInput,
  LocalMindLogService,
} from '../localmind-log-service';
import { LocalMindLogSpool, SpoolCapacityError } from '../spool';

type CreateMany = (
  args: Prisma.LocalMindLogEventCreateManyAndReturnArgs
) => Promise<{ eventId: string }[]>;

function runtimePrisma(events: { createManyAndReturn: CreateMany }) {
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    localMindLogEvent: events,
  };
  return {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  };
}

const inserted: CreateMany = async args =>
  (Array.isArray(args.data) ? args.data : [args.data]).map(record => ({
    eventId: record.eventId,
  }));

async function createService(
  t: { teardown: (fn: () => unknown) => void },
  createManyAndReturn: CreateMany
) {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-ingestion-'));
  t.teardown(() => rm(directory, { recursive: true, force: true }));
  const previous = process.env.LOCALMIND_LOG_SPOOL_DIR;
  process.env.LOCALMIND_LOG_SPOOL_DIR = directory;
  const service = new LocalMindLogService(
    runtimePrisma({ createManyAndReturn }) as unknown as ConstructorParameters<
      typeof LocalMindLogService
    >[0]
  );
  if (previous === undefined) delete process.env.LOCALMIND_LOG_SPOOL_DIR;
  else process.env.LOCALMIND_LOG_SPOOL_DIR = previous;
  const spool = new LocalMindLogSpool(directory);
  const spooled = async () =>
    Promise.all((await spool.list()).map(file => spool.read(file)));
  return { service, directory, spooled };
}

async function waitFor(check: () => Promise<boolean> | boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('condition not reached');
}

function silenceStdout(t: { teardown: (fn: () => unknown) => void }) {
  const stdout = mock.method(process.stdout, 'write', () => true);
  t.teardown(() => stdout.mock.restore());
  return stdout;
}

test('spool appends keep committed size without rescanning the directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-spool-usage-'));
  t.teardown(() => rm(directory, { recursive: true, force: true }));
  const spool = new LocalMindLogSpool(directory);
  const scan = mock.method(spool as any, 'scanUsage');
  const list = mock.method(spool, 'list');
  for (let index = 0; index < 20; index++) {
    await spool.append({ eventId: `evt-${index}`, metadata: { index } });
  }
  t.is(scan.mock.callCount(), 1);
  t.is(list.mock.callCount(), 0);
  t.is(await spool.files(), 20);

  // A new owner rebuilds the same counters from the files once.
  const restarted = new LocalMindLogSpool(directory);
  t.is(await restarted.bytes(), await spool.bytes());
  t.is(await restarted.files(), 20);

  const [first, ...rest] = await restarted.list(5);
  t.is(rest.length, 4);
  const before = await restarted.bytes();
  await restarted.remove(first);
  t.true((await restarted.bytes()) < before);
  t.is(await restarted.files(), 19);
});

test('concurrent spool appends cannot overrun the capacity reservation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-spool-reserve-'));
  t.teardown(() => rm(directory, { recursive: true, force: true }));
  const probe = new LocalMindLogSpool(join(directory, 'probe'));
  await probe.append({ eventId: 'evt-0' });
  const size = await probe.bytes();
  const spool = new LocalMindLogSpool(join(directory, 'spool'), size * 3);
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      spool.append({ eventId: `evt-${index}` })
    )
  );
  const rejected = results.filter(result => result.status === 'rejected');
  t.true(
    rejected.every(
      result =>
        result.status === 'rejected' &&
        result.reason instanceof SpoolCapacityError
    )
  );
  t.is(rejected.length, 7);
  t.is(await spool.bytes(), size * 3);
  t.is(await spool.files(), 3);
  t.is((await spool.list()).length, await spool.files());
});

test('runtime writes beyond the in-flight budget are dropped and counted', async t => {
  const pending: (() => void)[] = [];
  const batches: number[] = [];
  const { service } = await createService(t, args => {
    batches.push(Array.isArray(args.data) ? args.data.length : 1);
    return new Promise(resolve => pending.push(() => resolve(inserted(args))));
  });
  silenceStdout(t);
  service.limits.maxInFlightRecords = 3;
  const writes = Array.from({ length: 5 }, (_, index) =>
    service.write({ eventName: 'runtime.info', metadata: { index } })
  );
  const critical = Array.from({ length: 4 }, () =>
    service.write({ eventName: 'runtime.error', severity: 'error' })
  );
  // Three runtime writes plus three critical writes inside the 2x reserve.
  t.is(service.ingestionStatus().inFlightRecords, 6);
  t.deepEqual(service.ingestionStatus().window.dropped, { admission: 3 });
  // Accepted records are written as one batch, not one transaction each.
  await waitFor(() => pending.length === 1);
  t.deepEqual(batches, [6]);
  pending.splice(0).forEach(resolve => resolve());
  await Promise.all([...writes, ...critical]);
  t.is(service.ingestionStatus().inFlightRecords, 0);
  t.is(service.ingestionStatus().inFlightBytes, 0);
});

test('the batch writer splits by record count and keeps one batch in flight', async t => {
  const pending: (() => void)[] = [];
  const batches: number[] = [];
  const { service } = await createService(t, args => {
    batches.push(Array.isArray(args.data) ? args.data.length : 1);
    return new Promise(resolve => pending.push(() => resolve(inserted(args))));
  });
  silenceStdout(t);
  service.limits.batchMaxRecords = 4;
  const writes = Array.from({ length: 10 }, () =>
    service.write({ eventName: 'runtime.info' })
  );
  await waitFor(() => pending.length === 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  t.deepEqual(batches, [4]);
  while (batches.length < 3 || pending.length) {
    await waitFor(() => pending.length === 1);
    pending.shift()?.();
  }
  await Promise.all(writes);
  t.deepEqual(batches, [4, 4, 2]);
});

test('repeated database failures open the breaker and report one degraded state', async t => {
  let calls = 0;
  let healthy = false;
  const { service, spooled } = await createService(t, async args => {
    calls++;
    if (!healthy) throw new Error('database unavailable');
    return inserted(args);
  });
  silenceStdout(t);
  const threshold = service.limits.breakerFailureThreshold;
  for (let index = 0; index < threshold; index++) {
    await service.write({ eventName: 'runtime.info', metadata: { index } });
  }
  t.is(calls, threshold);
  t.true(service.ingestionStatus().breakerOpen);

  // While open, new events go straight to spool and the backlog is not replayed.
  await service.write({ eventName: 'runtime.info' });
  t.is(await service.flushSpool(), 0);
  t.is(calls, threshold);
  await waitFor(async () =>
    (await spooled()).some(
      record => record.eventName === 'log.ingestion.degraded'
    )
  );
  const records = await spooled();
  t.is(
    records.filter(record => record.eventName === 'log.ingestion.degraded')
      .length,
    1
  );
  t.is(
    records.filter(record => record.eventName === 'runtime.info').length,
    threshold + 1
  );

  // After the backoff a single probe succeeds and closes the breaker.
  healthy = true;
  (service as any).breakerOpenUntil = 0;
  await service.write({ eventName: 'runtime.info' });
  t.false(service.ingestionStatus().breakerOpen);
  t.is(service.ingestionStatus().degradedSince, undefined);
  t.true((await service.flushSpool()) > 0);
});

test('a failed probe keeps the breaker open with a longer backoff', async t => {
  const { service } = await createService(t, async () => {
    throw new Error('database unavailable');
  });
  silenceStdout(t);
  for (let index = 0; index < service.limits.breakerFailureThreshold; index++) {
    await service.write({ eventName: 'runtime.info' });
  }
  const initial = (service as any).breakerOpenMs as number;
  (service as any).breakerOpenUntil = 0;
  await service.write({ eventName: 'runtime.info' });
  t.true(service.ingestionStatus().breakerOpen);
  t.is((service as any).breakerOpenMs, initial * 2);
  t.true((service as any).breakerOpenUntil > Date.now());
});

test('window summaries carry bounded failure and drop counters', async t => {
  const written: Prisma.LocalMindLogEventCreateManyInput[] = [];
  const { service } = await createService(t, async args => {
    const data = Array.isArray(args.data) ? args.data : [args.data];
    written.push(...data);
    return inserted(args);
  });
  silenceStdout(t);
  service.limits.maxInFlightRecords = 0;
  await service.write({ eventName: 'runtime.info' });
  await service.write({ eventName: 'runtime.info' });
  service.limits.maxInFlightRecords = 1_000;
  t.false(await service.flushIngestionSummary());
  t.true(
    await service.flushIngestionSummary(
      Date.now() + service.limits.summaryIntervalMs
    )
  );
  const summary = written.find(
    record => record.eventName === 'log.ingestion.summary'
  );
  t.like(summary?.metadata, { dropped: { admission: 2 }, failures: 0 });
  t.deepEqual(service.ingestionStatus().window.dropped, {});
});

test('stdout mirror is skipped and counted while its queue is full', async t => {
  const { service } = await createService(t, inserted);
  const stdout = silenceStdout(t);
  Object.defineProperty(process.stdout, 'writableLength', {
    configurable: true,
    get: () => service.limits.mirrorMaxQueuedBytes + 1,
  });
  t.teardown(() => {
    delete (process.stdout as { writableLength?: number }).writableLength;
  });
  await service.write({ eventName: 'runtime.info' });
  await service.write({ eventName: 'runtime.info' });
  t.is(stdout.mock.callCount(), 0);
  t.is(service.ingestionStatus().window.mirrorSkipped, 2);

  delete (process.stdout as { writableLength?: number }).writableLength;
  await service.write({ eventName: 'runtime.info' });
  const lines = stdout.mock.calls.map(call =>
    JSON.parse(String(call.arguments[0]))
  );
  t.like(lines[0], {
    eventName: 'log.mirror.skipped',
    metadata: { skipped: 2 },
  });
  t.is(lines[1].eventName, 'runtime.info');
});

test('debug events are persisted only when explicitly enabled', t => {
  const captured: LocalMindLogInput[] = [];
  LocalMindLogService.registerSink(input => captured.push(input));
  t.teardown(() => LocalMindLogService.registerSink(() => undefined));
  const previous = process.env.LOCALMIND_LOG_PERSIST_DEBUG;
  t.teardown(() => {
    if (previous === undefined) delete process.env.LOCALMIND_LOG_PERSIST_DEBUG;
    else process.env.LOCALMIND_LOG_PERSIST_DEBUG = previous;
  });
  delete process.env.LOCALMIND_LOG_PERSIST_DEBUG;
  LocalMindLogService.emit({ eventName: 'logger.debug', severity: 'debug' });
  LocalMindLogService.emit({ eventName: 'logger.log', severity: 'info' });
  process.env.LOCALMIND_LOG_PERSIST_DEBUG = 'true';
  LocalMindLogService.emit({ eventName: 'logger.debug', severity: 'debug' });
  t.deepEqual(
    captured.map(input => input.eventName),
    ['logger.log', 'logger.debug']
  );
});

test('HTTP completions skip successes recorded by other layers', t => {
  t.false(shouldPersistHttpCompletion('/graphql', 200, 20));
  t.false(shouldPersistHttpCompletion('/api/logs/batch', 201, 20));
  t.false(shouldPersistHttpCompletion('/info', 200, 5));
  t.true(shouldPersistHttpCompletion('/graphql', 500, 20));
  t.true(shouldPersistHttpCompletion('/api/logs/batch', 401, 20));
  t.true(shouldPersistHttpCompletion('/graphql', 200, 3_000));
  t.true(shouldPersistHttpCompletion('/workspace/abc/all', 200, 20));
});

test('GraphQL summaries aggregate per operation with bounded keys', t => {
  const captured: LocalMindLogInput[] = [];
  LocalMindLogService.registerSink(input => captured.push(input));
  t.teardown(() => LocalMindLogService.registerSink(() => undefined));
  const summary = new GraphQLCompletionSummary();
  for (let duration = 1; duration <= 100; duration++) {
    summary.record('getDocRolePermissions', duration);
  }
  for (let index = 0; index < 250; index++) {
    summary.record(`client-op-${index}`, 5);
  }
  summary.flush();
  const permissions = captured.find(
    input =>
      (input.metadata as { operation?: string }).operation ===
      'getDocRolePermissions'
  );
  t.like(permissions?.metadata, {
    count: 100,
    p50Ms: 50,
    p95Ms: 95,
    maxMs: 100,
  });
  t.is(captured.length, 201);
  t.like(
    captured.find(
      input =>
        (input.metadata as { operation?: string }).operation === '__other__'
    )?.metadata,
    { count: 51 }
  );
  summary.flush();
  t.is(captured.length, 201);
});

test('scheduled retention cleanup logs the failure instead of swallowing it', async t => {
  const { service } = await createService(t, inserted);
  silenceStdout(t);
  const cleanup = mock.method(service, 'cleanupRetention', async () => {
    throw new Error(
      'LOCALMIND_LOG_RETENTION_BATCH_TIMEOUT: canceling statement due to statement timeout'
    );
  });
  t.teardown(() => cleanup.mock.restore());
  const logged = mock.method((service as any).logger, 'error', () => undefined);
  t.teardown(() => logged.mock.restore());
  await service.scheduledRetentionCleanup();
  t.is(logged.mock.callCount(), 1);
  t.regex(
    String(logged.mock.calls[0].arguments[0]),
    /Scheduled log retention cleanup failed: Error: LOCALMIND_LOG_RETENTION_BATCH_TIMEOUT/
  );
});

function spoolRecord(eventId: string, eventName = 'runtime.info') {
  return {
    eventId,
    occurredAt: new Date().toISOString(),
    instanceId: 'test',
    nodeId: 'test',
    service: 'backend',
    severity: 'info',
    eventName,
    retentionClass: 'runtime',
  };
}

test('spool replay retries a deterministic batch failure record by record', async t => {
  const stored: string[] = [];
  const { service, directory } = await createService(t, async args => {
    const data = Array.isArray(args.data) ? args.data : [args.data];
    // The batch fails because one record conflicts; alone, only that one does.
    if (data.some(record => record.eventId === 'conflict')) {
      throw new Prisma.PrismaClientKnownRequestError(
        'duplicate LocalMind log event_id: conflict',
        { code: 'P2002', clientVersion: 'test' }
      );
    }
    if (data.some(record => record.eventId === 'bad')) {
      throw new Prisma.PrismaClientKnownRequestError('invalid input syntax', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '22P02' },
      });
    }
    stored.push(...data.map(record => record.eventId));
    return data.map(record => ({ eventId: record.eventId }));
  });
  silenceStdout(t);
  const spool = new LocalMindLogSpool(directory);
  for (const id of ['a', 'a', 'conflict', 'bad', 'b']) {
    await spool.append(spoolRecord(id));
  }

  t.is(await service.flushSpool(), 4);
  t.deepEqual(stored.sort(), ['a', 'b']);
  t.deepEqual(await spool.list(), []);
  t.is((await spool.list(10)).length, 0);
  t.deepEqual(service.ingestionStatus().window.dropped, {
    spool_duplicate_files: 1,
    spool_quarantined: 1,
  });
});

test('spool replay keeps every file on a transient failure', async t => {
  let calls = 0;
  const { service, directory } = await createService(t, async () => {
    calls++;
    throw new Prisma.PrismaClientKnownRequestError("Can't reach database", {
      code: 'P1001',
      clientVersion: 'test',
    });
  });
  silenceStdout(t);
  const spool = new LocalMindLogSpool(directory);
  for (const id of ['a', 'b', 'c']) await spool.append(spoolRecord(id));
  t.is(await service.flushSpool(), 0);
  // One batch attempt, no record-by-record retry, nothing quarantined.
  t.is(calls, 1);
  t.is((await spool.list()).length, 3);
  t.deepEqual(service.ingestionStatus().window.dropped, {});
});
