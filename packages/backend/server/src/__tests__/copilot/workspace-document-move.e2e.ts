import { moveWorkspaceDocumentMutation } from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import test from 'ava';
import * as Y from 'yjs';

import type { CurrentUser } from '../../core/auth/session';
import {
  DocWriter,
  WorkspaceOrganizationService,
  WorkspaceResourceService,
} from '../../core/doc';
import { WorkspaceDirectoryResolver } from '../../core/doc/directory-resolver';
import { WorkspaceNativeResourceService } from '../../core/office/workspace-resource-service';
import { DocRole } from '../../models/common';
import { WORKSPACE_DIRECTORY_ROOT } from '../../models/workspace-directory-grant';
import { createTestingApp, type TestingApp, type TestUser } from '../utils';

function currentUser(user: TestUser): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    disabled: user.disabled,
    hasPassword: Boolean(user.password),
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

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
  const owner = await app.createUser(),
    member = await app.createUser();
  const workspace = await app.models.workspace.create(owner.id);
  const workspaceId = workspace.id,
    documentId = 'move-page';
  const input = { workspaceId, actorId: owner.id };
  await app.get(PrismaClient).workspaceMember.create({
    data: { workspaceId, userId: member.id, role: 'member', state: 'active' },
  });
  const root = new Y.Doc();
  root.getMap('meta').set('pages', new Y.Array());
  await app
    .get(DocWriter)
    .pushDocUpdate(
      workspaceId,
      workspaceId,
      Y.encodeStateAsUpdate(root),
      owner.id
    );
  root.destroy();
  const resources = app.get(WorkspaceResourceService);
  await resources.snapshot(input, () =>
    resources.write(
      input,
      {
        toolName: 'workspace_doc_create',
        title: 'Page to move',
        content: { format: 'markdown', text: 'MOVE-ORIGINAL' },
        folderId: null,
        idempotencyKey: 'create',
      },
      { documentId, folderId: null },
      async () => {}
    )
  );
  await app.models.docUser.set(
    workspaceId,
    documentId,
    member.id,
    DocRole.Editor
  );
  const organization = app.get(WorkspaceOrganizationService);
  for (const folderId of ['source', 'target'])
    await organization.createResourceFolder({
      ...input,
      folderId,
      parentId: null,
      title: folderId,
      authorize: async () => {},
    });
  const revision = () => organization.directoryRevision(workspaceId, owner.id);
  const placements = async () =>
    (await organization.readDirectory(workspaceId, owner.id)).entries
      .filter(row => row.row.type === 'doc' && row.row.data === documentId)
      .map(row => row.row.parentId);
  const resolver = app.get(WorkspaceDirectoryResolver);
  return {
    owner,
    member,
    workspaceId,
    documentId,
    input,
    resources,
    organization,
    revision,
    placements,
    resolver,
  };
}

test.serial(
  'document move GraphQL preserves identity and content, rejects stale versions, and handles root replay',
  async t => {
    const f = await fixture();
    await app
      .POST('/api/auth/sign-in')
      .send({ email: f.owner.email, password: f.owner.password })
      .expect(200);
    const before = await f.resources.read(f.input, f.documentId);
    const originalRevision = await f.revision();
    const vars = {
      workspaceId: f.workspaceId,
      documentId: f.documentId,
      folderId: 'target',
      expectedRevision: originalRevision,
    };
    await app.gql(moveWorkspaceDocumentMutation.query, vars);
    t.deepEqual(await f.placements(), ['target']);
    await t.throwsAsync(app.gql(moveWorkspaceDocumentMutation.query, vars));
    await app.gql(moveWorkspaceDocumentMutation.query, {
      ...vars,
      expectedRevision: await f.revision(),
    });
    t.deepEqual(await f.placements(), ['target']);
    for (let n = 0; n < 2; n++)
      await app.gql(moveWorkspaceDocumentMutation.query, {
        ...vars,
        folderId: null,
        expectedRevision: await f.revision(),
      });
    t.deepEqual(await f.placements(), []);
    const after = await f.resources.read(f.input, f.documentId);
    t.is(after.documentId, before.documentId);
    t.deepEqual(after.content, before.content);
  }
);

test.serial(
  'document move checks all hidden source placements and refuses nonexistent or foreign targets',
  async t => {
    const f = await fixture();
    await f.organization.moveResourceDocument({
      ...f.input,
      documentId: f.documentId,
      folderId: 'source',
      authorize: async () => {},
    });
    await app.models.workspaceDirectoryGrant.set({
      ...f.input,
      directoryId: 'source',
      principalId: f.member.id,
      rights: {
        canRead: false,
        canWrite: false,
        canOrganize: false,
        canCreateFolder: false,
      },
    });
    await t.throwsAsync(
      f.resolver.moveWorkspaceDocument(
        currentUser(f.member),
        f.workspaceId,
        f.documentId,
        await f.revision(),
        'target'
      )
    );
    t.deepEqual(await f.placements(), ['source']);
    for (const folderId of ['missing', 'foreign-folder'])
      await t.throwsAsync(
        f.resolver.moveWorkspaceDocument(
          currentUser(f.owner),
          f.workspaceId,
          f.documentId,
          await f.revision(),
          folderId
        )
      );
    t.deepEqual(await f.placements(), ['source']);
    const foreign = await app.models.workspace.create(f.owner.id);
    await t.throwsAsync(
      f.resolver.moveWorkspaceDocument(
        currentUser(f.owner),
        foreign.id,
        f.documentId,
        await f.revision(),
        null
      )
    );
  }
);

test.serial(
  'root organize restrictions cannot be bypassed by a writable child grant',
  async t => {
    const f = await fixture();
    await app.models.workspaceDirectoryGrant.set({
      ...f.input,
      directoryId: WORKSPACE_DIRECTORY_ROOT,
      principalId: f.member.id,
      rights: {
        canRead: true,
        canWrite: false,
        canOrganize: false,
        canCreateFolder: false,
      },
    });
    await app.models.workspaceDirectoryGrant.set({
      ...f.input,
      directoryId: 'target',
      principalId: f.member.id,
      rights: {
        canRead: true,
        canWrite: true,
        canOrganize: true,
        canCreateFolder: true,
      },
    });
    await t.throwsAsync(
      f.resolver.moveWorkspaceDocument(
        currentUser(f.member),
        f.workspaceId,
        f.documentId,
        await f.revision(),
        'target'
      )
    );
    t.deepEqual(await f.placements(), []);
    await f.resolver.moveWorkspaceDocument(
      currentUser(f.owner),
      f.workspaceId,
      f.documentId,
      await f.revision(),
      'target'
    );
    t.deepEqual(await f.placements(), ['target']);
  }
);

test.serial(
  'document move cannot treat Office or a missing document as a page',
  async t => {
    const f = await fixture();
    const office = await app.get(WorkspaceNativeResourceService).create({
      ...f.input,
      title: 'native.docx',
      content: { format: 'docx', paragraphs: [{ text: 'native' }] },
      requestKey: 'office',
    });
    for (const id of [office.id, 'missing'])
      await t.throwsAsync(
        f.resolver.moveWorkspaceDocument(
          currentUser(f.owner),
          f.workspaceId,
          id,
          await f.revision(),
          'target'
        )
      );
    t.is(
      (
        await app
          .get(WorkspaceNativeResourceService)
          .get({ ...f.input, resourceId: office.id, kind: 'office' })
      ).contentVersion,
      1
    );
  }
);
