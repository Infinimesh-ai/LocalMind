import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';

import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { localMindLogDatabaseUrl } from '../localmind-log-database';
import { LocalMindLogService } from '../localmind-log-service';
import { LocalMindLogSpool } from '../spool';

// Runs against the migrated database in DATABASE_URL. Cleanup removes every
// expired runtime row there, so use a disposable database.
const db = new PrismaClient();
const lockDb = new PrismaClient();
const DAY = 86_400_000;
const now = new Date();
const marker = `retention-${randomUUID()}`;

function createService(directory?: string) {
  const previous = process.env.LOCALMIND_LOG_SPOOL_DIR;
  if (directory) process.env.LOCALMIND_LOG_SPOOL_DIR = directory;
  const service = new LocalMindLogService(db);
  if (previous === undefined) delete process.env.LOCALMIND_LOG_SPOOL_DIR;
  else process.env.LOCALMIND_LOG_SPOOL_DIR = previous;
  return service;
}

async function seed(
  rows: { ageDays: number; severity?: string; retentionClass?: string }[]
) {
  const data = rows.map(row => ({
    id: randomUUID(),
    eventId: randomUUID(),
    occurredAt: new Date(now.getTime() - row.ageDays * DAY),
    instanceId: 'test',
    nodeId: 'test',
    service: 'backend',
    severity: row.severity ?? 'info',
    eventName: marker,
    retentionClass: row.retentionClass ?? 'runtime',
  }));
  await db.localMindLogEvent.createMany({ data });
  return data;
}

async function remaining() {
  return await db.localMindLogEvent.findMany({
    where: { eventName: marker },
    select: { eventId: true, severity: true, retentionClass: true },
  });
}

test.beforeEach(async () => {
  await db.localMindLogEvent.deleteMany({ where: { eventName: marker } });
  // Runs resume from the previous unfinished run; start each test clean.
  await db.localMindLogRetentionRun.deleteMany();
  await db.localMindLogPolicy.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: { legalHold: false, retentionFrozen: false },
  });
});

test.after.always(async () => {
  try {
    await db.localMindLogEvent.deleteMany({ where: { eventName: marker } });
  } finally {
    await Promise.all([db.$disconnect(), lockDb.$disconnect()]);
  }
});

test.serial(
  'retention deletes expired runtime rows in committed batches and records the run',
  async t => {
    const expired = await seed([
      ...Array.from({ length: 12 }, () => ({ ageDays: 45 })),
      { ageDays: 120, severity: 'error' },
    ]);
    const kept = await seed([
      { ageDays: 45, severity: 'error' },
      { ageDays: 45, severity: 'fatal' },
      { ageDays: 1 },
      { ageDays: 400, retentionClass: 'audit' },
    ]);
    const service = createService();
    service.limits.retentionInitialBatch = 5;
    service.limits.retentionMinBatch = 1;
    service.limits.retentionMaxBatch = 5;

    const result = await service.cleanupRetention(now, { trigger: 'manual' });
    t.like(result, {
      skipped: false,
      status: 'completed',
      complete: true,
    });
    t.true(result.deleted >= expired.length);
    t.true((result as { batches: number }).batches >= 3);
    t.deepEqual(
      (await remaining()).map(row => row.eventId).sort(),
      kept.map(row => row.eventId).sort()
    );
    const [registry] = await db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM "localmind_log_event_ids"
      WHERE "event_id" = ANY(${expired.map(row => row.eventId)})
    `;
    t.is(registry.count, 0);
    const run = await db.localMindLogRetentionRun.findUniqueOrThrow({
      where: { id: (result as { runId: string }).runId },
    });
    t.like(run, { status: 'completed', trigger: 'manual' });
    t.is(run.deleted, result.deleted);
    t.truthy(run.finishedAt);
  }
);

test.serial(
  'retention stops at its row budget and reports partial progress',
  async t => {
    await seed(Array.from({ length: 6 }, () => ({ ageDays: 45 })));
    const service = createService();
    service.limits.retentionInitialBatch = 2;
    service.limits.retentionMinBatch = 2;
    service.limits.retentionMaxBatch = 2;
    service.limits.retentionRunMaxRows = 3;
    const result = await service.cleanupRetention(now);
    t.like(result, { status: 'partial', complete: false });
    t.is(result.deleted, 4);
    t.is((await remaining()).length, 2);
  }
);

test.serial('retention yields when another worker holds the lock', async t => {
  await seed([{ ageDays: 45 }]);
  const service = createService();
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  let locked!: () => void;
  const lockTaken = new Promise<void>(resolve => {
    locked = resolve;
  });
  const holder = lockDb.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('localmind_log_retention'))`;
      locked();
      await held;
    },
    { timeout: 30_000 }
  );
  await lockTaken;
  const result = await service.cleanupRetention(now);
  release();
  await holder;
  t.like(result, { skipped: true, status: 'contended', deleted: 0 });
  t.is((await remaining()).length, 1);
});

