import { randomUUID } from 'node:crypto';

import {
  createWorkspaceNativeResourceMutation,
  saveWorkspaceNativeFileMutation,
  workspaceNativeFileTextQuery,
} from '@affine/graphql';
import { PrismaClient } from '@prisma/client';
import test from 'ava';

import {
  WorkspaceNativeResourceAccess,
  WorkspaceOrganizationService,
} from '../../core/doc';
import { OfficeArtifactService } from '../../core/office/artifact-service';
import { OfficeCommentService } from '../../core/office/comment-service';
import { WorkspaceNativeResourceIndexer } from '../../core/office/workspace-resource-indexer';
import { WorkspaceNativeResourceService } from '../../core/office/workspace-resource-service';
import { PermissionAccess, PermissionService } from '../../core/permission';
import { assertCurrentProjectToolContract } from '../../models/common/copilot-tool-contract';
import { createWorkspaceNativeTools } from '../../plugins/copilot/tools/workspace-native';
import { createWorkspaceOrganizationTools } from '../../plugins/copilot/tools/workspace-organization';
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
  return {
    service: app.get(WorkspaceNativeResourceService),
    db: app.get(PrismaClient),
    actorId: user.id,
    workspaceId: workspace.id,
  };
}

test.serial(
  'Workspace GraphQL creates and saves native files with browser input shapes',
  async t => {
    const user = await app.createUser();
    await app
      .POST('/api/auth/sign-in')
      .send({ email: user.email, password: user.password })
      .expect(200);
    const workspace = await app.models.workspace.create(user.id);
    const actor = { workspaceId: workspace.id };
    const result = await app.gql<{
      createWorkspaceNativeResource: { id: string; contentVersion: number };
    }>(createWorkspaceNativeResourceMutation.query, {
      input: {
        workspaceId: actor.workspaceId,
        title: 'browser-json',
        requestKey: 'browser-create',
        content: { format: 'json', text: '{}' },
      },
    });
    t.is(result.createWorkspaceNativeResource.contentVersion, 1);
    const identity = {
      workspaceId: actor.workspaceId,
      resourceId: result.createWorkspaceNativeResource.id,
      kind: 'file',
    };
    const input = {
      ...identity,
      expectedContentVersion: 1,
      text: '{"browser":true}',
      requestKey: 'browser-save',
    };
    const saved = await app.gql<{
      saveWorkspaceNativeFile: { id: string; contentVersion: number };
    }>(saveWorkspaceNativeFileMutation.query, { input });
    t.is(saved.saveWorkspaceNativeFile.id, identity.resourceId);
    t.is(saved.saveWorkspaceNativeFile.contentVersion, 2);
    const read = await app.gql<{ workspaceNativeFileText: { text: string } }>(
      workspaceNativeFileTextQuery.query,
      { input: identity }
    );
    t.is(read.workspaceNativeFileText.text, input.text);
    await t.throwsAsync(
      app.gql(saveWorkspaceNativeFileMutation.query, {
        input: { ...input, requestKey: 'stale-browser-save' },
      })
    );
  }
);

test.serial(
  'Workspace native text saves preserve identity, versions, creation evidence and exact retry semantics',
  async t => {
    const { service, db, ...actor } = await fixture();
    for (const format of ['txt', 'md', 'json', 'csv'] as const) {
      const content =
        format === 'csv'
          ? { format, rows: [['before']] }
          : { format, text: format === 'json' ? '{"before":1}' : 'before' };
      const created = await service.create({
        ...actor,
        title: `file.${format}`,
        requestKey: `create-${format}`,
        content,
      });
      const identity = {
        ...actor,
        resourceId: created.id,
        kind: 'file' as const,
      };
      const original = await db.workspaceFile.findUniqueOrThrow({
        where: { id: created.id },
      });
      const input = {
        ...identity,
        expectedContentVersion: 1,
        requestKey: `save-${format}`,
        text: format === 'json' ? '{"after":2}' : 'after',
      };
      const saved = await service.save(input);
      t.is(saved.id, created.id);
      t.is(saved.contentVersion, 2);
      t.is((await service.save(input)).contentVersion, 2);
      t.is((await service.readText(identity)).text, input.text);
      await t.throwsAsync(service.save({ ...input, text: 'different' }));
      await t.throwsAsync(
        service.save({ ...input, requestKey: `stale-${format}` })
      );
      t.deepEqual(
        await db.workspaceFile.findUniqueOrThrow({ where: { id: created.id } }),
        original
      );
      const restored = await service.restoreVersion({
        ...identity,
        expectedContentVersion: 2,
        sequence: 1,
        requestKey: `history-${format}`,
      });
      t.is(restored.contentVersion, 3);
      t.deepEqual(
        await service.save(input),
        saved,
        'replay returns the applied version even after a later edit'
      );
      t.deepEqual(
        await service.create({
          ...actor,
          title: `file.${format}`,
          requestKey: `create-${format}`,
          content,
        }),
        created
      );
      t.deepEqual(
        (await service.history(identity)).map(r => r.sequence),
        [3, 2, 1]
      );
      t.true((await service.readText(identity)).text.includes('before'));
    }
  }
);

