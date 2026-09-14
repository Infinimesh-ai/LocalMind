import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import test from 'ava';

import { LocalMindLogService } from '../localmind-log-service';
import { redact } from '../redactor';
import { LocalMindLogSpool } from '../spool';

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
  const tx = {
    localMindLogEvent: { create: async () => writes.push('log') },
    localMindAuditEnvelope: {
      create: async () => {
        persistedAudit = 'audit-1';
        writes.push('audit');
      },
    },
  };
  const prisma = {
    localMindAuditEnvelope: {
      findUnique: async () =>
        persistedAudit ? { auditEventId: persistedAudit } : null,
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
    }),
    'audit-1'
  );
  t.deepEqual(writes, ['log', 'audit']);
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
