import { randomUUID } from 'node:crypto';

import { type AiContextProjectGrant, PrismaClient } from '@prisma/client';
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

test.serial(
  'revoked source hides inactive memories and blocks edits and historical restore',
  async t => {
    const db = app.get(PrismaClient);
    const user = await app.createUser();
    const workspace = await app.models.workspace.create(user.id);
    const memory = app.models.copilotContextMemory;
    const project = await memory.createProject({
      createdByUserId: user.id,
      name: 'Source revocation',
    });
    const source = { workspaceId: workspace.id, docId: randomUUID() };
    await app.models.doc.upsertMeta(source.workspaceId, source.docId);
    await seedProjectSourceGrant(db, {
      ...source,
      projectId: project.id,
      requesterUserId: user.id,
      requestedLevel: 'read',
    });
    const createMemory = (content: string) =>
      memory.put({
        ownerUserId: user.id,
        projectId: project.id,
        sourceDocuments: [source],
        scope: 'project',
        kind: 'auto_memory',
        visibility: 'private',
        content,
        factKey: randomUUID(),
      });
    const active = await createMemory('Active source fact');
    const disabled = await createMemory('Disabled source fact');
    const historical = await createMemory('Historical source fact');
    await db.aiContextMemory.update({
      where: { id: disabled.id },
      data: { status: 'disabled' },
    });
    await db.aiContextMemory.update({
      where: { id: historical.id },
      data: { status: 'deleted' },
    });
    const event = await db.aiContextMemoryEvent.create({
      data: {
        ownerUserId: user.id,
        projectId: project.id,
        memoryId: historical.id,
        operation: 'DELETE',
        factKey: historical.factKey,
        reasonCode: 'test',
        writerVersion: 'test',
        decisionFingerprint: randomUUID(),
      },
    });
    const previousRevision = (
      await db.aiProjectMemorySettings.findUniqueOrThrow({
        where: { projectId: project.id },
      })
    ).projectMemoryRevision;
    const [, revocation] = await Promise.allSettled([
      memory.update(disabled.id, { status: 'active' }, user.id),
      app.models.intelligenceWorkbenchAuthorization.removeSourceDocumentAuthorizations(
        source
      ),
    ]);
    t.is(revocation.status, 'fulfilled');
    t.true(
      (
        await db.aiProjectMemorySettings.findUniqueOrThrow({
          where: { projectId: project.id },
        })
      ).projectMemoryRevision > previousRevision
    );
    const listed = await memory.listManageable({
      userId: user.id,
      projectIds: [project.id],
      includeDisabled: true,
    });
    t.false(listed.some(row => [active.id, disabled.id].includes(row.id)));
    t.false(await memory.canManageProjectMemory(user.id, disabled.id));
    t.false(
      (
        await memory.listWriterEvents({
          ownerUserId: user.id,
          workspaceId: null,
          projectId: project.id,
        })
      ).some(row => row.id === event.id)
    );
    await t.throwsAsync(
      memory.update(disabled.id, { status: 'active' }, user.id)
    );
    t.is((await memory.get(disabled.id))?.status, 'disabled');
    t.is(
      await memory.undoWriterEvent({
        eventId: event.id,
        ownerUserId: user.id,
        workspaceId: null,
        projectId: project.id,
      }),
      null
    );
    t.is((await memory.get(historical.id))?.status, 'deleted');
  }
);