test.serial(
  'retention stops between batches once retention is frozen',
  async t => {
    await seed(Array.from({ length: 6 }, () => ({ ageDays: 45 })));
    const service = createService();
    service.limits.retentionInitialBatch = 2;
    service.limits.retentionMinBatch = 2;
    service.limits.retentionMaxBatch = 2;
    const paused = mock.method(service as any, 'retentionPaused', async () => {
      await db.localMindLogPolicy.update({
        where: { id: 'default' },
        data: { retentionFrozen: true },
      });
      return true;
    });
    t.teardown(() => paused.mock.restore());
    const result = await service.cleanupRetention(now);
    t.like(result, { skipped: true, status: 'paused', deleted: 2 });
    t.is((await remaining()).length, 4);
    // The next run observes the freeze before deleting anything.
    t.deepEqual(await service.cleanupRetention(now), {
      skipped: true,
      dryRun: false,
      deleted: 0,
    });
  }
);

async function withSlowDeletes(
  t: { teardown: (fn: () => unknown) => void },
  seconds: number
) {
  // Simulates cold storage: every deleted log row costs a fixed delay.
  await db.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION lm_test_slow_delete() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${seconds}); RETURN OLD; END $$
  `);
  await db.$executeRawUnsafe(
    'CREATE TRIGGER lm_test_slow_delete BEFORE DELETE ON localmind_log_events FOR EACH ROW EXECUTE FUNCTION lm_test_slow_delete()'
  );
  t.teardown(async () => {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS lm_test_slow_delete ON localmind_log_events'
    );
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS lm_test_slow_delete()');
  });
}

test.serial(
  'a timed-out batch is retried smaller and the run records batch timing',
  async t => {
    await seed(Array.from({ length: 30 }, () => ({ ageDays: 45 })));
    await withSlowDeletes(t, 0.01);
    const service = createService();
    service.limits.retentionInitialBatch = 40;
    service.limits.retentionMinBatch = 4;
    service.limits.retentionMaxBatch = 10;
    service.limits.retentionStatementTimeoutMs = 200;
    service.limits.retentionBatchTimeoutMs = 2_000;

    const result = await service.cleanupRetention(now);
    t.like(result, { status: 'completed', complete: true });
    t.true((result as { batchTimeouts: number }).batchTimeouts >= 1);
    t.is((await remaining()).length, 0);
    const run = await db.localMindLogRetentionRun.findUniqueOrThrow({
      where: { id: (result as { runId: string }).runId },
    });
    t.is(run.status, 'completed');
    t.true(run.batchTimeouts >= 1);
    t.true((run.lastBatchSize ?? 0) <= 10);
    t.true((run.maxBatchMs ?? 0) > 0);
    t.regex(run.failureMessage ?? '', /statement timeout/i);
  }
);

test.serial(
  'a run fails with a timeout code when even the smallest batch is too slow',
  async t => {
    await seed(Array.from({ length: 8 }, () => ({ ageDays: 45 })));
    await withSlowDeletes(t, 0.02);
    const service = createService();
    service.limits.retentionInitialBatch = 16;
    service.limits.retentionMinBatch = 4;
    service.limits.retentionStatementTimeoutMs = 30;
    service.limits.retentionBatchTimeoutMs = 2_000;

    await t.throwsAsync(service.cleanupRetention(now), {
      message: /LOCALMIND_LOG_RETENTION_BATCH_TIMEOUT/,
    });
    const [run] = await db.localMindLogRetentionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 1,
    });
    t.like(run, {
      status: 'failed',
      failureCode: 'LOCALMIND_LOG_RETENTION_BATCH_TIMEOUT',
      batches: 0,
    });
    t.is(run.batchTimeouts, 2);
    t.regex(run.failureMessage ?? '', /statement timeout/i);
    // Rolled-back batches deleted nothing.
    t.is((await remaining()).length, 8);
  }
);

test.serial(
  'an unfinished run is continued by the next run, a completed run resets',
  async t => {
    // Two kept failures first, then four deletable rows.
    await seed([
      { ageDays: 50, severity: 'error' },
      { ageDays: 49, severity: 'error' },
      { ageDays: 45 },
      { ageDays: 44 },
      { ageDays: 43 },
      { ageDays: 42 },
    ]);
    const service = createService();
    service.limits.retentionInitialBatch = 2;
    service.limits.retentionMinBatch = 2;
    service.limits.retentionMaxBatch = 2;
    service.limits.retentionRunMaxRows = 2;

    const first = await service.cleanupRetention(now);
    t.like(first, { status: 'partial', deleted: 2 });
    t.is(first.scanned, 4);

    // Resumes after the cursor: the kept failures are not scanned again.
    service.limits.retentionRunMaxRows = 100;
    const second = await service.cleanupRetention(now);
    t.like(second, { status: 'completed', deleted: 2 });
    t.is(second.scanned, 2);

    // After a completed run the next one starts from the beginning again.
    const third = await service.cleanupRetention(now);
    t.like(third, { status: 'completed', deleted: 0 });
    t.is(third.scanned, 2);
    t.is((await remaining()).length, 2);
  }
);

test.serial(
  'dry-run counts are bounded and archive keeps recent failures',
  async t => {
    await seed([
      ...Array.from({ length: 5 }, () => ({ ageDays: 45 })),
      { ageDays: 45, severity: 'error' },
    ]);
    const service = createService();
    service.limits.retentionDryRunCountLimit = 3;
    t.like(await service.cleanupRetention(now, { dryRun: true }), {
      dryRun: true,
      deleted: 3,
      bounded: true,
    });
    const archivable = await db.localMindLogEvent.count({
      where: {
        eventName: marker,
        OR: [
          { severity: { notIn: ['error', 'fatal'] } },
          { occurredAt: { lt: new Date(now.getTime() - 90 * DAY) } },
        ],
      },
    });
    const dryRun = await service.archiveRetention(now, { dryRun: true });
    t.is(dryRun.archived, Math.min(archivable, 1000));
    t.is((await remaining()).length, 6);
  }
);

test.serial(
  'spool replay writes batches, quarantines corrupt files and adopts legacy PID spools',
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'localmind-replay-'));
    t.teardown(() => rm(root, { recursive: true, force: true }));
    const previous = process.env.LOCALMIND_DATA_DIR;
    process.env.LOCALMIND_DATA_DIR = root;
    t.teardown(() => {
      if (previous === undefined) delete process.env.LOCALMIND_DATA_DIR;
      else process.env.LOCALMIND_DATA_DIR = previous;
    });
    const legacy = new LocalMindLogSpool(join(root, 'logs', 'spool', '1'));
    const ids = Array.from({ length: 3 }, () => randomUUID());
    for (const eventId of ids) {
      await legacy.append({
        eventId,
        occurredAt: now.toISOString(),
        instanceId: 'test',
        nodeId: '1',
        service: 'backend',
        severity: 'info',
        eventName: marker,
        retentionClass: 'runtime',
      });
    }
    await writeFile(join(legacy.directory, '0-corrupt.json'), '{not json');
    const service = createService();
    const stdout = mock.method(process.stdout, 'write', () => true);
    t.teardown(() => stdout.mock.restore());

    t.is(await service.flushSpool(), 3);
    t.deepEqual(
      (await remaining()).map(row => row.eventId).sort(),
      [...ids].sort()
    );
    const current = join(root, 'logs', 'spool', 'primary');
    t.deepEqual(await readdir(join(current, 'quarantine')), ['0-corrupt.json']);
    t.deepEqual(
      (await readdir(current)).filter(name => name.endsWith('.json')),
      []
    );
    await t.throwsAsync(() => readdir(legacy.directory));
  }
);

test.serial(
  'first writes of server-generated events reach the table in one batch',
  async t => {
    const service = createService(
      await mkdtemp(join(tmpdir(), 'localmind-fresh-'))
    );
    const stdout = mock.method(process.stdout, 'write', () => true);
    t.teardown(() => stdout.mock.restore());
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        service.write({ eventName: marker, metadata: { index } })
      )
    );
    t.is((await remaining()).length, 5);
    t.is(
      stdout.mock.calls.filter(call =>
        String(call.arguments[0]).includes(marker)
      ).length,
      5
    );
  }
);

test.serial(
  'spool replay writes repeated client events once and quarantines bad records',
  async t => {
    const directory = await mkdtemp(join(tmpdir(), 'localmind-dup-replay-'));
    t.teardown(() => rm(directory, { recursive: true, force: true }));
    const spool = new LocalMindLogSpool(directory);
    const record = (eventId: string, occurredAt = now.toISOString()) => ({
      eventId,
      occurredAt,
      instanceId: 'test',
      nodeId: 'test',
      service: 'backend',
      severity: 'debug',
      eventName: marker,
      retentionClass: 'runtime',
    });
    // A client retried its upload: the same event ID was spooled three times.
    const repeated = randomUUID();
    const single = randomUUID();
    for (let index = 0; index < 3; index++) {
      await spool.append(record(repeated));
    }
    await spool.append(record(single));
    await spool.append(record(randomUUID(), 'not a date'));
    const service = createService(directory);
    const stdout = mock.method(process.stdout, 'write', () => true);
    t.teardown(() => stdout.mock.restore());

    t.is(await service.flushSpool(), 4);
    t.deepEqual(
      (await remaining()).map(row => row.eventId).sort(),
      [repeated, single].sort()
    );
    t.deepEqual(
      (await readdir(directory)).filter(name => name.endsWith('.json')),
      []
    );
    t.is((await readdir(join(directory, 'quarantine'))).length, 1);
    // The next replay has nothing left to retry.
    t.is(await service.flushSpool(), 0);
  }
);

test.serial(
  'a replayed event already registered elsewhere is treated as stored',
  async t => {
    const directory = await mkdtemp(join(tmpdir(), 'localmind-registered-'));
    t.teardown(() => rm(directory, { recursive: true, force: true }));
    const registered = randomUUID();
    const fresh = randomUUID();
    // Only the global registry knows this ID, so the pre-insert lookup misses
    // it and the registry trigger rejects the insert with a real error.
    await db.$executeRaw`
      INSERT INTO localmind_log_event_ids (event_id, log_id, occurred_at)
      VALUES (${registered}, ${randomUUID()}, ${now})
    `;
    t.teardown(
      () =>
        db.$executeRaw`DELETE FROM localmind_log_event_ids WHERE event_id = ${registered}`
    );
    const spool = new LocalMindLogSpool(directory);
    for (const eventId of [registered, fresh]) {
      await spool.append({
        eventId,
        occurredAt: now.toISOString(),
        instanceId: 'test',
        nodeId: 'test',
        service: 'backend',
        severity: 'info',
        eventName: marker,
        retentionClass: 'runtime',
      });
    }
    const service = createService(directory);
    const stdout = mock.method(process.stdout, 'write', () => true);
    t.teardown(() => stdout.mock.restore());

    t.is(await service.flushSpool(), 2);
    t.deepEqual(
      (await remaining()).map(row => row.eventId),
      [fresh]
    );
    t.deepEqual(
      (await readdir(directory)).filter(name => name.endsWith('.json')),
      []
    );
  }
);

test('log pool URLs carry an explicit small connection limit', t => {
  const url = localMindLogDatabaseUrl(
    'postgresql://user:pass@db:5432/affine?sslmode=disable',
    2
  );
  t.truthy(url);
  const parsed = new URL(url as string);
  t.is(parsed.searchParams.get('connection_limit'), '2');
  t.is(parsed.searchParams.get('pool_timeout'), '5');
  t.is(parsed.searchParams.get('sslmode'), 'disable');
  t.is(localMindLogDatabaseUrl('not a url'), undefined);
});
