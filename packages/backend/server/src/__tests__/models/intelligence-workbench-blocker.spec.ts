import { randomUUID } from 'node:crypto';

import { PrismaClient, type User } from '@prisma/client';
import ava, { type TestFn } from 'ava';

import {
  IntelligenceWorkbenchBlockerModel,
  IntelligenceWorkbenchTaskProjectionModel,
  Models,
  normalizeIntelligenceWorkbenchBlockerSuggestion,
} from '../../models';
import { createTestingModule, type TestingModule } from '../utils';

interface Context {
  blocker: IntelligenceWorkbenchBlockerModel;
  db: PrismaClient;
  models: Models;
  module: TestingModule;
  projection: IntelligenceWorkbenchTaskProjectionModel;
}

const test = ava.serial as TestFn<Context>;

test.before(async t => {
  const module = await createTestingModule();
  t.context = {
    blocker: module.get(IntelligenceWorkbenchBlockerModel),
    db: module.get(PrismaClient),
    models: module.get(Models),
    module,
    projection: module.get(IntelligenceWorkbenchTaskProjectionModel),
  };
});

test.beforeEach(async t => {
  await t.context.module.initTestingDB();
});

test.after(async t => {
  await t.context.module.close();
});

async function createUser(context: Context, label: string) {
  return await context.models.user.create({
    email: `${label}-${randomUUID()}@example.invalid`,
  });
}

async function createProject(
  context: Context,
  owner: User,
  members: User[] = []
) {
  return await context.db.aiContextProject.create({
    data: {
      createdByUserId: owner.id,
      name: `Blocker project ${randomUUID()}`,
      members: {
        create: [
          { userId: owner.id, role: 'owner' },
          ...members.map(member => ({ userId: member.id, role: 'member' })),
        ],
      },
    },
  });
}

async function permissionSideEffectCounts(context: Context) {
  const [accessRequests, grants, runs] = await Promise.all([
    context.db.accessRequest.count(),
    context.db.aiContextProjectGrant.count(),
    context.db.aiAgentRun.count(),
  ]);
  return { accessRequests, grants, runs };
}

