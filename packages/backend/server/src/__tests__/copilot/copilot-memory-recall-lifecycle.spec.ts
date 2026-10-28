import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { createTestingApp, type TestingApp } from '../utils';
import { seedProjectSourceGrant } from '../utils/project-source-grant';

let app: TestingApp;
test.before(async () => {
  app = await createTestingApp();
  await app.initTestingDB();
});
test.after.always(async () => {
  await app.close();
});

async function fixture() {
  const db = app.get(PrismaClient);
  const owner = await app.createUser();
  const member = await app.createUser();
  const outsider = await app.createUser();
  const workspace = await app.models.workspace.create(owner.id);
  const model = app.models.copilotContextMemory;
  const project = await model.createProject({
    createdByUserId: owner.id,
    name: 'Recall lifecycle',
  });
  await db.aiContextProjectMember.create({
    data: { projectId: project.id, userId: member.id, role: 'member' },
  });
  const source = { workspaceId: workspace.id, docId: randomUUID() };
  await app.models.doc.upsertMeta(source.workspaceId, source.docId);
  await seedProjectSourceGrant(db, {
    ...source,
    projectId: project.id,
    requesterUserId: owner.id,
    requestedLevel: 'read',
  });
  const put = (
    actor = member.id,
    content: string = randomUUID(),
    factKey: string = randomUUID()
  ) =>
    model.put({
      ownerUserId: actor,
      projectId: project.id,
      sourceDocuments: [source],
      scope: 'project',
      kind: 'auto_memory',
      visibility: 'private',
      content,
      factKey,
    });
  const memory = await put();
  const change = (
    status: 'active' | 'disabled',
    revision: number,
    actor = owner.id
  ) => model.update(memory.id, { status, expectedRevision: revision }, actor);
  const events = () =>
    db.aiContextMemoryEvent.findMany({
      where: { memoryId: memory.id, operation: { in: ['PAUSE', 'RESUME'] } },
      orderBy: { memoryRevision: 'asc' },
    });
  return {
    db,
    owner,
    member,
    outsider,
    model,
    project,
    memory,
    source,
    put,
    change,
    events,
  };
}

