import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';

import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { LocalMindLogService } from '../localmind-log-service';

const db = new PrismaClient();
const otherDb = new PrismaClient();
const service = new LocalMindLogService(db);
const otherService = new LocalMindLogService(otherDb);
const eventIds: string[] = [];
function eventId() {
  const id = randomUUID();
  eventIds.push(id);
  return id;
}

test.after.always(async () => {
  // Remove only the fixture events created by this suite.
  try {
    await db.localMindLogEvent.deleteMany({
      where: { eventId: { in: eventIds } },
    });
    await db.localMindLogArchive.deleteMany({
      where: { eventId: { in: eventIds } },
    });
  } finally {
    await Promise.all([db.$disconnect(), otherDb.$disconnect()]);
  }
});

test.serial(
  'partitioned log ingestion deduplicates overlapping batches from independent pools',
  async t => {
    const events = Array.from({ length: 20 }, () => ({
      eventId: eventId(),
      eventName: 'test.log.ingestion',
    }));
    const stdout = mock.method(process.stdout, 'write', () => true);
    t.teardown(() => stdout.mock.restore());
    const receipts = await Promise.all([
      service.writeBatch(events),
      otherService.writeBatch([...events].reverse()),
    ]);
    t.is(receipts[0].length, 20);
    t.is(receipts[1].length, 20);
    t.is(
      await db.localMindLogEvent.count({
        where: { eventId: { in: events.map(event => event.eventId) } },
      }),
      20
    );
    t.is(stdout.mock.callCount(), 20);
  }
);

test.serial(
  'runtime log replay preserves the first event and avoids duplicate stdout mirrors',
  async t => {
    const id = eventId();
    const stdout = mock.method(process.stdout, 'write', () => true);
    t.teardown(() => stdout.mock.restore());
    await service.write({
      eventId: id,
      eventName: 'test.log.first',
      message: 'first value',
    });
    await otherService.write({
      eventId: id,
      eventName: 'test.log.replay',
      message: 'replayed value',
    });
    const records = await db.localMindLogEvent.findMany({
      where: { eventId: id },
    });
    t.is(records.length, 1);
    t.is(records[0].eventName, 'test.log.first');
    t.is(records[0].messageTemplate, 'first value');
    t.is(stdout.mock.callCount(), 1);
  }
);

test.serial(
  'a receipt for an archived event does not recreate a live log',
  async t => {
    const id = eventId();
    await db.localMindLogArchive.create({
      data: {
        eventId: id,
        occurredAt: new Date(),
        retentionClass: 'runtime',
        payload: { fixture: true },
      },
    });
    const stdout = mock.method(process.stdout, 'write', () => true);
    t.teardown(() => stdout.mock.restore());
    t.deepEqual(
      await service.writeBatch([
        { eventId: id, eventName: 'test.log.archived' },
      ]),
      [id]
    );
    t.is(await db.localMindLogEvent.count({ where: { eventId: id } }), 0);
    t.is(stdout.mock.callCount(), 0);
  }
);