test.serial(
  'Workspace lifecycle hides content and search, preserves receipts and permits explicit restoration',
  async t => {
    const { service, db, ...actor } = await fixture();
    const created = await service.create({
      ...actor,
      title: 'report.txt',
      content: { format: 'txt', text: 'findable contents' },
      requestKey: 'create',
    });
    const identity = {
      ...actor,
      resourceId: created.id,
      kind: 'file' as const,
    };
    t.is(
      (await service.list({ ...actor, query: 'findable' })).items[0].id,
      created.id
    );
    const renamed = await service.change({
      ...identity,
      action: 'rename',
      title: 'new.txt',
      expectedVersion: 1,
      requestKey: 'rename',
    });
    t.is(renamed.title, 'new.txt');
    const trash = await service.change({
      ...identity,
      action: 'trash',
      expectedVersion: 2,
      requestKey: 'trash',
    });
    t.is((await service.list(actor)).items.length, 0);
    t.is(
      (await service.list({ ...actor, trash: true })).items[0].id,
      created.id
    );
    await t.throwsAsync(service.readText(identity));
    await t.throwsAsync(
      service.save({
        ...identity,
        expectedContentVersion: 1,
        requestKey: 'blocked',
        text: 'no',
      })
    );
    await service.change({
      ...identity,
      action: 'restore',
      expectedVersion: trash.metadataVersion,
      requestKey: 'restore',
    });
    const copy = await service.copy({
      ...identity,
      title: 'copy.txt',
      expectedContentVersion: 1,
      requestKey: 'copy',
    });
    t.not(copy.id, created.id);
    t.is(
      (
        await service.copy({
          ...identity,
          title: 'copy.txt',
          expectedContentVersion: 1,
          requestKey: 'copy',
        })
      ).id,
      copy.id
    );
    t.is(
      (await service.readText({ ...identity, resourceId: copy.id })).text,
      'findable contents'
    );
    const retrash = await service.change({
      ...identity,
      action: 'trash',
      expectedVersion: 4,
      requestKey: 'retrash',
    });
    const deletion = {
      ...identity,
      action: 'delete' as const,
      expectedVersion: retrash.metadataVersion,
      requestKey: 'delete',
    };
    await service.change(deletion);
    await service.change(deletion);
    await t.throwsAsync(
      service.change({
        ...identity,
        action: 'restore',
        expectedVersion: 6,
        requestKey: 'undelete',
      })
    );
    t.is(
      await db.workspaceFileRevision.count({ where: { fileId: created.id } }),
      1
    );
    t.true((await db.workspaceNativeOperation.count()) >= 7);
  }
);

test.serial(
  'Workspace native writes reject lost access and concurrent stale content without duplicates',
  async t => {
    const { service, ...actor } = await fixture();
    const created = await service.create({
      ...actor,
      title: 'concurrent.txt',
      content: { format: 'txt', text: '' },
      requestKey: 'create',
    });
    const identity = {
      ...actor,
      resourceId: created.id,
      kind: 'file' as const,
    };
    const results = await Promise.allSettled(
      ['a', 'b'].map(text =>
        service.save({
          ...identity,
          expectedContentVersion: 1,
          requestKey: text,
          text,
        })
      )
    );
    t.is(results.filter(r => r.status === 'fulfilled').length, 1);
    t.is((await service.history(identity)).length, 2);
    const outsider = await app.createUser();
    await t.throwsAsync(
      service.readText({ ...identity, actorId: outsider.id })
    );
    await t.throwsAsync(
      service.save({
        ...identity,
        actorId: outsider.id,
        expectedContentVersion: 2,
        requestKey: 'outsider',
        text: 'no',
      })
    );
  }
);

