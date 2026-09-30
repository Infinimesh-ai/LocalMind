import {
  changeWorkspaceLifecycleMutation,
  workspaceLifecycleResourceQuery,
  workspaceTrashedFoldersQuery,
} from '@affine/graphql';
import { createMinimalPdfFixture } from '@localmind/office/testing';
import { PrismaClient } from '@prisma/client';
import test from 'ava';
import * as Y from 'yjs';

import { DocWriter, WorkspaceOrganizationService } from '../../core/doc';
import { WorkspaceLifecycleService } from '../../core/doc/workspace-lifecycle';
import { WorkspaceNativeResourceService } from '../../core/office/workspace-resource-service';
import { WorkspaceBlobStorage } from '../../core/storage';
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
async function fixture() {
  const user = await app.createUser();
  const workspace = await app.models.workspace.create(user.id);
  const root = new Y.Doc();
  root.getMap('meta').set('pages', new Y.Array());
  await app
    .get(DocWriter)
    .pushDocUpdate(
      workspace.id,
      workspace.id,
      Y.encodeStateAsUpdate(root),
      user.id
    );
  root.destroy();
  return { actorId: user.id, workspaceId: workspace.id };
}

test.serial(
  'browser lifecycle operations authenticate, recycle and restore the same folder',
  async t => {
    const user = await app.signupV1();
    const workspace = await app.models.workspace.create(user.id);
    await app.get(WorkspaceOrganizationService).createResourceFolder({
      actorId: user.id,
      workspaceId: workspace.id,
      folderId: 'browser-folder',
      parentId: null,
      title: 'Browser folder',
      authorize: async () => {},
    });
    const identity = {
      workspaceId: workspace.id,
      kind: 'folder',
      resourceId: 'browser-folder',
    };
    const active = await app.gql<{
      workspaceLifecycleResource: { version: string; canTrash: boolean };
    }>(workspaceLifecycleResourceQuery.query, { input: identity });
    t.true(active.workspaceLifecycleResource.canTrash);
    await app.gql(changeWorkspaceLifecycleMutation.query, {
      input: {
        ...identity,
        action: 'trash',
        expectedVersion: active.workspaceLifecycleResource.version,
        requestKey: 'browser-trash',
      },
    });
    const trash = await app.gql<{
      workspaceTrashedFolders: { id: string; version: string }[];
    }>(workspaceTrashedFoldersQuery.query, { workspaceId: workspace.id });
    t.is(trash.workspaceTrashedFolders[0].id, identity.resourceId);
    await app.gql(changeWorkspaceLifecycleMutation.query, {
      input: {
        ...identity,
        action: 'restore',
        expectedVersion: trash.workspaceTrashedFolders[0].version,
        requestKey: 'browser-restore',
      },
    });
    const restored = await app.gql<{ workspaceTrashedFolders: unknown[] }>(
      workspaceTrashedFoldersQuery.query,
      { workspaceId: workspace.id }
    );
    t.deepEqual(restored.workspaceTrashedFolders, []);
  }
);

test.serial(
  'real PDF uses native Trash, restores its original directory and denies active permanent deletion',
  async t => {
    const actor = await fixture();
    const service = app.get(WorkspaceNativeResourceService);
    const organization = app.get(WorkspaceOrganizationService);
    await organization.createResourceFolder({
      ...actor,
      folderId: 'pdf-folder',
      parentId: null,
      title: 'PDF',
      authorize: async () => {},
    });
    const bytes = Buffer.from(await createMinimalPdfFixture());
    await app
      .get(WorkspaceBlobStorage)
      .put(actor.workspaceId, 'pdf-upload', bytes, {
        contentType: 'application/pdf',
        contentLength: bytes.length,
      });
    const resource = await service.create({
      ...actor,
      folderId: 'pdf-folder',
      title: 'original.pdf',
      blobKey: 'pdf-upload',
      requestKey: 'pdf-create',
    });
    t.is(resource.kind, 'office');
    const identity = {
      ...actor,
      resourceId: resource.id,
      kind: 'office' as const,
    };
    const active = await service.get(identity);
    t.true(active.canTrash);
    t.false(active.canRestore);
    t.false(active.canDeletePermanently);
    t.deepEqual(active.folderIds, ['pdf-folder']);
    t.false(active.atRoot);
    await t.throwsAsync(
      service.change({
        ...identity,
        action: 'delete',
        expectedVersion: active.metadataVersion,
        requestKey: 'active-delete',
      })
    );
    const trashed = await service.change({
      ...identity,
      action: 'trash',
      expectedVersion: active.metadataVersion,
      requestKey: 'pdf-trash',
    });
    t.is((await service.list(actor)).items.length, 0);
    const recycled = await service.get(identity, true);
    t.true(recycled.canRestore);
    t.true(recycled.canDeletePermanently);
    t.false(recycled.canTrash);
    await service.change({
      ...identity,
      action: 'restore',
      expectedVersion: trashed.metadataVersion,
      requestKey: 'pdf-restore',
    });
    const restored = await service.get(identity);
    t.is(restored.id, active.id);
    t.is(restored.contentVersion, active.contentVersion);
    t.deepEqual(restored.folderIds, ['pdf-folder']);
    t.false(restored.atRoot);
    t.is((await service.history(identity)).length, 1);
  }
);

