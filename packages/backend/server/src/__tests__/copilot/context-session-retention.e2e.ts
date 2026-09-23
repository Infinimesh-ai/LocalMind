import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { LocalMindLogService } from '../../base';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;

test.before(async () => {
  app = await createTestingApp();
});

test.beforeEach(async () => {
  await app.initTestingDB();
});

test.after.always(async () => {
  await app.close();
});

test.serial(
  'retention archive verifies a private signed copy before removing hot rows',
  async t => {
    const db = app.get(PrismaClient);
    const logs = app.get(LocalMindLogService);
    const archiveDirectory = await mkdtemp(
      join(tmpdir(), 'localmind-retention-archive-')
    );
    t.teardown(() => rm(archiveDirectory, { recursive: true, force: true }));
    const previousArchiveDirectory = process.env.LOCALMIND_AUDIT_ARCHIVE_DIR;
    const previousActiveKeyVersion =
      process.env.LOCALMIND_AUDIT_ARCHIVE_ACTIVE_KEY_VERSION;
    const previousKeys = process.env.LOCALMIND_AUDIT_ARCHIVE_KEYS;
    t.teardown(() => {
      if (previousArchiveDirectory === undefined)
        delete process.env.LOCALMIND_AUDIT_ARCHIVE_DIR;
      else process.env.LOCALMIND_AUDIT_ARCHIVE_DIR = previousArchiveDirectory;
      if (previousActiveKeyVersion === undefined)
        delete process.env.LOCALMIND_AUDIT_ARCHIVE_ACTIVE_KEY_VERSION;
      else
        process.env.LOCALMIND_AUDIT_ARCHIVE_ACTIVE_KEY_VERSION =
          previousActiveKeyVersion;
      if (previousKeys === undefined)
        delete process.env.LOCALMIND_AUDIT_ARCHIVE_KEYS;
      else process.env.LOCALMIND_AUDIT_ARCHIVE_KEYS = previousKeys;
    });
    process.env.LOCALMIND_AUDIT_ARCHIVE_DIR = archiveDirectory;
    process.env.LOCALMIND_AUDIT_ARCHIVE_ACTIVE_KEY_VERSION = 'test-v1';
    process.env.LOCALMIND_AUDIT_ARCHIVE_KEYS = JSON.stringify({
      'test-v1': 'retention-archive-test-key-material',
    });
    const occurredAt = new Date('2020-01-01T00:00:00.000Z');
    await db.localMindLogPolicy.create({
      data: {
        id: 'default',
        runtimeRetentionDays: 30,
        auditRetentionDays: 365,
      },
    });
    await db.localMindLogEvent.createMany({
      data: [
        {
          id: 'runtime-row',
          eventId: 'runtime-event',
          occurredAt,
          instanceId: 'test',
          nodeId: 'test',
          service: 'backend',
          severity: 'info',
          eventName: 'runtime.old',
          metadata: { bounded: true },
          retentionClass: 'runtime',
        },
        {
          id: 'audit-row',
          eventId: 'audit-event',
          occurredAt,
          instanceId: 'test',
          nodeId: 'test',
          service: 'backend',
          severity: 'info',
          eventName: 'audit.session.delete',
          metadata: { resultCount: 1 },
          retentionClass: 'audit',
        },
      ],
    });
    await db.localMindAuditEnvelope.create({
      data: {
        id: 'audit-envelope',
        auditEventId: 'audit-event',
        eventId: 'audit-event',
        action: 'session.delete',
        outcome: 'success',
        fingerprint: 'a'.repeat(64),
        metadata: { resultCount: 1 },
        occurredAt,
      },
    });

    const result = await logs.archiveRetention(
      new Date('2026-01-01T00:00:00.000Z')
    );
    t.is(result.archived, 2);
    if (!('batchId' in result)) {
      t.fail('retention archive did not return a persisted batch');
      return;
    }
    t.true(result.verified);
    t.is(await db.localMindLogEvent.count(), 0);
    t.is(await db.localMindAuditEnvelope.count(), 0);
    const batch = await db.localMindLogArchiveBatch.findUniqueOrThrow({
      where: { id: result.batchId },
    });
    t.is(batch.status, 'completed');
    t.is(batch.itemCount, 2);
    t.true((await logs.verifyArchiveBatch(batch.id)).verified);

    const archive = JSON.parse(await readFile(batch.archivePath!, 'utf8')) as {
      manifest: { entries: unknown[] };
    };
    archive.manifest.entries[0] = { tampered: true };
    await writeFile(batch.archivePath!, JSON.stringify(archive));
    await t.throwsAsync(() => logs.verifyArchiveBatch(batch.id), {
      message: 'LOCALMIND_AUDIT_ARCHIVE_FINGERPRINT_MISMATCH',
    });
    const emptyResult = await logs.archiveRetention(
      new Date('2026-01-01T00:00:00.000Z')
    );
    t.true(emptyResult.skipped);
    t.is(emptyResult.archived, 0);
    t.is(await db.localMindLogArchiveBatch.count(), 1);
  }
);