test('suggestions are zero-write and confirmation is actor-and-payload-bound idempotent', async t => {
  const owner = await createUser(t.context, 'blocker-suggestion-owner');
  const member = await createUser(t.context, 'blocker-suggestion-member');
  const outsider = await createUser(t.context, 'blocker-suggestion-outsider');
  const project = await createProject(t.context, owner, [member]);
  const dueAt = new Date(Date.now() - 60_000);

  const normalized = normalizeIntelligenceWorkbenchBlockerSuggestion({
    title: '  Waiting for the signed contract  ',
    type: 'wait_file',
    waitingOn: '  Legal team  ',
    dueAt: dueAt.toISOString(),
  });
  t.deepEqual(normalized, {
    title: 'Waiting for the signed contract',
    type: 'wait_file',
    waitingOn: 'Legal team',
    dueAt,
  });
  t.throws(
    () =>
      normalizeIntelligenceWorkbenchBlockerSuggestion({
        title: '',
        type: 'wait_file',
        waitingOn: 'Legal team',
      }),
    { message: /title must contain 1-512 characters/ }
  );
  t.throws(
    () =>
      normalizeIntelligenceWorkbenchBlockerSuggestion({
        title: 'A valid title',
        type: 'automatic_webhook',
        waitingOn: 'Legal team',
      }),
    { message: /Blocker type is invalid/ }
  );
  t.throws(
    () =>
      normalizeIntelligenceWorkbenchBlockerSuggestion({
        title: 'A valid title',
        type: 'custom',
        waitingOn: 'Legal team',
        dueAt: 'not-a-date',
      }),
    { message: /dueAt must be a valid date/ }
  );

  const suggestion = await t.context.blocker.suggestForMember({
    projectId: project.id,
    actorUserId: owner.id,
    ...normalized,
  });
  t.regex(
    suggestion.aiSuggestionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  t.regex(suggestion.confirmationProof, /^[A-Za-z0-9_-]+,[A-Za-z0-9+/=]+$/);
  t.is(await t.context.db.aiContextProjectBlocker.count(), 0);
  t.true(
    await t.context.blocker.canAccess({
      projectId: project.id,
      userId: member.id,
    })
  );
  t.false(
    await t.context.blocker.canAccess({
      projectId: project.id,
      userId: outsider.id,
    })
  );
  t.false(
    await t.context.blocker.canAccess({ projectId: '', userId: member.id })
  );

  await t.throwsAsync(
    t.context.blocker.suggestForMember({
      projectId: project.id,
      actorUserId: outsider.id,
      ...normalized,
    }),
    { message: /Project not found/ }
  );
  await t.throwsAsync(
    t.context.blocker.confirmSuggestion({
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: {
        ...normalized,
        aiSuggestionId: 'not-a-uuid',
        confirmationProof: suggestion.confirmationProof,
      },
    }),
    { message: /aiSuggestionId must be a UUID/ }
  );
  t.is(await t.context.db.aiContextProjectBlocker.count(), 0);
  await t.throwsAsync(
    t.context.blocker.createManual({
      projectId: project.id,
      actorUserId: owner.id,
      title: 'x'.repeat(513),
      type: 'custom',
      waitingOn: 'Length boundary',
    }),
    { message: /title must contain 1-512 characters/ }
  );
  await t.throwsAsync(
    t.context.blocker.list({
      userId: owner.id,
      statuses: ['invalid' as never],
    }),
    { message: /Blocker status is invalid/ }
  );
  t.is(await t.context.db.aiContextProjectBlocker.count(), 0);

  const otherProject = await createProject(t.context, owner);
  for (const invalidConfirmation of [
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: { ...suggestion, title: 'Changed before confirmation' },
    },
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: { ...suggestion, type: 'custom' as const },
    },
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: { ...suggestion, waitingOn: 'Changed counterparty' },
    },
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: {
        ...suggestion,
        dueAt: new Date(dueAt.getTime() + 1_000),
      },
    },
    {
      projectId: project.id,
      actorUserId: member.id,
      suggestion,
    },
    {
      projectId: otherProject.id,
      actorUserId: owner.id,
      suggestion,
    },
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: {
        ...suggestion,
        aiSuggestionId: randomUUID(),
      },
    },
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: {
        ...suggestion,
        confirmationProof: 'e30,AAAA',
      },
    },
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: {
        ...suggestion,
        confirmationProof: '***,AAAA',
      },
    },
    {
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: {
        ...suggestion,
        confirmationProof: 'a'.repeat(4097),
      },
    },
  ]) {
    await t.throwsAsync(
      t.context.blocker.confirmSuggestion(invalidConfirmation),
      { message: /confirmation proof is invalid/ }
    );
    t.is(await t.context.db.aiContextProjectBlocker.count(), 0);
  }

  const confirmed = await t.context.blocker.confirmSuggestion({
    projectId: project.id,
    actorUserId: owner.id,
    suggestion,
  });
  const replay = await t.context.blocker.confirmSuggestion({
    projectId: project.id,
    actorUserId: owner.id,
    suggestion,
  });
  t.is(replay.id, confirmed.id);
  t.is(confirmed.origin, 'ai_suggested');
  t.is(confirmed.aiSuggestionId, suggestion.aiSuggestionId);
  t.is(await t.context.db.aiContextProjectBlocker.count(), 1);

  await t.throwsAsync(
    t.context.blocker.confirmSuggestion({
      projectId: project.id,
      actorUserId: member.id,
      suggestion,
    }),
    { message: /confirmation proof is invalid/ }
  );
  await t.throwsAsync(
    t.context.blocker.confirmSuggestion({
      projectId: project.id,
      actorUserId: owner.id,
      suggestion: { ...suggestion, title: 'Changed after suggestion' },
    }),
    { message: /confirmation proof is invalid/ }
  );
  t.is(await t.context.db.aiContextProjectBlocker.count(), 1);
});

