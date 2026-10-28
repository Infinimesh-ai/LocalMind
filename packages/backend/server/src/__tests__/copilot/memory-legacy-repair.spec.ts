import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import ava, { type TestFn } from 'ava';

import { Models } from '../../models';
import { repairLegacyMemoryKeys } from '../../models/common/context-memory-legacy-repair';
import { createTestingModule, type TestingModule } from '../utils';

const test = ava.serial as TestFn<{
  module: TestingModule;
  models: Models;
  db: PrismaClient;
  userId: string;
  workspaceId: string;
}>;
test.before(async t => {
  t.context.module = await createTestingModule();
  t.context.models = t.context.module.get(Models);
  t.context.db = t.context.module.get(PrismaClient);
});
test.beforeEach(async t => {
  await t.context.module.initTestingDB();
  const user = await t.context.models.user.create({
    email: `${randomUUID()}@example.test`,
  });
  const workspace = await t.context.models.workspace.create(user.id);
  Object.assign(t.context, { userId: user.id, workspaceId: workspace.id });
});
test.after.always(async t => t.context.module.close());

for (const terminal of [null, 'disabled', 'deleted'] as const) {
  test(`repair independent historical facts while preserving ${terminal ?? 'no'} later terminal decision`, async t => {
    const { models, db, userId, workspaceId } = t.context;
    const base = {
      ownerUserId: userId,
      workspaceId,
      scope: 'workspace' as const,
      explicit: true,
      writerVersion: 'old/v1',
    };
    const write = (content: string, factKey = 'project:codename') =>
      models.copilotContextMemory.applyWriterDecision({
        ...base,
        decisionFingerprint: randomUUID(),
        decision: {
          operation: 'UPDATE',
          factKey,
          content,
          confidence: 1,
          importance: 0.5,
          sensitivity: 'private',
          reasonCode: 'explicit_user_directive',
        },
      });
    const first = await write('背景色代号是 AZURE');
    await write('布局代号是 COLUMN');
    if (terminal) {
      const later = await write('背景色代号是 VIOLET', 'fact:背景色代号');
      await db.aiContextMemory.update({
        where: { id: later.memoryId! },
        data: { status: terminal },
      });
    }
    const beforeEvents = await db.aiContextMemoryEvent.findMany({
      orderBy: { id: 'asc' },
    });
    const preview = await repairLegacyMemoryKeys(db);
    t.is(preview.applied, 0);
    t.is(
      preview.decisions.find(d => d.id === first.memoryId)?.restore,
      !terminal
    );
    const result = await repairLegacyMemoryKeys(db, {
      expectedFingerprint: preview.fingerprint,
      actorId: userId,
    });
    t.is(result.applied, 2);
    t.is(result.restored, terminal ? 0 : 1);
    const repaired = await db.aiContextMemory.findUniqueOrThrow({
      where: { id: first.memoryId! },
    });
    t.is(repaired.factKey, 'fact:背景色代号');
    t.is(repaired.status, terminal ? 'superseded' : 'active');
    t.deepEqual(
      await db.aiContextMemoryEvent.findMany({
        where: { id: { in: beforeEvents.map(e => e.id) } },
        orderBy: { id: 'asc' },
      }),
      beforeEvents
    );
    t.is((await repairLegacyMemoryKeys(db)).decisions.length, 0);
    await t.throwsAsync(
      repairLegacyMemoryKeys(db, {
        expectedFingerprint: preview.fingerprint,
        actorId: userId,
      })
    );
  });
}

test('preview is invalidated by concurrent user changes and deleted/disabled rows remain inactive', async t => {
  const { models, db, userId, workspaceId } = t.context;
  const row = await models.copilotContextMemory.put({
    ownerUserId: userId,
    workspaceId,
    scope: 'workspace',
    kind: 'auto_memory',
    visibility: 'private',
    content: '布局代号是 COLUMN',
    factKey: 'project:codename',
    status: 'disabled',
  });
  const preview = await repairLegacyMemoryKeys(db);
  await db.aiContextMemory.update({
    where: { id: row.id },
    data: { status: 'deleted', revision: { increment: 1 } },
  });
  await t.throwsAsync(
    repairLegacyMemoryKeys(db, {
      expectedFingerprint: preview.fingerprint,
      actorId: userId,
    })
  );
  const fresh = await repairLegacyMemoryKeys(db);
  await repairLegacyMemoryKeys(db, {
    expectedFingerprint: fresh.fingerprint,
    actorId: userId,
  });
  t.is(
    (await db.aiContextMemory.findUniqueOrThrow({ where: { id: row.id } }))
      .status,
    'deleted'
  );
});

test('ambiguous instructions and multiple facts retain their historical classification', async t => {
  const { models, db, userId, workspaceId } = t.context;
  for (const content of [
    '以下是公开事实：背景代号为 BLUE，目标值为 60',
    '我的强调色为蓝色；内部代号 BLUE_PRIVATE',
    '背景色代号是什么？',
  ]) {
    await models.copilotContextMemory.put({
      ownerUserId: userId,
      workspaceId,
      scope: 'workspace',
      kind: 'auto_memory',
      status: 'disabled',
      visibility: 'private',
      content,
      factKey: 'project:codename',
    });
  }
  const plan = await repairLegacyMemoryKeys(db);
  t.is(plan.decisions.length, 3);
  t.true(plan.decisions.every(row => !row.newKey && !row.restore));
});
