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