test.serial(
  'Workspace Office lifecycle applies to assets and comments, and copies keep native packages',
  async t => {
    const { service, ...actor } = await fixture();
    for (const content of [
      { format: 'docx' as const, paragraphs: [{ text: 'Office contents' }] },
      {
        format: 'xlsx' as const,
        sheets: [{ name: 'Sheet', rows: [['Office contents']] }],
      },
      {
        format: 'pptx' as const,
        slides: [{ title: 'Office contents', paragraphs: [] }],
      },
    ]) {
      const created = await service.create({
        ...actor,
        title: content.format,
        content,
        requestKey: content.format,
      });
      const identity = {
        ...actor,
        resourceId: created.id,
        kind: 'office' as const,
      };
      const original = await app
        .get(OfficeArtifactService)
        .readRevisionAsset(
          actor.workspaceId,
          actor.actorId,
          created.id,
          created.revisionId,
          'package'
        );
      const copy = await service.copy({
        ...identity,
        title: `copy.${content.format}`,
        expectedContentVersion: 1,
        requestKey: `copy-${content.format}`,
      });
      const copied = await app
        .get(OfficeArtifactService)
        .readRevisionAsset(
          actor.workspaceId,
          actor.actorId,
          copy.id,
          copy.revisionId,
          'package'
        );
      t.deepEqual(copied.bytes, original.bytes);
      t.is(
        (
          await service.restoreVersion({
            ...identity,
            sequence: 1,
            expectedContentVersion: 1,
            requestKey: `restore-${content.format}`,
          })
        ).contentVersion,
        2
      );
      await service.change({
        ...identity,
        action: 'trash',
        expectedVersion: 1,
        requestKey: `trash-${content.format}`,
      });
      await t.throwsAsync(
        app
          .get(OfficeArtifactService)
          .readRevisionAsset(
            actor.workspaceId,
            actor.actorId,
            created.id,
            created.revisionId,
            'package'
          )
      );
      await t.throwsAsync(
        app
          .get(OfficeCommentService)
          .list(actor.workspaceId, actor.actorId, created.id)
      );
    }
  }
);

test.serial(
  'Workspace directory native placements enforce source and target ACL and version checks',
  async t => {
    const { service, ...actor } = await fixture();
    const organization = app.get(WorkspaceOrganizationService);
    await organization.createResourceFolder({
      ...actor,
      folderId: 'folder',
      parentId: null,
      title: 'Folder',
      authorize: async () => {},
    });
    const created = await service.create({
      ...actor,
      title: 'placed.txt',
      content: { format: 'txt', text: 'placed' },
      requestKey: 'create',
      folderId: 'folder',
    });
    const identity = {
      ...actor,
      resourceId: created.id,
      kind: 'file' as const,
    };
    t.is(
      (await organization.nativeResourceLocations(identity)).placements[0]
        .parentId,
      'folder'
    );
    await t.throwsAsync(
      service.change({
        ...identity,
        action: 'move',
        folderId: null,
        expectedVersion: 1,
        expectedDirectoryVersion: 'stale',
        requestKey: 'bad-move',
      })
    );
    await service.change({
      ...identity,
      action: 'move',
      folderId: null,
      expectedVersion: 1,
      expectedDirectoryVersion: await organization.directoryRevision(
        actor.workspaceId,
        actor.actorId
      ),
      requestKey: 'move',
    });
    t.is(
      (await organization.nativeResourceLocations(identity)).placements.length,
      0
    );
  }
);