test.serial(
  'multi-source memories fail closed while independent facts remain visible',
  async t => {
    const db = app.get(PrismaClient);
    const user = await app.createUser();
    const workspace = await app.models.workspace.create(user.id);
    const memory = app.models.copilotContextMemory;
    const project = await memory.createProject({
      createdByUserId: user.id,
      name: 'Multi-source revocation',
    });
    const sources = [randomUUID(), randomUUID()].map(docId => ({
      workspaceId: workspace.id,
      docId,
    }));
    for (const source of sources) {
      await app.models.doc.upsertMeta(source.workspaceId, source.docId);
      await seedProjectSourceGrant(db, {
        ...source,
        projectId: project.id,
        requesterUserId: user.id,
        requestedLevel: 'read',
      });
    }
    const put = (content: string, sourceDocuments: typeof sources) =>
      memory.put({
        ownerUserId: user.id,
        projectId: project.id,
        sourceDocuments,
        scope: 'project',
        kind: 'auto_memory',
        visibility: 'private',
        content,
        factKey: randomUUID(),
      });
    const combined = await put('Fact depending on two sources', sources);
    const independent = await put('Fact from the other source', [sources[1]]);
    const results = await Promise.allSettled([
      app.models.intelligenceWorkbenchAuthorization.removeSourceDocumentAuthorizations(
        sources[0]
      ),
      app.models.intelligenceWorkbenchAuthorization.removeSourceDocumentAuthorizations(
        sources[0]
      ),
    ]);
    t.true(results.every(result => result.status === 'fulfilled'));
    const visible = () =>
      memory.listVisible({ userId: user.id, projectIds: [project.id] });
    t.false((await visible()).some(row => row.id === combined.id));
    t.true((await visible()).some(row => row.id === independent.id));

    // An unrelated later grant is not evidence that the original memory source
    // was reauthorized. The original immutable source binding must still win.
    await seedProjectSourceGrant(db, {
      ...sources[0],
      projectId: project.id,
      requesterUserId: user.id,
      requestedLevel: 'read',
    });
    t.false((await visible()).some(row => row.id === combined.id));
    t.is((await memory.get(combined.id))?.status, 'disabled');
    t.is((await memory.get(independent.id))?.status, 'active');
    // The database itself must reject a direct attempt to remove quarantine.
    await t.throwsAsync(
      db.aiContextMemory.update({
        where: { id: combined.id },
        data: {
          status: 'active',
          quarantinedAt: null,
          quarantineReason: null,
          quarantinedByProjectGrantId: null,
        },
      }),
      { message: /Quarantined project memory cannot be reactivated/ }
    );
    t.false((await visible()).some(row => row.id === combined.id));
    await app
      .POST('/api/auth/sign-in')
      .set('x-affine-version', '0.27.0')
      .send({ email: user.email, password: user.password })
      .expect(200);
    const result = await app.gql<{
      createCopilotSessionWithHistory: { sessionId: string };
    }>(
      'mutation($options: CreateChatSessionInput!) { createCopilotSessionWithHistory(options: $options) { sessionId } }',
      {
        options: {
          projectId: project.id,
          promptName: 'Chat With LocalMind AI',
          reuseLatestChat: false,
        },
      }
    );
    const sessionId = result.createCopilotSessionWithHistory.sessionId;
    await app.models.copilotContext.recordRecalledMemorySources({
      actorId: user.id,
      sessionId,
      projectId: project.id,
      workspaceId: null,
      memories: [{ id: combined.id, content: combined.content }],
    });
    t.is(
      await db.aiSessionContextSource.count({
        where: { sessionId, kind: 'private' },
      }),
      1
    );
  }
);

async function reauthorizationFixture() {
  const db = app.get(PrismaClient);
  const user = await app.createUser();
  const outsider = await app.createUser();
  const workspace = await app.models.workspace.create(user.id);
  await db.effectiveWorkspaceQuotaState.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      ownerUserId: user.id,
      plan: 'free',
      seatLimit: 100,
      blobLimit: 0,
      storageQuota: 0,
      historyPeriodSeconds: 0,
      known: true,
      stale: false,
    },
    update: { known: true, stale: false, staleAfter: null },
  });
  const memory = app.models.copilotContextMemory;
  const authorization = app.models.intelligenceWorkbenchAuthorization;
  const project = await memory.createProject({
    createdByUserId: user.id,
    name: 'Memory source consent',
  });
  const sources = [randomUUID(), randomUUID()].map(docId => ({
    workspaceId: workspace.id,
    docId,
  }));
  const grants: AiContextProjectGrant[] = [];
  for (const source of sources) {
    await app.models.doc.upsertMeta(source.workspaceId, source.docId);
    grants.push(
      await seedProjectSourceGrant(db, {
        ...source,
        projectId: project.id,
        requesterUserId: user.id,
        requestedLevel: 'read',
      })
    );
  }
  const put = (
    content: string,
    selected = [sources[0]],
    factKey: string = randomUUID()
  ) =>
    memory.put({
      ownerUserId: user.id,
      projectId: project.id,
      sourceDocuments: selected,
      scope: 'project',
      kind: 'auto_memory',
      visibility: 'private',
      content,
      factKey,
    });
  const set = (
    index: number,
    enabled: boolean,
    expectedRevision: number,
    requestKey = randomUUID()
  ) =>
    authorization.setMemorySourceAuthorization({
      grantId: grants[index].id,
      actorUserId: user.id,
      enabled,
      expectedRevision,
      requestKey,
    });
  return {
    db,
    user,
    outsider,
    workspace,
    memory,
    authorization,
    project,
    sources,
    grants,
    put,
    set,
  };
}

