import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';

import { Prisma } from '@prisma/client';
import test from 'ava';

import { ObservabilityController } from '../../../core/observability/controller';
import {
  createLocalMindLogArchiveEnvelope,
  LOCALMIND_LOG_ARCHIVE_SCHEMA,
  readAndVerifyLocalMindLogArchiveEnvelope,
  verifyLocalMindLogArchiveEnvelope,
  writeLocalMindLogArchiveEnvelope,
} from '../localmind-log-archive';
import { LocalMindLogService } from '../localmind-log-service';
import { redact } from '../redactor';
import { LocalMindLogSpool } from '../spool';

function runtimePrisma(
  events: {
    createManyAndReturn: (
      args: Prisma.LocalMindLogEventCreateManyAndReturnArgs
    ) => Promise<{ eventId: string }[]>;
  },
  accepted: () => string[] = () => []
) {
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => accepted().map(eventId => ({ eventId })),
    localMindLogEvent: { ...events, findMany: async () => [] },
    localMindLogArchive: { findMany: async () => [] },
  };
  return {
    $transaction: async (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  };
}

test('log queries treat nullable GraphQL filters as absent', async t => {
  const prisma = {
    localMindLogEvent: {
      findMany: async (args: Prisma.LocalMindLogEventFindManyArgs) => {
        t.false(JSON.stringify(args.where).includes('null'));
        t.is(args.take, 100);
        return [];
      },
    },
  };
  const service = new LocalMindLogService(
    prisma as unknown as ConstructorParameters<typeof LocalMindLogService>[0]
  );
  t.deepEqual(
    await service.query({
      from: null,
      to: null,
      severity: null,
      service: null,
      component: null,
      eventName: null,
      requestId: null,
      traceId: null,
      workspaceId: null,
      projectId: null,
      runId: null,
      jobId: null,
      status: null,
      errorCode: null,
      keyword: null,
      limit: null,
    }),
    []
  );
});

test('log queries preserve explicit filters and bounded limits', async t => {
  const prisma = {
    localMindLogEvent: {
      findMany: async (args: Prisma.LocalMindLogEventFindManyArgs) => {
        t.is(args.where?.severity, 'error');
        t.is(args.where?.requestId, 'request-1');
        t.is(args.where?.projectId, 'project-1');
        t.is(args.take, 1000);
        return [];
      },
    },
  };
  const service = new LocalMindLogService(
    prisma as unknown as ConstructorParameters<typeof LocalMindLogService>[0]
  );
  await service.query({
    severity: 'error',
    requestId: 'request-1',
    projectId: 'project-1',
    limit: 2000,
  });
});

test('redactor removes sensitive keys and bounds strings', t => {
  const value = redact({
    apiKey: 'secret',
    nested: { password: 'pw' },
    message: 'ok',
  }) as Record<string, unknown>;
  t.is(value.apiKey, '[redacted]');
  t.deepEqual(value.nested, { password: '[redacted]' });
  t.is(value.message, 'ok');
  t.is(redact('Bearer abcdefghijkl') as string, '[redacted]');
  const error = redact(new Error('prompt body leaked')) as Record<
    string,
    unknown
  >;
  t.is(error.message, '[redacted]');
});

test('spool writes atomically with checksum and can recover records', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-spool-'));
  const spool = new LocalMindLogSpool(directory);
  await spool.append({ eventId: 'evt-1', metadata: { value: 1 } });
  const files = await spool.list();
  t.is(files.length, 1);
  t.deepEqual(await spool.read(files[0]), {
    eventId: 'evt-1',
    metadata: { value: 1 },
  });
  t.true((await readFile(files[0], 'utf8')).includes('checksum'));
});

test('spool rejects a corrupted batch after process restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-spool-corrupt-'));
  const spool = new LocalMindLogSpool(directory);
  await spool.append({ eventId: 'evt-corrupt', metadata: { value: 1 } });
  const [file] = await spool.list();
  const parsed = JSON.parse(await readFile(file, 'utf8')) as {
    checksum: string;
    record: Record<string, unknown>;
  };
  parsed.record.metadata = { value: 2 };
  await writeFile(file, JSON.stringify(parsed));
  await t.throwsAsync(() => spool.read(file), {
    message: 'spool checksum mismatch',
  });
});