test.serial(
  'native folder trash restores only its own children and explicit relocation restores a single file',
  async t => {
    const { service, ...actor } = await fixture();
    const organization = app.get(WorkspaceOrganizationService);
    await organization.createResourceFolder({
      ...actor,
      folderId: 'native-folder',
      parentId: null,
      title: 'Native',
      authorize: async () => {},
    });
    const files = [];
    for (const name of ['live', 'already-trashed'])
      files.push(
        await service.create({
          ...actor,
          title: `${name}.txt`,
          content: { format: 'txt', text: name },
          folderId: 'native-folder',
          requestKey: name,
        })
      );
    const identity = (index: number) => ({
      ...actor,
      resourceId: files[index].id,
      kind: 'file' as const,
    });
    await service.change({
      ...identity(1),
      action: 'trash',
      expectedVersion: 1,
      requestKey: 'single-trash',
    });
    const folder = {
      workspaceId: actor.workspaceId,
      userId: actor.actorId,
      editorId: actor.actorId,
      folderId: 'native-folder',
      expectedName: 'Native',
      authorizeDocument: async () => {},
    };
    await organization.trashFolderTree({ ...folder, recursive: true });
    await t.throwsAsync(service.readText(identity(0)));
    t.is((await service.list({ ...actor, trash: true })).items.length, 2);
    await organization.restoreFolderTree(folder);
    t.is((await service.readText(identity(0))).text, 'live');
    await t.throwsAsync(service.readText(identity(1)));
    const trashed = await service.get(identity(1), true);
    await service.change({
      ...identity(1),
      action: 'restore',
      folderId: null,
      expectedVersion: trashed.metadataVersion,
      expectedDirectoryVersion: await organization.directoryRevision(
        actor.workspaceId,
        actor.actorId
      ),
      requestKey: 'restore-elsewhere',
    });
    t.is((await service.readText(identity(1))).text, 'already-trashed');
    t.is(
      (await organization.nativeResourceLocations(identity(1))).placements
        .length,
      0
    );
    await organization.trashFolderTree({ ...folder, recursive: true });
    await organization.deleteFolderTreePermanently(folder);
    await t.throwsAsync(service.get(identity(0), true));
    t.is((await service.readText(identity(1))).text, 'already-trashed');
  }
);

test.serial(
  'copy receipts bind source identity and version even after subsequent source edits',
  async t => {
    const { service, ...actor } = await fixture();
    const created = await service.create({
      ...actor,
      title: 'copy-source.txt',
      content: { format: 'txt', text: 'before' },
      requestKey: 'source',
    });
    const identity = {
      ...actor,
      resourceId: created.id,
      kind: 'file' as const,
    };
    const input = {
      ...identity,
      title: 'copy.txt',
      expectedContentVersion: 1,
      requestKey: 'copy',
    };
    const copy = await service.copy(input);
    await service.save({
      ...identity,
      expectedContentVersion: 1,
      requestKey: 'change',
      text: 'after',
    });
    t.is((await service.copy(input)).id, copy.id);
    t.is(
      (await service.readText({ ...identity, resourceId: copy.id })).text,
      'before'
    );
    await t.throwsAsync(service.copy({ ...input, expectedContentVersion: 2 }));
    await t.throwsAsync(service.copy({ ...input, resourceId: copy.id }));
  }
);

test.serial(
  'native Blob references cannot bypass directory permissions through reads, copies or Office import',
  async t => {
    const { service, db, ...owner } = await fixture();
    const member = await app.createUser();
    await db.workspaceMember.create({
      data: {
        workspaceId: owner.workspaceId,
        userId: member.id,
        role: 'member',
        state: 'active',
      },
    });
    const organization = app.get(WorkspaceOrganizationService);
    await organization.createResourceFolder({
      ...owner,
      folderId: 'private',
      parentId: null,
      title: 'Private',
      authorize: async () => {},
    });
    const text = await service.create({
      ...owner,
      title: 'secret.txt',
      folderId: 'private',
      requestKey: 'secret',
      content: { format: 'txt', text: 'private text' },
    });
    const office = await service.create({
      ...owner,
      title: 'secret.docx',
      folderId: 'private',
      requestKey: 'secret-office',
      content: { format: 'docx', paragraphs: [{ text: 'private office' }] },
    });
    await app.models.workspaceDirectoryGrant.set({
      ...owner,
      directoryId: 'private',
      principalId: member.id,
      rights: {
        canRead: false,
        canWrite: false,
        canOrganize: false,
        canCreateFolder: false,
      },
    });
    const actor = { workspaceId: owner.workspaceId, actorId: member.id };
    for (const file of [text, office]) {
      const source = await app.models.workspaceNativeResource.get({
        ...owner,
        resourceId: file.id,
        kind: file.kind,
      });
      await t.throwsAsync(
        app
          .get(WorkspaceNativeResourceAccess)
          .assertBlobRead({ ...actor, key: source.blobKey })
      );
      await t.throwsAsync(
        service.create({
          ...actor,
          title: file.title,
          blobKey: source.blobKey,
          requestKey: `steal-${file.id}`,
        })
      );
    }
    t.is((await service.list(actor)).items.length, 0);
    t.is(
      (
        await organization.readDirectory(actor.workspaceId, actor.actorId)
      ).entries.filter(
        row => row.row.type === 'file' || row.row.type === 'office'
      ).length,
      0
    );
    // Known generated content is an independent user contribution, even if bytes deduplicate.
    const own = await service.create({
      ...actor,
      title: 'own.txt',
      requestKey: 'known-content',
      content: { format: 'txt', text: 'private text' },
    });
    t.not(own.id, text.id);
    t.is(
      (await service.readText({ ...actor, resourceId: own.id, kind: 'file' }))
        .text,
      'private text'
    );
  }
);