test('manual creation and terminal transitions are member-only, bounded, and fail closed', async t => {
  const owner = await createUser(t.context, 'blocker-state-owner');
  const member = await createUser(t.context, 'blocker-state-member');
  const outsider = await createUser(t.context, 'blocker-state-outsider');
  const project = await createProject(t.context, owner, [member]);
  const sideEffectsBefore = await permissionSideEffectCounts(t.context);

  const resolvable = await t.context.blocker.createManual({
    projectId: project.id,
    actorUserId: member.id,
    title: 'Waiting for a decision',
    type: 'wait_decision',
    waitingOn: 'Finance',
    dueAt: null,
  });
  t.is(resolvable.origin, 'user_created');
  t.is(resolvable.aiSuggestionId, null);
  await t.throwsAsync(
    t.context.blocker.createManual({
      projectId: project.id,
      actorUserId: outsider.id,
      title: 'Must not persist',
      type: 'custom',
      waitingOn: 'Nobody',
    }),
    { message: /Project not found/ }
  );
  await t.throwsAsync(
    t.context.blocker.get({ blockerId: resolvable.id, userId: outsider.id }),
    { message: /Blocker not found/ }
  );
  await t.throwsAsync(
    t.context.blocker.resolve({
      blockerId: resolvable.id,
      actorUserId: outsider.id,
    }),
    { message: /Blocker not found/ }
  );

  const resolved = await t.context.blocker.resolve({
    blockerId: resolvable.id,
    actorUserId: owner.id,
  });
  const resolvedReplay = await t.context.blocker.resolve({
    blockerId: resolvable.id,
    actorUserId: member.id,
  });
  t.is(resolved.status, 'resolved');
  t.is(resolvedReplay.id, resolved.id);
  t.is(resolvedReplay.resolutionActorUserIdSnapshot, owner.id);
  await t.throwsAsync(
    t.context.blocker.abandon({
      blockerId: resolvable.id,
      actorUserId: member.id,
    }),
    { message: /cannot change status/ }
  );

  const abandonable = await t.context.blocker.createManual({
    projectId: project.id,
    actorUserId: owner.id,
    title: 'Waiting for a reply',
    type: 'wait_reply',
    waitingOn: 'Vendor',
  });
  const abandoned = await t.context.blocker.abandon({
    blockerId: abandonable.id,
    actorUserId: member.id,
  });
  const abandonedReplay = await t.context.blocker.abandon({
    blockerId: abandonable.id,
    actorUserId: owner.id,
  });
  t.is(abandoned.status, 'abandoned');
  t.is(abandonedReplay.resolutionActorUserIdSnapshot, member.id);
  await t.throwsAsync(
    t.context.blocker.resolve({
      blockerId: abandonable.id,
      actorUserId: owner.id,
    }),
    { message: /cannot change status/ }
  );

  const race = await t.context.blocker.createManual({
    projectId: project.id,
    actorUserId: owner.id,
    title: 'Concurrent terminal transition',
    type: 'custom',
    waitingOn: 'Decision maker',
  });
  const raceResults = await Promise.allSettled([
    t.context.blocker.resolve({ blockerId: race.id, actorUserId: owner.id }),
    t.context.blocker.abandon({ blockerId: race.id, actorUserId: member.id }),
  ]);
  t.is(raceResults.filter(result => result.status === 'fulfilled').length, 1);
  t.is(raceResults.filter(result => result.status === 'rejected').length, 1);
  const rejectedRace = raceResults.find(result => result.status === 'rejected');
  if (rejectedRace?.status === 'rejected') {
    t.regex(
      String(rejectedRace.reason),
      /completed Blocker cannot change status/
    );
  }
  t.true(
    ['resolved', 'abandoned'].includes(
      (
        await t.context.db.aiContextProjectBlocker.findUniqueOrThrow({
          where: { id: race.id },
        })
      ).status
    )
  );

  const removedMemberBlocker = await t.context.blocker.createManual({
    projectId: project.id,
    actorUserId: member.id,
    title: 'Membership disappears',
    type: 'custom',
    waitingOn: 'Former member',
  });
  await t.context.db.aiContextProjectMember.delete({
    where: { projectId_userId: { projectId: project.id, userId: member.id } },
  });
  await t.throwsAsync(
    t.context.blocker.get({
      blockerId: removedMemberBlocker.id,
      userId: member.id,
    }),
    { message: /Blocker not found/ }
  );
  await t.throwsAsync(
    t.context.blocker.resolve({
      blockerId: removedMemberBlocker.id,
      actorUserId: member.id,
    }),
    { message: /Blocker not found/ }
  );

  const archivedBlocker = await t.context.blocker.createManual({
    projectId: project.id,
    actorUserId: owner.id,
    title: 'Archived project wait',
    type: 'wait_file',
    waitingOn: 'Archive',
  });
  await t.context.db.aiContextProject.update({
    where: { id: project.id },
    data: { status: 'archived' },
  });
  await t.throwsAsync(
    t.context.blocker.list({ userId: owner.id, projectId: project.id }),
    { message: /Project not found/ }
  );
  t.deepEqual(await t.context.blocker.list({ userId: owner.id }), []);
  await t.throwsAsync(
    t.context.blocker.abandon({
      blockerId: archivedBlocker.id,
      actorUserId: owner.id,
    }),
    { message: /Blocker not found/ }
  );
  t.deepEqual(await permissionSideEffectCounts(t.context), sideEffectsBefore);
});

