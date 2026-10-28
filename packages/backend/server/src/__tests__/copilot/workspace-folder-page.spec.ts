import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import test from 'ava';
import * as Y from 'yjs';

import { PgWorkspaceDocStorageAdapter } from '../../core/doc/adapters/workspace';
import { WorkspaceFolderPageService } from '../../core/doc/workspace-folder-page';
import { WorkspaceOrganizationService } from '../../core/doc/workspace-organization';
import { DocWriter } from '../../core/doc/writer';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
test.before(async () => {
  app = await createTestingApp();
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
  const folderId = randomUUID();
  const organization = app.get(WorkspaceOrganizationService);
  await organization.createResourceFolder({
    workspaceId: workspace.id,
    actorId: user.id,
    folderId,
    parentId: null,
    title: 'Destination',
    authorize: async () => {},
  });
  const command = {
    workspaceId: workspace.id,
    actorId: user.id,
    folderId,
    requestKey: randomUUID(),
    title: 'New page',
    primaryMode: 'page' as const,
  };
  return {
    user,
    command,
    organization,
    service: app.get(WorkspaceFolderPageService),
    db: app.get(PrismaClient),
  };
}

test.serial(
  'creation and concurrent response-loss retries commit one page and one intended placement',
  async t => {
    const { command, service, organization, db } = await fixture();
    const results = await Promise.all([
      service.create(command),
      service.create(command),
      service.create(command),
    ]);
    t.is(new Set(results.map(row => row.documentId)).size, 1);
    t.is(results.filter(row => !row.replayed).length, 1);
    const directory = await organization.readDirectory(
      command.workspaceId,
      command.actorId
    );
    const links = directory.entries.filter(
      entry => entry.row.data === results[0].documentId
    );
    t.is(links.length, 1);
    t.is(links[0].row.parentId, command.folderId);
    t.is(
      await db.workspaceFolderPageCreation.count({
        where: { workspaceId: command.workspaceId },
      }),
      1
    );
    await t.throwsAsync(service.create({ ...command, title: 'Different' }));
    await t.throwsAsync(service.create({ ...command, folderId: randomUUID() }));
    await t.throwsAsync(
      db.workspaceFolderPageCreation.update({
        where: {
          workspaceId_actorId_requestKey: {
            workspaceId: command.workspaceId,
            actorId: command.actorId,
            requestKey: command.requestKey,
          },
        },
        data: { documentId: randomUUID() },
      })
    );
  }
);

test.serial(
  'failure after writing the page rolls back root, content, placement and receipt; retry creates once',
  async t => {
    const { command, service, organization, db } = await fixture();
    const storage = app.get(PgWorkspaceDocStorageAdapter);
    const before = await storage.getDoc(
      command.workspaceId,
      command.workspaceId
    );
    const original = organization.applyDataOperations.bind(organization);
    organization.applyDataOperations = async (...args) => {
      if (args[3] === 'folders') throw new Error('injected placement failure');
      return original(...args);
    };
    try {
      await t.throwsAsync(service.create(command), {
        message: 'injected placement failure',
      });
    } finally {
      organization.applyDataOperations = original;
    }
    const after = await storage.getDoc(
      command.workspaceId,
      command.workspaceId
    );
    t.deepEqual(after?.bin, before?.bin);
    t.is(
      await db.workspaceFolderPageCreation.count({
        where: { workspaceId: command.workspaceId },
      }),
      0
    );
    t.is(
      await db.workspaceDoc.count({
        where: { workspaceId: command.workspaceId, title: command.title },
      }),
      0
    );
    const result = await service.create(command);
    t.false(result.replayed);
    t.is((await service.create(command)).documentId, result.documentId);
  }
);

test.serial(
  'live permissions and folder existence are checked before new creation and replay',
  async t => {
    const { command, service, organization, db } = await fixture();
    const result = await service.create(command);
    const outsider = await app.createUser();
    await t.throwsAsync(service.create({ ...command, actorId: outsider.id }));
    const authorize =
      organization.assertResourceFolderAccess.bind(organization);
    organization.assertResourceFolderAccess = async () => {
      throw new Error('permission revoked');
    };
    try {
      await t.throwsAsync(service.create(command), {
        message: 'permission revoked',
      });
    } finally {
      organization.assertResourceFolderAccess = authorize;
    }
    await t.throwsAsync(
      service.create({
        ...command,
        requestKey: randomUUID(),
        folderId: 'missing-folder',
      })
    );
    t.is(
      await db.workspaceFolderPageCreation.count({
        where: { workspaceId: command.workspaceId },
      }),
      1
    );
    t.is((await service.create(command)).documentId, result.documentId);
  }
);

test.serial(
  'replay never recreates a trashed page or moves a page back after a later move',
  async t => {
    const { command, service, organization, db } = await fixture();
    const result = await service.create(command);
    const folderId = randomUUID();
    await organization.createResourceFolder({
      ...command,
      folderId,
      parentId: null,
      title: 'Later destination',
      authorize: async () => {},
    });
    await organization.moveResourceDocument({
      ...command,
      documentId: result.documentId,
      folderId,
      authorize: async () => {},
    });
    t.true((await service.create(command)).replayed);
    const directory = await organization.readDirectory(
      command.workspaceId,
      command.actorId
    );
    t.is(
      directory.entries.find(entry => entry.row.data === result.documentId)?.row
        .parentId,
      folderId
    );
    await organization.applyRootOperations(
      command.workspaceId,
      command.actorId,
      [{ op: 'set_document_trashed', docId: result.documentId, trashed: true }]
    );
    await t.throwsAsync(service.create(command));
    t.is(
      await db.workspaceFolderPageCreation.count({
        where: { workspaceId: command.workspaceId },
      }),
      1
    );
  }
);

test.serial(
  'whiteboard creation preserves its mode and real GraphQL repeats the same receipt',
  async t => {
    const { user, command, service, organization } = await fixture();
    const result = await service.create({
      ...command,
      primaryMode: 'edgeless',
    });
    t.is(
      await organization.readDocumentPrimaryMode(
        command.workspaceId,
        result.documentId
      ),
      'edgeless'
    );
    await app
      .POST('/api/auth/sign-in')
      .set('x-affine-version', '0.27.0')
      .send({ email: user.email, password: user.password })
      .expect(200);
    const { actorId: _, ...input } = command;
    const query =
      'mutation($input: CreateWorkspaceFolderPageInput!) { createWorkspaceFolderPage(input: $input) { documentId folderId replayed } }';
    const response = await app.gql<{
      createWorkspaceFolderPage: typeof result;
    }>(query, { input: { ...input, primaryMode: 'edgeless' } });
    t.deepEqual(response.createWorkspaceFolderPage, {
      ...result,
      replayed: true,
    });
  }
);