test.serial(
  'index backfill derives searchable content from existing immutable file and Office revisions',
  async t => {
    const { service, db, ...actor } = await fixture();
    const file = await service.create({
      ...actor,
      title: 'legacy.txt',
      content: { format: 'txt', text: 'backfill-text-token' },
      requestKey: 'legacy',
    });
    const office = await service.create({
      ...actor,
      title: 'legacy.docx',
      content: {
        format: 'docx',
        paragraphs: [{ text: 'backfill-office-token' }],
      },
      requestKey: 'legacy-office',
    });
    await db.workspaceFileState.update({
      where: { fileId: file.id },
      data: { searchVersion: 0, searchText: '' },
    });
    await db.workspaceOfficeState.update({
      where: { artifactId: office.id },
      data: { searchVersion: 0, searchText: '' },
    });
    await app.get(WorkspaceNativeResourceIndexer).run({});
    t.is(
      (await service.list({ ...actor, query: 'backfill-text-token' })).items[0]
        .id,
      file.id
    );
    t.is(
      (await service.list({ ...actor, query: 'backfill-office-token' }))
        .items[0].id,
      office.id
    );
    t.is(
      (await service.get({ ...actor, resourceId: file.id, kind: 'file' }))
        .searchStatus,
      'content'
    );
  }
);

test.serial(
  'internal Workspace AI binds complete reads, frozen requests, current scope and explicit destructive intent',
  async t => {
    const { service, db, ...actor } = await fixture();
    await db.aiPrompt.create({ data: { name: 'native-tools', model: 'test' } });
    const session = await db.aiSession.create({
      data: {
        id: randomUUID(),
        userId: actor.actorId,
        workspaceId: actor.workspaceId,
        scopeType: 'workspace',
        promptName: 'native-tools',
        promptAction: '',
      },
    });
    const options = {
      user: actor.actorId,
      workspace: actor.workspaceId,
      session: session.id,
      tools: [
        'docRead',
        'docUpdate',
        'docUpdateMeta',
        'docCreate',
        'workspaceOrganization',
      ],
    } as const;
    const toolOptions = { ...options, tools: [...options.tools] };
    const tools = createWorkspaceNativeTools(
      app.models,
      service,
      toolOptions,
      true
    );
    t.true(Object.keys(tools).every(name => name.startsWith('workspace_')));
    for (const name of [
      'workspace_file_update',
      'workspace_resource_update_meta',
      'workspace_resource_copy',
      'workspace_resource_restore_version',
    ])
      t.is(tools[name].sideEffectType, 'workspace_write');
    t.deepEqual(
      createWorkspaceNativeTools(
        app.models,
        service,
        { ...toolOptions, taskId: 'old-task' },
        true
      ),
      {}
    );
    t.falsy(
      createWorkspaceNativeTools(app.models, service, toolOptions, false)
        .workspace_file_update
    );
    for (const toolName of [
      'project_file_update',
      'project_resource_copy',
      'project_resource_restore_version',
    ]) {
      t.throws(() =>
        assertCurrentProjectToolContract({ version: 2, toolName })
      );
      t.notThrows(() =>
        assertCurrentProjectToolContract({ version: 3, toolName })
      );
    }
    const created = await service.create({
      ...actor,
      title: 'ai.txt',
      content: { format: 'txt', text: 'before' },
      requestKey: 'create',
    });
    const identity = {
      ...actor,
      resourceId: created.id,
      kind: 'file' as const,
    };
    const args = {
      resource_id: created.id,
      expected_content_version: 1,
      text: 'after',
    };
    const write = () =>
      Promise.resolve(
        tools.workspace_file_update.execute!(args, { toolCallId: 'save' })
      );
    await t.throwsAsync(write(), { message: /Read the complete/ });
    await tools.workspace_file_read.execute!({ resource_id: created.id }, {});
    await write();
    await write();
    t.is((await service.get(identity)).contentVersion, 2);
    t.is((await service.readText(identity)).text, 'after');
    await service.change({
      ...identity,
      action: 'trash',
      expectedVersion: 1,
      requestKey: 'trash',
    });
    const deletion = {
      resource_id: created.id,
      kind: 'file',
      action: 'delete',
      expected_version: 2,
      confirm_permanent_deletion: true,
    };
    await t.throwsAsync(
      Promise.resolve(
        tools.workspace_resource_update_meta.execute!(deletion, {
          toolCallId: 'delete',
          messages: [{ role: 'user', content: '整理这些文件' }],
        })
      ),
      { message: /explicit user request/ }
    );
    await tools.workspace_resource_update_meta.execute!(deletion, {
      toolCallId: 'delete',
      messages: [{ role: 'user', content: '永久删除回收站中的这个文件' }],
    });
    await t.throwsAsync(service.get(identity, true));
    await db.aiSession.update({
      where: { id: session.id },
      data: { deletedAt: new Date() },
    });
    await t.throwsAsync(
      Promise.resolve(tools.workspace_resource_list.execute!({}, {})),
      { message: /authorization changed/ }
    );
  }
);

