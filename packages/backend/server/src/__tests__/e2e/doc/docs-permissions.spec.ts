import { randomUUID } from 'node:crypto';

import {
  getDocRolePermissionsQuery,
  getDocsRolePermissionsQuery,
} from '@affine/graphql';

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

e2e('batch doc permissions match the single-doc ACL decision', async t => {
  const { member, workspace, createDoc } = await createWorkspaceWithMember();
  const readable = await createDoc(DocRole.Editor);
  const hidden = await createDoc(DocRole.None);
  const missing = randomUUID();

  await app.switchUser(member);
  const {
    workspace: { docsPermissions },
  } = await app.gql({
    query: getDocsRolePermissionsQuery,
    variables: {
      workspaceId: workspace.id,
      docIds: [readable.docId, hidden.docId, missing, readable.docId],
    },
  });
  const byId = new Map(docsPermissions.map(check => [check.docId, check]));
  t.is(docsPermissions.length, 3);
  t.is(byId.get(hidden.docId)?.status, 'denied');
  t.is(byId.get(hidden.docId)?.permissions, null);
  t.is(byId.get(missing)?.status, 'missing');

  const granted = byId.get(readable.docId);
  t.is(granted?.status, 'granted');
  const single = await app.gql({
    query: getDocRolePermissionsQuery,
    variables: { workspaceId: workspace.id, docId: readable.docId },
  });
  t.deepEqual(granted?.permissions, single.workspace.doc.permissions);
  t.true(granted?.permissions?.Doc_Read);
});

e2e('batch doc permissions reject more than 100 documents', async t => {
  const { member, workspace } = await createWorkspaceWithMember();
  await app.switchUser(member);
  await t.throwsAsync(
    app.gql({
      query: getDocsRolePermissionsQuery,
      variables: {
        workspaceId: workspace.id,
        docIds: Array.from({ length: 101 }, () => randomUUID()),
      },
    }),
    { message: /max length is 100/ }
  );
});

e2e('batch doc permissions require workspace access', async t => {
  const { workspace, createDoc } = await createWorkspaceWithMember();
  const doc = await createDoc(DocRole.Editor);
  const outsider = await app.signup();
  await app.switchUser(outsider);
  await t.throwsAsync(
    app.gql({
      query: getDocsRolePermissionsQuery,
      variables: { workspaceId: workspace.id, docIds: [doc.docId] },
    })
  );
});
