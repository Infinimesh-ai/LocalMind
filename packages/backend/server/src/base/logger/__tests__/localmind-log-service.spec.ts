import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import test from 'ava';

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

test('regular log replay treats event_id uniqueness as idempotent success', async t => {
  const prisma = {
    localMindLogEvent: {
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        });
      },
    },
  };
  const service = new LocalMindLogService(prisma as any);
  t.is(
    await service.write({ eventId: 'replayed-event', eventName: 'client.log' }),
    'replayed-event'
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