test.serial(
  'pause and resume preserve evidence, invalidate recall for all members and write immutable revision receipts',
  async t => {
    const f = await fixture();
    const contributions = await f.db.aiContextMemoryContribution.findMany({
      where: { memoryId: f.memory.id },
    });
    const sources = await f.db.aiContextMemorySource.findMany({
      where: { memoryId: f.memory.id },
    });
    const before = await f.db.aiProjectMemorySettings.findUniqueOrThrow({
      where: { projectId: f.project.id },
    });
    const paused = await f.change('disabled', 1);
    t.is(paused?.status, 'disabled');
    for (const userId of [f.owner.id, f.member.id]) {
      t.false(
        (
          await f.model.listVisible({ userId, projectIds: [f.project.id] })
        ).some(m => m.id === f.memory.id)
      );
      t.true(
        (
          await f.model.listManageable({
            userId,
            projectIds: [f.project.id],
            includeDisabled: true,
          })
        ).some(m => m.id === f.memory.id)
      );
    }
    t.is((await f.change('disabled', 2))?.revision, 2);
    const resumed = await f.change('active', 2);
    t.is(resumed?.revision, 3);
    t.is(resumed?.content, f.memory.content);
    t.is(resumed?.fingerprint, f.memory.fingerprint);
    t.deepEqual(
      await f.db.aiContextMemoryContribution.findMany({
        where: { memoryId: f.memory.id },
      }),
      contributions
    );
    t.deepEqual(
      await f.db.aiContextMemorySource.findMany({
        where: { memoryId: f.memory.id },
      }),
      sources
    );
    for (const userId of [f.owner.id, f.member.id]) {
      t.true(
        (
          await f.model.listVisible({ userId, projectIds: [f.project.id] })
        ).some(m => m.id === f.memory.id)
      );
    }
    const receipts = await f.events();
    t.deepEqual(
      receipts.map(e => [e.operation, e.memoryRevision, e.actorIdSnapshot]),
      [
        ['PAUSE', 2, f.owner.id],
        ['RESUME', 3, f.owner.id],
      ]
    );
    t.true(
      (
        await f.db.aiProjectMemorySettings.findUniqueOrThrow({
          where: { projectId: f.project.id },
        })
      ).projectMemoryRevision > before.projectMemoryRevision
    );
    await t.throwsAsync(
      f.db.aiContextMemoryEvent.update({
        where: { id: receipts[0].id },
        data: { reasonCode: 'rewritten' },
      }),
      { message: /immutable/ }
    );
    await t.throwsAsync(
      f.db.aiContextMemoryEvent.delete({ where: { id: receipts[0].id } }),
      { message: /immutable/ }
    );
    await t.throwsAsync(
      f.db.aiContextMemoryEvent.update({
        where: { id: receipts[0].id },
        data: { ownerUserId: null },
      })
    );
    await f.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('localmind.ai_context_user_delete_actor', ${f.owner.id}, true)`;
      await tx.aiContextMemoryEvent.update({
        where: { id: receipts[0].id },
        data: { ownerUserId: null },
      });
    });
    t.is((await f.events())[0].actorIdSnapshot, f.owner.id);
    t.is(
      await f.model.undoWriterEvent({
        eventId: receipts[1].id,
        ownerUserId: f.owner.id,
        workspaceId: null,
        projectId: f.project.id,
      }),
      null
    );
  }
);

test.serial(
  'only an owner or the independent contributor may change recall',
  async t => {
    const f = await fixture();
    await t.throwsAsync(f.change('disabled', 1, f.outsider.id));
    await t.notThrowsAsync(f.change('disabled', 1, f.member.id));
    await t.notThrowsAsync(f.change('active', 2, f.member.id));
    await f.put(f.owner.id, f.memory.content, f.memory.factKey!);
    await t.throwsAsync(f.change('disabled', 3, f.member.id));
    t.is((await f.model.get(f.memory.id))?.status, 'active');
    await t.notThrowsAsync(f.change('disabled', 3));
    await f.db.aiContextProjectMember.deleteMany({
      where: { projectId: f.project.id, userId: f.member.id },
    });
    await t.throwsAsync(f.change('active', 4, f.member.id));
  }
);

test.serial(
  'concurrent and stale submissions commit one transition and one receipt',
  async t => {
    const f = await fixture();
    const results = await Promise.allSettled([
      f.change('disabled', 1),
      f.change('disabled', 1),
    ]);
    t.is(results.filter(r => r.status === 'fulfilled').length, 1);
    t.is(results.filter(r => r.status === 'rejected').length, 1);
    t.is((await f.events()).length, 1);
    t.is((await f.model.get(f.memory.id))?.revision, 2);
    await t.throwsAsync(f.change('active', 1));
    t.is((await f.model.get(f.memory.id))?.status, 'disabled');
  }
);

test.serial(
  'resume rejects expired, retired, revoked and conflicting memories without new receipts',
  async t => {
    const f = await fixture();
    await f.change('disabled', 1);
    await f.put(f.owner.id, 'Newer fact', f.memory.factKey!);
    await t.throwsAsync(f.change('active', 2));
    t.is((await f.model.get(f.memory.id))?.status, 'disabled');
    for (const status of ['deleted', 'superseded']) {
      const retired = await f.put();
      await f.db.aiContextMemory.update({
        where: { id: retired.id },
        data: {
          status,
          validUntil: status === 'superseded' ? new Date() : null,
        },
      });
      await t.throwsAsync(
        f.model.update(
          retired.id,
          { status: 'active', expectedRevision: 1 },
          f.owner.id
        )
      );
    }
    const expired = await f.put();
    await f.db.aiContextMemory.update({
      where: { id: expired.id },
      data: { status: 'disabled', expiresAt: new Date(0) },
    });
    await t.throwsAsync(
      f.model.update(
        expired.id,
        { status: 'active', expectedRevision: 1 },
        f.owner.id
      )
    );
    await app.models.intelligenceWorkbenchAuthorization.removeSourceDocumentAuthorizations(
      f.source
    );
    await t.throwsAsync(f.change('active', 2));
    t.is((await f.events()).length, 1);
  }
);

test.serial(
  'content edits do not reactivate paused records and mixed edits are rejected',
  async t => {
    const f = await fixture();
    await f.change('disabled', 1);
    await t.throwsAsync(
      f.model.update(
        f.memory.id,
        { content: 'Corrected fact', status: 'active', expectedRevision: 2 },
        f.owner.id
      )
    );
    const replacement = await f.model.update(
      f.memory.id,
      { content: 'Corrected fact', expectedRevision: 2 },
      f.owner.id
    );
    t.is(replacement?.status, 'disabled');
    t.is((await f.model.get(f.memory.id))?.status, 'superseded');
    t.is((await f.events()).length, 1);
  }
);

test.serial(
  'receipt failure rolls back status and project invalidation',
  async t => {
    const f = await fixture();
    const before = await f.db.aiProjectMemorySettings.findUniqueOrThrow({
      where: { projectId: f.project.id },
    });
    await f.db.$executeRawUnsafe(
      `CREATE FUNCTION qa123_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation = 'PAUSE' THEN RAISE EXCEPTION 'QA123 injected receipt failure'; END IF; RETURN NEW; END; $$`
    );
    await f.db.$executeRawUnsafe(
      'CREATE TRIGGER qa123_fail_receipt BEFORE INSERT ON ai_context_memory_events FOR EACH ROW EXECUTE FUNCTION qa123_fail_receipt()'
    );
    try {
      await t.throwsAsync(f.change('disabled', 1), {
        message: /QA123 injected receipt failure/,
      });
      t.is((await f.model.get(f.memory.id))?.status, 'active');
      t.is((await f.model.get(f.memory.id))?.revision, 1);
      t.deepEqual(
        await f.db.aiProjectMemorySettings.findUniqueOrThrow({
          where: { projectId: f.project.id },
        }),
        before
      );
      t.is((await f.events()).length, 0);
    } finally {
      await f.db.$executeRawUnsafe(
        'DROP TRIGGER qa123_fail_receipt ON ai_context_memory_events'
      );
      await f.db.$executeRawUnsafe('DROP FUNCTION qa123_fail_receipt()');
    }
  }
);

test.serial(
  'GraphQL requires the displayed revision and rejects another member changing a contribution',
  async t => {
    const f = await fixture();
    const other = await app.createUser();
    await f.db.aiContextProjectMember.create({
      data: { projectId: f.project.id, userId: other.id, role: 'member' },
    });
    const signIn = async (user: typeof f.owner) =>
      app
        .POST('/api/auth/sign-in')
        .set('x-affine-version', '0.27.0')
        .send({ email: user.email, password: user.password })
        .expect(200);
    const query =
      'mutation($input: UpdateCopilotContextMemoryInput!) { updateCopilotContextMemory(input: $input) { id status revision } }';
    await signIn(other);
    await t.throwsAsync(
      app.gql(query, {
        input: { id: f.memory.id, status: 'disabled', expectedRevision: 1 },
      })
    );
    await signIn(f.owner);
    await t.throwsAsync(
      app.gql(query, { input: { id: f.memory.id, status: 'disabled' } })
    );
    const result = await app.gql<{
      updateCopilotContextMemory: { status: string; revision: number };
    }>(query, {
      input: { id: f.memory.id, status: 'disabled', expectedRevision: 1 },
    });
    t.is(result.updateCopilotContextMemory.status, 'disabled');
    t.is(result.updateCopilotContextMemory.revision, 2);
    t.is((await f.events()).length, 1);
  }
);
