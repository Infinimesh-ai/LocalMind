import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { PrismaClient } from '@prisma/client';
import test from 'ava';
import sinon from 'sinon';
import * as Y from 'yjs';

import { Mutex } from '../../base';
import type { CurrentUser } from '../../core/auth/session';
import { DocWriter, WorkspaceOrganizationService } from '../../core/doc';
import { WorkspaceDirectoryResolver } from '../../core/doc/directory-resolver';
import { WorkspaceNativeResourceAccess } from '../../core/doc/native-resource-access';
import { WorkspaceDocOutboxPublisher } from '../../core/doc/outbox';
import { WorkspaceNativeResourceService } from '../../core/office/workspace-resource-service';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
test.before(async () => {
  // This suite resets only the disposable database provisioned for this repair.
  assert.match(
    new URL(process.env.DATABASE_URL ?? '').pathname,
    /^\/localmind_sync_repair_[a-z0-9_]+$/
  );
  app = await createTestingApp();
});
test.beforeEach(async () => {
  await app.get(WorkspaceDocOutboxPublisher).publish();
  await app.initTestingDB();
});
test.after.always(async () => {
  await app?.close();
});

async function fixture() {
  const owner = await app.createUser();
  const workspace = await app.models.workspace.create(owner.id);
  const root = new Y.Doc();
  root.getMap('meta').set('pages', new Y.Array());
  await app
    .get(DocWriter)
    .pushDocUpdate(
      workspace.id,
      workspace.id,
      Y.encodeStateAsUpdate(root),
      owner.id
    );
  root.destroy();
  const actor = { actorId: owner.id, workspaceId: workspace.id };
  await app.get(WorkspaceOrganizationService).createResourceFolder({
    ...actor,
    folderId: 'shared-folder',
    parentId: null,
    title: 'Shared',
    authorize: async () => {},
  });
  const file = await app.get(WorkspaceNativeResourceService).create({
    ...actor,
    folderId: 'shared-folder',
    title: 'repro.txt',
    content: { format: 'txt', text: 'Isolated concurrent read fixture' },
    requestKey: 'create-file',
  });
  const users = [owner, await app.createUser(), await app.createUser()];
  const db = app.get(PrismaClient);
  await db.workspaceMember.createMany({
    data: users.slice(1).map(user => ({
      workspaceId: workspace.id,
      userId: user.id,
      role: 'member' as const,
      state: 'active' as const,
    })),
  });
  const actors = users.map(
    user =>
      ({ ...user, hasPassword: false, emailVerified: false }) as CurrentUser
  );
  return { ...actor, db, actors, file };
}

test.serial(
  'three users read directory and native resources while the directory document update lock is held',
  async t => {
    const { workspaceId, db, actors, file } = await fixture();
    const directory = app.get(WorkspaceDirectoryResolver);
    const native = app.get(WorkspaceNativeResourceService);
    const access = app.get(WorkspaceNativeResourceAccess);
    const docId = `db$${workspaceId}$folders`;
    const updatesBefore = await db.update.count({
      where: { workspaceId, id: docId },
    });
    const snapshotsBefore = await db.snapshot.findFirst({
      where: { workspaceId, id: docId },
    });
    const reader = sinon.spy(app.models.doc, 'readAuthoritative');
    await using lock = await app
      .get(Mutex)
      .acquire(`doc:update:${workspaceId}:${docId}`);
    t.truthy(lock);
    const started = performance.now();
    try {
      const results = await Promise.all(
        actors.map(async actor => {
          const identity = {
            workspaceId,
            actorId: actor.id,
            resourceId: file.id,
            kind: 'file' as const,
          };
          const [page, resource, permitted] = await Promise.all([
            directory.workspaceDirectory(actor, workspaceId),
            native.get(identity),
            access.assert(identity),
          ]);
          t.true(page.items.some(item => item.data === file.id));
          t.is(resource.id, file.id);
          t.is(permitted.resourceId, file.id);
          return resource.id;
        })
      );
      t.is(results.length, 3);
      t.true(reader.callCount <= 9);
      t.true(reader.getCalls().every(call => call.args[2] === false));
      t.is(
        await db.update.count({ where: { workspaceId, id: docId } }),
        updatesBefore
      );
      t.deepEqual(
        await db.snapshot.findFirst({ where: { workspaceId, id: docId } }),
        snapshotsBefore
      );
      console.log(
        JSON.stringify({
          concurrentUsers: 3,
          reads: 9,
          readAuthoritativeCalls: reader.callCount,
          updateLockHeld: true,
          durationMs: Math.round(performance.now() - started),
          compactionWrites: 0,
        })
      );
    } finally {
      reader.restore();
    }
  }
);

test.serial(
  'directory reads do not wait for an unrelated in-flight directory mutation lock',
  async t => {
    const { workspaceId, actors } = await fixture();
    const writer = new PrismaClient();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const transaction = writer.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`directory-authorization:${workspaceId}`}, 0))`;
        entered.resolve();
        await release.promise;
      },
      { timeout: 10000 }
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads: Promise<unknown> | undefined;
    try {
      await entered.promise;
      reads = Promise.all(
        actors.map(actor =>
          app
            .get(WorkspaceDirectoryResolver)
            .workspaceDirectory(actor, workspaceId)
        )
      );
      t.true(
        await Promise.race([
          reads.then(() => true),
          new Promise<boolean>(resolve => {
            timer = setTimeout(() => resolve(false), 2000);
          }),
        ])
      );
    } finally {
      if (timer) clearTimeout(timer);
      release.resolve();
      await transaction;
      await reads;
      await writer.$disconnect();
    }
  }
);

test.serial(
  'read snapshots never retain authorization after directory or membership revocation',
  async t => {
    const { workspaceId, actorId, actors, file, db } = await fixture();
    const member = actors[1];
    const identity = {
      workspaceId,
      actorId: member.id,
      resourceId: file.id,
      kind: 'file' as const,
    };
    const native = app.get(WorkspaceNativeResourceService);
    const directory = app.get(WorkspaceDirectoryResolver);
    t.is((await native.get(identity)).id, file.id);
    await app.models.workspaceDirectoryGrant.set({
      workspaceId,
      actorId,
      directoryId: 'shared-folder',
      principalId: member.id,
      rights: {
        canRead: false,
        canWrite: false,
        canOrganize: false,
        canCreateFolder: false,
      },
    });
    await t.throwsAsync(native.get(identity));
    const page = await directory.workspaceDirectory(member, workspaceId);
    t.false(page.items.some(item => item.data === file.id));
    t.false(page.fullSyncAllowed);
    await db.workspaceMember.deleteMany({
      where: { workspaceId, userId: member.id },
    });
    await t.throwsAsync(directory.workspaceDirectory(member, workspaceId));
    await t.throwsAsync(native.get(identity));
  }
);