test.serial(
  'reauthorization restores only source-disabled versions and preserves document ACL and immutable evidence',
  async t => {
    const f = await reauthorizationFixture();
    const active = await f.put('Active before revocation');
    const disabled = await f.put('Disabled before revocation');
    const deleted = await f.put('Deleted before revocation');
    const other = await f.put('Quarantined for a different reason');
    await f.db.aiContextMemory.update({
      where: { id: disabled.id },
      data: { status: 'disabled' },
    });
    await f.db.aiContextMemory.update({
      where: { id: deleted.id },
      data: { status: 'deleted' },
    });
    await f.db.aiContextMemory.update({
      where: { id: other.id },
      data: {
        status: 'disabled',
        quarantinedAt: new Date(),
        quarantineReason: 'private_source',
        quarantinedByProjectGrantId: f.grants[0].id,
      },
    });
    await f.authorization.removeSourceDocumentAuthorizations(f.sources[0]);
    const result = await f.set(0, true, 0);
    t.is(result.restoredCount, 1);
    t.is((await f.memory.get(active.id))?.status, 'active');
    t.is((await f.memory.get(active.id))?.quarantinedAt, null);
    t.is((await f.memory.get(disabled.id))?.status, 'disabled');
    t.is((await f.memory.get(deleted.id))?.status, 'deleted');
    t.is((await f.memory.get(other.id))?.quarantineReason, 'private_source');
    t.is(
      (
        await f.db.aiContextProjectGrant.findUniqueOrThrow({
          where: { id: f.grants[0].id },
        })
      ).status,
      'revoked'
    );
    t.true(
      (
        await f.memory.listVisible({
          userId: f.user.id,
          projectIds: [f.project.id],
        })
      ).some(row => row.id === active.id)
    );
    t.false(
      (
        await f.memory.listVisible({
          userId: f.outsider.id,
          projectIds: [f.project.id],
        })
      ).some(row => row.id === active.id)
    );
    await t.throwsAsync(
      f.db.aiProjectMemorySourceAuthorizationEvent.update({
        where: { id: result.id },
        data: { status: 'revoked' },
      }),
      { message: /immutable/ }
    );
    await t.throwsAsync(
      f.db.aiContextMemory.update({
        where: { id: other.id },
        data: {
          status: 'active',
          quarantinedAt: null,
          quarantineReason: null,
          quarantinedByProjectGrantId: null,
          revision: { increment: 1 },
        },
      }),
      { message: /cannot be reactivated/ }
    );
    await f.authorization.removeSourceDocumentAuthorizations(f.sources[0]);
    t.is((await f.memory.get(active.id))?.status, 'disabled');
    t.is(
      (
        await f.db.aiProjectMemorySourceAuthorization.findUniqueOrThrow({
          where: { grantId: f.grants[0].id },
        })
      ).status,
      'revoked'
    );
  }
);

test.serial(
  'multi-source restoration is atomic, repeatable and does not revive user-deleted memories',
  async t => {
    const f = await reauthorizationFixture();
    const combined = await f.put('Both sources required', f.sources);
    const independent = await f.put('Only first source required');
    const second = await f.put('Only second source required', [f.sources[1]]);
    await f.set(0, false, 0);
    t.is((await f.memory.get(second.id))?.status, 'active');
    await f.set(1, false, 0);
    const first = await f.set(0, true, 1);
    t.is(first.restoredCount, 1);
    t.is(first.deferredCount, 1);
    t.is((await f.memory.get(combined.id))?.status, 'disabled');
    const key = randomUUID();
    const retries = await Promise.all([
      f.set(1, true, 1, key),
      f.set(1, true, 1, key),
    ]);
    t.is(retries[0].id, retries[1].id);
    t.is(retries[0].restoredCount, 2);
    t.is((await f.memory.get(combined.id))?.status, 'active');
    const current = await f.memory.get(independent.id);
    await f.memory.delete(independent.id, f.user.id, current!.revision);
    await f.set(0, false, 2);
    await f.set(0, true, 3);
    t.is((await f.memory.get(independent.id))?.status, 'deleted');
    await t.throwsAsync(f.set(1, false, 1, key), {
      message: /key was already used/,
    });
    await t.throwsAsync(f.set(1, false, 1), { message: /changed; reload/ });
    const race = await Promise.allSettled([
      f.set(0, false, 4),
      f.set(1, false, 2),
    ]);
    t.true(race.every(result => result.status === 'fulfilled'));
    t.is((await f.memory.get(combined.id))?.status, 'disabled');
    const restores = await Promise.allSettled([
      f.set(0, true, 5),
      f.set(1, true, 3),
    ]);
    t.true(restores.every(result => result.status === 'fulfilled'));
    t.is((await f.memory.get(combined.id))?.status, 'active');
  }
);