test.serial(
  'document lifecycle binds a version and immutable receipt, rejects stale/reused requests and rechecks revoked membership',
  async t => {
    const actor = await fixture();
    const writer = app.get(DocWriter);
    const doc = await writer.createDoc(
      actor.workspaceId,
      'Page',
      'body',
      actor.actorId
    );
    const lifecycle = app.get(WorkspaceLifecycleService);
    const identity = { ...actor, kind: 'doc' as const, resourceId: doc.docId };
    const active = await lifecycle.get(identity);
    const command = {
      ...identity,
      action: 'trash' as const,
      expectedVersion: active.version,
      requestKey: 'doc-trash',
    };
    await lifecycle.change(command);
    t.true((await lifecycle.get(identity)).trashed);
    t.deepEqual(await lifecycle.change(command), {
      success: true,
      resourceId: doc.docId,
      action: 'trash',
    });
    await t.throwsAsync(lifecycle.change({ ...command, action: 'restore' }));
    await t.throwsAsync(
      lifecycle.change({ ...command, action: 'restore', requestKey: 'stale' })
    );
    const db = app.get(PrismaClient);
    await t.throwsAsync(
      db.workspaceLifecycleOperation.updateMany({
        where: { workspaceId: actor.workspaceId },
        data: { action: 'restore' },
      })
    );
    const recycled = await lifecycle.get(identity);
    await lifecycle.change({
      ...identity,
      action: 'restore',
      expectedVersion: recycled.version,
      requestKey: 'doc-restore',
    });
    t.false((await lifecycle.get(identity)).trashed);
    const member = await app.createUser();
    await db.workspaceMember.create({
      data: {
        workspaceId: actor.workspaceId,
        userId: member.id,
        role: 'member',
        state: 'active',
      },
    });
    const memberIdentity = { ...identity, actorId: member.id };
    const memberTrash = {
      ...memberIdentity,
      action: 'trash' as const,
      expectedVersion: (await lifecycle.get(memberIdentity)).version,
      requestKey: 'member-trash',
    };
    await lifecycle.change(memberTrash);
    await db.workspaceMember.deleteMany({
      where: { workspaceId: actor.workspaceId, userId: member.id },
    });
    await t.throwsAsync(lifecycle.change(memberTrash));
    const deleting = {
      ...identity,
      action: 'delete' as const,
      expectedVersion: (await lifecycle.get(identity)).version,
      requestKey: 'delete',
    };
    await lifecycle.change(deleting);
    t.true((await lifecycle.change(deleting)).success);
    await t.throwsAsync(lifecycle.get(identity));
  }
);

test.serial(
  'folder lifecycle restores only its claims and keeps separately recycled files in Trash',
  async t => {
    const actor = await fixture();
    const organization = app.get(WorkspaceOrganizationService);
    const files = app.get(WorkspaceNativeResourceService);
    const lifecycle = app.get(WorkspaceLifecycleService);
    await organization.createResourceFolder({
      ...actor,
      folderId: 'folder',
      parentId: null,
      title: 'Mixed',
      authorize: async () => {},
    });
    const entries = await Promise.all(
      ['live', 'separate'].map(title =>
        files.create({
          ...actor,
          title: title + '.txt',
          folderId: 'folder',
          content: { format: 'txt', text: title },
          requestKey: title,
        })
      )
    );
    const fileIdentity = (index: number) => ({
      ...actor,
      resourceId: entries[index].id,
      kind: 'file' as const,
    });
    await files.change({
      ...fileIdentity(1),
      action: 'trash',
      expectedVersion: 1,
      requestKey: 'single',
    });
    const identity = {
      ...actor,
      kind: 'folder' as const,
      resourceId: 'folder',
    };
    const command = {
      ...identity,
      action: 'trash' as const,
      expectedVersion: (await lifecycle.get(identity)).version,
      requestKey: 'folder-trash',
    };
    await lifecycle.change(command);
    t.is(
      (await lifecycle.listFolders(actor.workspaceId, actor.actorId)).length,
      1
    );
    t.is((await files.list({ ...actor, trash: true })).items.length, 2);
    t.true((await lifecycle.change(command)).success);
    await lifecycle.change({
      ...identity,
      action: 'restore',
      expectedVersion: (await lifecycle.get(identity)).version,
      requestKey: 'folder-restore',
    });
    t.is((await files.readText(fileIdentity(0))).text, 'live');
    await t.throwsAsync(files.readText(fileIdentity(1)));
    t.is(
      (await lifecycle.listFolders(actor.workspaceId, actor.actorId)).length,
      0
    );
    await lifecycle.change({
      ...identity,
      action: 'trash',
      expectedVersion: (await lifecycle.get(identity)).version,
      requestKey: 'folder-retrash',
    });
    const remove = {
      ...identity,
      action: 'delete' as const,
      expectedVersion: (await lifecycle.get(identity)).version,
      requestKey: 'folder-delete',
    };
    await lifecycle.change(remove);
    t.true((await lifecycle.change(remove)).success);
    t.is((await files.list({ ...actor, trash: true })).items.length, 0);
  }
);