test('projection prioritizes overdue waits and enforces todo and done bounds for active members', async t => {
  const owner = await createUser(t.context, 'blocker-projection-owner');
  const outsider = await createUser(t.context, 'blocker-projection-outsider');
  const project = await createProject(t.context, owner);
  const now = new Date();
  const overdue = await t.context.blocker.createManual({
    projectId: project.id,
    actorUserId: owner.id,
    title: 'Overdue reply',
    type: 'wait_reply',
    waitingOn: 'Customer',
    dueAt: new Date(now.getTime() - 60_000),
  });
  await t.context.blocker.createManual({
    projectId: project.id,
    actorUserId: owner.id,
    title: 'Future file',
    type: 'wait_file',
    waitingOn: 'Supplier',
    dueAt: new Date(now.getTime() + 60_000),
  });

  await t.context.db.aiContextProjectBlocker.createMany({
    data: Array.from({ length: 50 }, (_, index) => ({
      id: randomUUID(),
      projectId: project.id,
      creatorUserId: owner.id,
      creatorUserIdSnapshot: owner.id,
      title: `Waiting blocker ${index}`,
      type: 'custom',
      waitingOn: `Person ${index}`,
      status: 'waiting',
      origin: 'user_created',
    })),
  });
  await t.context.db.aiContextProjectBlocker.createMany({
    data: [
      ...Array.from({ length: 21 }, (_, index) => ({
        id: randomUUID(),
        projectId: project.id,
        creatorUserId: owner.id,
        creatorUserIdSnapshot: owner.id,
        title: `Completed blocker ${index}`,
        type: 'custom',
        waitingOn: `Person ${index}`,
        status: index % 2 === 0 ? 'resolved' : 'abandoned',
        origin: 'user_created',
        resolutionActorUserId: owner.id,
        resolutionActorUserIdSnapshot: owner.id,
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        resolvedAt: new Date(now.getTime() - index * 1_000),
      })),
      {
        id: randomUUID(),
        projectId: project.id,
        creatorUserId: owner.id,
        creatorUserIdSnapshot: owner.id,
        title: 'Outside done window',
        type: 'custom',
        waitingOn: 'Old contact',
        status: 'resolved',
        origin: 'user_created',
        resolutionActorUserId: owner.id,
        resolutionActorUserIdSnapshot: owner.id,
        createdAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000),
        resolvedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
      },
    ],
  });

  const panel = await t.context.projection.listPanel({
    userId: owner.id,
    projectId: project.id,
    now,
  });
  const todoBlockers = panel.todo.items.filter(item => item.kind === 'blocker');
  const doneBlockers = panel.done.items.filter(item => item.kind === 'blocker');
  t.is(panel.todo.items.length, 50);
  t.true(panel.todo.capped);
  const firstTodoBlocker = todoBlockers.at(0);
  t.is(firstTodoBlocker?.entityId, overdue.id);
  t.is(firstTodoBlocker?.segment, 'todo');
  t.is(firstTodoBlocker?.attention, 'waiting_on_others');
  t.true(firstTodoBlocker?.blocker?.overdue);
  t.deepEqual(firstTodoBlocker?.availableActions, [
    'resolve_blocker',
    'abandon_blocker',
  ]);
  t.is(panel.done.items.length, 20);
  t.true(panel.done.capped);
  t.true(
    doneBlockers.every(
      item =>
        item.segment === 'done' &&
        item.completedAt !== null &&
        item.availableActions.length === 0
    )
  );
  t.false(panel.done.items.some(item => item.title === 'Outside done window'));

  const outsiderPanel = await t.context.projection.listPanel({
    userId: outsider.id,
    now,
  });
  t.false(
    [...outsiderPanel.todo.items, ...outsiderPanel.done.items].some(
      item => item.kind === 'blocker'
    )
  );
});