test.serial(
  'restore respects current source permission, expiration and newer fact conflicts',
  async t => {
    const f = await reauthorizationFixture();
    const conflict = await f.put('Original fact');
    const expired = await f.put('Expires while revoked');
    const active = await f.put('Another eligible fact');
    await f.set(0, false, 0);
    await f.db.aiContextMemory.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    const replacement = await f.put(
      'Newer independent fact',
      [f.sources[1]],
      conflict.factKey!
    );
    await t.throwsAsync(
      f.authorization.setMemorySourceAuthorization({
        grantId: f.grants[0].id,
        actorUserId: f.outsider.id,
        enabled: true,
        expectedRevision: 1,
        requestKey: randomUUID(),
      })
    );
    await f.db.effectiveWorkspaceQuotaState.update({
      where: { workspaceId: f.workspace.id },
      data: { stale: true },
    });
    await t.throwsAsync(f.set(0, true, 1), { message: /sharing authority/ });
    t.is((await f.memory.get(active.id))?.status, 'disabled');
    await f.db.effectiveWorkspaceQuotaState.update({
      where: { workspaceId: f.workspace.id },
      data: { stale: false },
    });
    const result = await f.set(0, true, 1);
    t.is(result.restoredCount, 1);
    t.is(result.deferredCount, 2);
    t.is((await f.memory.get(conflict.id))?.status, 'disabled');
    t.is((await f.memory.get(expired.id))?.status, 'disabled');
    t.is((await f.memory.get(replacement.id))?.status, 'active');
    t.is((await f.memory.get(active.id))?.status, 'active');
    // An authorization row cannot be changed without its immutable transition.
    await t.throwsAsync(
      f.db.aiProjectMemorySourceAuthorization.update({
        where: { grantId: f.grants[0].id },
        data: { revision: 3 },
      }),
      { message: /versioned evidence/ }
    );
  }
);

test.serial(
  'memory-only restoration supports recalled-memory writes without reopening source-document permission',
  async t => {
    const f = await reauthorizationFixture();
    const memory = await f.put('Recalled shared fact');
    await f.authorization.removeSourceDocumentAuthorizations(f.sources[0]);
    await f.set(0, true, 0);
    await app
      .POST('/api/auth/sign-in')
      .set('x-affine-version', '0.27.0')
      .send({ email: f.user.email, password: f.user.password })
      .expect(200);
    const result = await app.gql<{
      createCopilotSessionWithHistory: { sessionId: string };
    }>(
      'mutation($options: CreateChatSessionInput!) { createCopilotSessionWithHistory(options: $options) { sessionId } }',
      {
        options: {
          projectId: f.project.id,
          promptName: 'Chat With LocalMind AI',
          reuseLatestChat: false,
        },
      }
    );
    const sessionId = result.createCopilotSessionWithHistory.sessionId;
    await app.models.copilotContext.recordRecalledMemorySources({
      actorId: f.user.id,
      sessionId,
      projectId: f.project.id,
      workspaceId: null,
      memories: [{ id: memory.id, content: memory.content }],
    });
    t.is(
      await f.db.aiSessionContextSource.count({
        where: { sessionId, kind: 'document' },
      }),
      0
    );
    await t.notThrowsAsync(
      app.models.copilotContext.assertProjectSourcesShared({
        sessionId,
        actorId: f.user.id,
        projectId: f.project.id,
      })
    );
    await f.set(0, false, 1);
    await t.throwsAsync(
      app.models.copilotContext.assertProjectSourcesShared({
        sessionId,
        actorId: f.user.id,
        projectId: f.project.id,
      })
    );
  }
);