test('audit writes log and immutable envelope in one transaction', async t => {
  const writes: string[] = [];
  let persistedAudit: string | null = null;
  let persistedFingerprint: string | null = null;
  const tx = {
    localMindLogEvent: { create: async () => writes.push('log') },
    localMindAuditEnvelope: {
      create: async (args: Prisma.LocalMindAuditEnvelopeCreateArgs) => {
        persistedAudit = 'audit-1';
        persistedFingerprint = args.data.fingerprint;
        writes.push('audit');
      },
    },
  };
  const prisma = {
    localMindAuditEnvelope: {
      findUnique: async () =>
        persistedAudit
          ? {
              auditEventId: persistedAudit,
              fingerprint: persistedFingerprint,
            }
          : null,
    },
    $transaction: async (callback: (value: typeof tx) => Promise<void>) =>
      callback(tx),
  };
  const service = new LocalMindLogService(prisma as any);
  const id = await service.writeAudit({
    auditEventId: 'audit-1',
    action: 'settings.update',
    outcome: 'success',
    metadata: { apiKey: 'hidden' },
  });
  t.is(id, 'audit-1');
  t.deepEqual(writes, ['log', 'audit']);
  t.is(
    await service.writeAudit({
      auditEventId: 'audit-1',
      action: 'settings.update',
      outcome: 'success',
      metadata: { apiKey: 'hidden' },
    }),
    'audit-1'
  );
  t.deepEqual(writes, ['log', 'audit']);
  await t.throwsAsync(
    () =>
      service.writeAudit({
        auditEventId: 'audit-1',
        action: 'settings.update',
        outcome: 'failure',
      }),
    { message: 'LOCALMIND_AUDIT_EVENT_ID_CONFLICT' }
  );
});

test('regular log replay checks durable events before insertion or mirroring', async t => {
  const prisma = runtimePrisma(
    {
      createManyAndReturn: async () => {
        t.fail('A durable replay must not be inserted');
        return [];
      },
    },
    () => ['replayed-event']
  );
  const stdout = mock.method(process.stdout, 'write', () => true);
  t.teardown(() => stdout.mock.restore());
  const service = new LocalMindLogService(prisma as any);
  t.is(
    await service.write({ eventId: 'replayed-event', eventName: 'client.log' }),
    'replayed-event'
  );
  t.is(stdout.mock.callCount(), 0);
});

test('client ingestion uses a single bounded insert and mirrors only new events', async t => {
  const persisted = new Set<string>(['existing']);
  let inserts = 0;
  const prisma = runtimePrisma(
    {
      createManyAndReturn: async (
        args: Prisma.LocalMindLogEventCreateManyAndReturnArgs
      ) => {
        inserts++;
        t.true(args.skipDuplicates);
        const data = Array.isArray(args.data) ? args.data : [args.data];
        t.true(data.length <= 100);
        t.false(JSON.stringify(data).includes('private-key'));
        return data
          .filter(record => !persisted.has(record.eventId))
          .map(record => {
            persisted.add(record.eventId);
            return { eventId: record.eventId };
          });
      },
    },
    () => [...persisted]
  );
  const service = new LocalMindLogService(
    prisma as unknown as ConstructorParameters<typeof LocalMindLogService>[0]
  );
  const stdout = mock.method(process.stdout, 'write', () => true);
  t.teardown(() => stdout.mock.restore());
  const controller = new ObservabilityController(service);
  const events = Array.from({ length: 200 }, (_, index) => ({
    eventId: index === 0 ? 'existing' : `event-${index}`,
    eventName: 'client.log',
    metadata: { apiKey: 'private-key' },
  }));
  const receipt = await controller.ingest({ events });
  t.is(receipt.accepted, 100);
  t.is(inserts, 1);
  t.is(stdout.mock.callCount(), 99);
  t.deepEqual(await controller.ingest({ events }), receipt);
  t.is(inserts, 1);
  t.is(stdout.mock.callCount(), 99);
});

test('batch receipts acknowledge durable spool records during a database outage', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-batch-spool-'));
  t.teardown(() => rm(directory, { recursive: true, force: true }));
  const previous = process.env.LOCALMIND_LOG_SPOOL_DIR;
  process.env.LOCALMIND_LOG_SPOOL_DIR = directory;
  let inserts = 0;
  const service = new LocalMindLogService(
    runtimePrisma({
      createManyAndReturn: async () => {
        inserts++;
        throw new Error('database unavailable');
      },
    }) as unknown as ConstructorParameters<typeof LocalMindLogService>[0]
  );
  if (previous === undefined) delete process.env.LOCALMIND_LOG_SPOOL_DIR;
  else process.env.LOCALMIND_LOG_SPOOL_DIR = previous;
  t.deepEqual(
    await service.writeBatch([
      { eventId: 'spooled-1', eventName: 'client.log' },
      {
        eventId: 'spooled-2',
        eventName: 'client.log',
        metadata: { token: 'private-key' },
      },
    ]),
    ['spooled-1', 'spooled-2']
  );
  t.is(inserts, 1);
  const spool = new LocalMindLogSpool(directory);
  const records = await Promise.all(
    (await spool.list()).map(file => spool.read(file))
  );
  t.deepEqual(
    records
      .filter(record => record.eventName === 'client.log')
      .map(record => record.eventId)
      .sort(),
    ['spooled-1', 'spooled-2']
  );
  t.false(JSON.stringify(records).includes('private-key'));
});

