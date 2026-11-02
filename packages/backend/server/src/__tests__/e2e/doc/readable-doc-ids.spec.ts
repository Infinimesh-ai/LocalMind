import { randomUUID } from 'node:crypto';

import {
  getDocRolePermissionsQuery,
  getReadableDocIdsQuery,
} from '@affine/graphql';
import { PrismaClient } from '@prisma/client';

import { PermissionAccess } from '../../../core/permission';
import { DocRole, WorkspaceRole } from '../../../models';
import { Mockers } from '../../mocks';
import { app, e2e } from '../test';

async function createWorkspaceWithMember() {
  const owner = await app.signup();
  const member = await app.createUser();
  await app.login(member);
  await app.switchUser(owner);
  const workspace = await app.create(Mockers.Workspace, {
    owner: { id: owner.id },
  });
  await app.create(Mockers.WorkspaceUser, {
    workspaceId: workspace.id,
    userId: member.id,
    type: WorkspaceRole.Collaborator,
  });
  const createDoc = async (defaultRole: DocRole) => {
    const snapshot = await app.create(Mockers.DocSnapshot, {
      workspaceId: workspace.id,
      user: owner,
    });
    return await app.create(Mockers.DocMeta, {
      workspaceId: workspace.id,
      docId: snapshot.id,
      defaultRole,
    });
  };
  return { owner, member, workspace, createDoc };
}

async function readableDocIds(workspaceId: string, docIds: string[]) {
  const result = await app.gql({
    query: getReadableDocIdsQuery,
    variables: { workspaceId, docIds },
  });
  return result.workspace.readableDocIds;
}

e2e('readable doc IDs match the single-doc Doc_Read decision', async t => {
  const { member, workspace, createDoc } = await createWorkspaceWithMember();
  const readable = await createDoc(DocRole.Editor);
  const hidden = await createDoc(DocRole.None);
  const granted = await createDoc(DocRole.None);
  await app.create(Mockers.DocUser, {
    workspaceId: workspace.id,
    docId: granted.docId,
    userId: member.id,
    type: DocRole.Reader,
  });
  const unknown = randomUUID();

  await app.switchUser(member);
  const ids = [readable.docId, hidden.docId, granted.docId, unknown];
  const result = await readableDocIds(workspace.id, [...ids, readable.docId]);

  for (const docId of ids) {
    const single = await app
      .gql({
        query: getDocRolePermissionsQuery,
        variables: { workspaceId: workspace.id, docId },
      })
      .then(
        data => data.workspace.doc.permissions.Doc_Read,
        () => false
      );
    t.is(result.includes(docId), single, docId);
  }
  // Duplicates are removed; a denied document is simply absent.
  t.deepEqual(
    [...result].sort(),
    [readable.docId, granted.docId, unknown].sort()
  );
});

e2e('readable doc IDs reject more than 100 distinct documents', async t => {
  const { member, workspace } = await createWorkspaceWithMember();
  await app.switchUser(member);
  const ids = Array.from({ length: 100 }, () => randomUUID());
  t.is((await readableDocIds(workspace.id, [...ids, ids[0]])).length, 100);
  await t.throwsAsync(readableDocIds(workspace.id, [...ids, randomUUID()]), {
    message: /max length is 100/,
  });
});

e2e('readable doc IDs require workspace access', async t => {
  const { workspace, createDoc } = await createWorkspaceWithMember();
  const doc = await createDoc(DocRole.Editor);
  const outsider = await app.signup();
  await app.switchUser(outsider);
  await t.throwsAsync(readableDocIds(workspace.id, [doc.docId]));
});

e2e(
  'a project grant does not make a doc readable through Workspace access',
  async t => {
    const { owner, member, workspace, createDoc } =
      await createWorkspaceWithMember();
    const doc = await createDoc(DocRole.None);
    const db = app.get(PrismaClient);
    const project = await db.aiContextProject.create({
      data: {
        name: 'Project',
        createdByUserId: owner.id,
        members: {
          create: [
            { userId: owner.id, role: 'owner' },
            { userId: member.id, role: 'member' },
          ],
        },
      },
    });
    await db.aiContextProjectGrant.create({
      data: {
        projectId: project.id,
        workspaceId: workspace.id,
        docId: doc.docId,
        level: 'read',
        source: 'direct',
        grantedByUserId: owner.id,
        grantorUserIdSnapshot: owner.id,
      },
    });
    // Positive control: the grant is effective inside its project scope.
    const scoped = await app
      .get(PermissionAccess)
      .user(member.id)
      .workspace(workspace.id)
      .projectScope(project.id)
      .docs([{ docId: doc.docId }], 'Doc.Read');
    t.is(scoped.length, 1);

    await app.switchUser(member);
    t.deepEqual(await readableDocIds(workspace.id, [doc.docId]), []);
  }
);