test.serial(
  'restore racing another source revocation stays hidden and refreshes every project member',
  async t => {
    const f = await reauthorizationFixture();
    await f.db.aiContextProjectMember.create({
      data: { projectId: f.project.id, userId: f.outsider.id, role: 'member' },
    });
    const combined = await f.put('Concurrent source transitions', f.sources);
    await f.set(0, false, 0);
    const results = await Promise.allSettled([
      f.set(0, true, 1),
      f.set(1, false, 0),
    ]);
    t.true(results.every(result => result.status === 'fulfilled'));
    t.is((await f.memory.get(combined.id))?.status, 'disabled');
    t.false(
      (
        await f.memory.listManageable({
          userId: f.user.id,
          projectIds: [f.project.id],
          includeDisabled: true,
        })
      ).some(m => m.id === combined.id)
    );
    await f.set(1, true, 1);
    t.true(
      (
        await f.memory.listVisible({
          userId: f.outsider.id,
          projectIds: [f.project.id],
        })
      ).some(m => m.id === combined.id)
    );
    for (const userId of [f.user.id, f.outsider.id]) {
      t.true(
        (await f.db.projectRealtimeOutbox.count({
          where: { topic: 'project.list.changed', scopeId: userId },
        })) > 0
      );
    }
  }
);

test.serial(
  'GraphQL source consent returns conflict status and denies non-source managers',
  async t => {
    const f = await reauthorizationFixture();
    await f.put('GraphQL consent fixture');
    const query =
      'mutation($input: SetCopilotMemorySourceAuthorizationInput!) { setCopilotMemorySourceAuthorization(input: $input) { status revision restoredCount } }';
    await app
      .POST('/api/auth/sign-in')
      .set('x-affine-version', '0.27.0')
      .send({ email: f.user.email, password: f.user.password })
      .expect(200);
    const input = {
      grantId: f.grants[0].id,
      enabled: false,
      expectedRevision: 0,
      requestKey: randomUUID(),
    };
    const first = await app
      .POST('/graphql')
      .send({ query, variables: { input } })
      .expect(200);
    t.is(first.body.data.setCopilotMemorySourceAuthorization.status, 'revoked');
    const stale = await app
      .POST('/graphql')
      .send({
        query,
        variables: { input: { ...input, requestKey: randomUUID() } },
      })
      .expect(200);
    t.is(stale.body.errors[0].extensions.status, 409);
    await app
      .POST('/api/auth/sign-in')
      .set('x-affine-version', '0.27.0')
      .send({ email: f.outsider.email, password: f.outsider.password })
      .expect(200);
    const denied = await app
      .POST('/graphql')
      .send({
        query,
        variables: {
          input: {
            ...input,
            enabled: true,
            expectedRevision: 1,
            requestKey: randomUUID(),
          },
        },
      })
      .expect(200);
    t.truthy(denied.body.errors);
    t.is(
      (
        await f.db.aiProjectMemorySourceAuthorization.findUniqueOrThrow({
          where: { grantId: f.grants[0].id },
        })
      ).status,
      'revoked'
    );
  }
);

test.serial(
  'document revocation follows shared-write grant and memory lock order',
  async t => {
    const f = await reauthorizationFixture();
    const memory = await f.put('A recalled fact during a shared write');
    let grantLocked!: () => void;
    let readMemory!: () => void;
    const ready = new Promise<void>(resolve => {
      grantLocked = resolve;
    });
    const proceed = new Promise<void>(resolve => {
      readMemory = resolve;
    });
    const writer = f.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM ai_context_project_grants WHERE id = ${f.grants[0].id} FOR SHARE`;
      grantLocked();
      await proceed;
      await tx.$queryRaw`SELECT id FROM ai_context_memories WHERE id = ${memory.id} FOR SHARE`;
    });
    await ready;
    const revoke = f.authorization.removeSourceDocumentAuthorizations(
      f.sources[0]
    );
    // Let revocation contend with the granted source check before it reads memory.
    await new Promise(resolve => setTimeout(resolve, 50));
    readMemory();
    const results = await Promise.allSettled([writer, revoke]);
    t.true(results.every(result => result.status === 'fulfilled'));
    t.is((await f.memory.get(memory.id))?.status, 'disabled');
  }
);