test('a full spool cannot acknowledge dropped client events', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-batch-full-'));
  t.teardown(() => rm(directory, { recursive: true, force: true }));
  const previousDirectory = process.env.LOCALMIND_LOG_SPOOL_DIR;
  const previousCapacity = process.env.LOCALMIND_LOG_SPOOL_MAX_BYTES;
  process.env.LOCALMIND_LOG_SPOOL_DIR = directory;
  process.env.LOCALMIND_LOG_SPOOL_MAX_BYTES = '1';
  const service = new LocalMindLogService(
    runtimePrisma({
      createManyAndReturn: async () => {
        throw new Error('database unavailable');
      },
    }) as unknown as ConstructorParameters<typeof LocalMindLogService>[0]
  );
  if (previousDirectory === undefined)
    delete process.env.LOCALMIND_LOG_SPOOL_DIR;
  else process.env.LOCALMIND_LOG_SPOOL_DIR = previousDirectory;
  if (previousCapacity === undefined)
    delete process.env.LOCALMIND_LOG_SPOOL_MAX_BYTES;
  else process.env.LOCALMIND_LOG_SPOOL_MAX_BYTES = previousCapacity;
  t.deepEqual(
    await service.writeBatch([
      { eventId: 'unaccepted', eventName: 'client.log' },
    ]),
    []
  );
  await t.throwsAsync(
    () =>
      service.writeBatch([
        { eventId: 'critical', eventName: 'client.error', severity: 'error' },
      ]),
    { name: 'SpoolCapacityError' }
  );
});

test('retention cleanup is fail-closed under legal hold or freeze', async t => {
  const policy = {
    id: 'default',
    runtimeRetentionDays: 30,
    failureRetentionDays: 90,
    traceRetentionDays: 14,
    auditRetentionDays: 365,
    spoolMaxBytes: BigInt(1024 * 1024),
    legalHold: false,
    retentionFrozen: true,
    frozenAt: new Date(),
    externalTelemetryEnabled: false,
    updatedAt: new Date(),
  };
  const prisma = {
    localMindLogPolicy: {
      upsert: async () => policy,
    },
  };
  const service = new LocalMindLogService(prisma as any);
  t.deepEqual(await service.cleanupRetention(), {
    skipped: true,
    dryRun: false,
    deleted: 0,
  });
  t.deepEqual(await service.archiveRetention(undefined, { dryRun: true }), {
    skipped: true,
    dryRun: true,
    archived: 0,
  });
});

test('signed archive detects tampering and preserves old keys during rotation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'localmind-archive-'));
  t.teardown(() => rm(directory, { recursive: true, force: true }));
  const oldKeys = {
    activeKeyVersion: '2026-09-a',
    keys: { '2026-09-a': 'a'.repeat(32) },
  };
  const envelope = createLocalMindLogArchiveEnvelope(
    {
      schemaVersion: LOCALMIND_LOG_ARCHIVE_SCHEMA,
      batchId: 'batch-1',
      instanceId: 'instance-1',
      createdAt: new Date(0).toISOString(),
      itemCount: 1,
      fromOccurredAt: new Date(0).toISOString(),
      toOccurredAt: new Date(0).toISOString(),
      entries: [{ eventId: 'event-1', metadata: { token: '[redacted]' } }],
    },
    oldKeys
  );
  const path = await writeLocalMindLogArchiveEnvelope(directory, envelope);
  t.is((await stat(directory)).mode & 0o777, 0o700);
  t.is((await stat(path)).mode & 0o777, 0o600);
  t.deepEqual(
    (await readAndVerifyLocalMindLogArchiveEnvelope(path, oldKeys))
      .verification,
    {
      fingerprint: envelope.fingerprint,
      keyVersion: '2026-09-a',
      itemCount: 1,
    }
  );

  const rotatedKeys = {
    activeKeyVersion: '2026-10-b',
    keys: {
      '2026-09-a': 'a'.repeat(32),
      '2026-10-b': 'b'.repeat(32),
    },
  };
  t.is(
    verifyLocalMindLogArchiveEnvelope(envelope, rotatedKeys).keyVersion,
    '2026-09-a'
  );

  const tampered = structuredClone(envelope);
  tampered.manifest.entries[0] = { eventId: 'event-1', metadata: 'changed' };
  t.throws(() => verifyLocalMindLogArchiveEnvelope(tampered, rotatedKeys), {
    message: 'LOCALMIND_AUDIT_ARCHIVE_FINGERPRINT_MISMATCH',
  });
});