test.serial(
  'legacy Office placements retain native ACL and folder lifecycle; frozen folder tools cannot acquire native writes',
  async t => {
    const { service, db, ...actor } = await fixture();
    const organization = app.get(WorkspaceOrganizationService);
    const office = await service.create({
      ...actor,
      title: 'legacy.docx',
      content: { format: 'docx', paragraphs: [{ text: 'legacy contents' }] },
      requestKey: 'legacy-office',
    });
    await organization.createResourceFolder({
      ...actor,
      folderId: 'legacy-folder',
      parentId: null,
      title: 'Legacy',
      authorize: async () => {},
    });
    await organization.applyDataOperations(
      actor.workspaceId,
      actor.actorId,
      actor.actorId,
      'folders',
      [
        {
          op: 'upsert',
          key: 'old-office-placement',
          values: {
            type: 'doc',
            data: office.id,
            parentId: 'legacy-folder',
            index: 'a0',
          },
        },
      ]
    );
    const identity = {
      ...actor,
      resourceId: office.id,
      kind: 'office' as const,
    };
    t.is(
      (await organization.nativeResourceLocations(identity)).locations[0]
        .folderId,
      'legacy-folder'
    );
    t.is(
      (
        await organization.readDirectory(actor.workspaceId, actor.actorId)
      ).entries.find(row => row.row.data === office.id)?.row.type,
      'office'
    );
    const folder = {
      workspaceId: actor.workspaceId,
      userId: actor.actorId,
      editorId: actor.actorId,
      folderId: 'legacy-folder',
      expectedName: 'Legacy',
      authorizeDocument: async () => {
        t.fail('Office must not be handled as a BlockSuite page');
      },
    };
    await t.throwsAsync(
      organization.withAiWriteAudit(actor, () =>
        organization.trashFolderTree({ ...folder, recursive: true })
      ),
      { message: /frozen directory tool/ }
    );
    const nativeTools = createWorkspaceOrganizationTools(
      app.get(PermissionAccess),
      app.get(PermissionService),
      organization,
      { user: actor.actorId, workspace: actor.workspaceId },
      true
    );
    t.true(
      Object.keys(nativeTools).every(name =>
        name.startsWith('workspace_native_folder_')
      )
    );
    t.is(
      nativeTools.workspace_native_folder_trash.sideEffectType,
      'workspace_write'
    );
    t.deepEqual(
      createWorkspaceOrganizationTools(
        app.get(PermissionAccess),
        app.get(PermissionService),
        organization,
        { user: actor.actorId, workspace: actor.workspaceId, taskId: 'old' },
        true
      ),
      {}
    );
    await organization.trashFolderTree({ ...folder, recursive: true });
    await t.throwsAsync(service.get(identity));
    await organization.restoreFolderTree(folder);
    t.is((await service.get(identity)).contentVersion, 1);
    const member = await app.createUser();
    await db.workspaceMember.create({
      data: {
        workspaceId: actor.workspaceId,
        userId: member.id,
        role: 'member',
        state: 'active',
      },
    });
    await app.models.workspaceDirectoryGrant.set({
      ...actor,
      directoryId: 'legacy-folder',
      principalId: member.id,
      rights: {
        canRead: false,
        canWrite: false,
        canOrganize: false,
        canCreateFolder: false,
      },
    });
    await t.throwsAsync(service.get({ ...identity, actorId: member.id }));
    t.is(
      (await service.list({ ...actor, actorId: member.id })).items.length,
      0
    );
    await organization.trashFolderTree({ ...folder, recursive: true });
    await organization.deleteFolderTreePermanently(folder);
    await t.throwsAsync(service.get(identity, true));
  }
);
