import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';

import {
  ProjectBlobStorage,
  ProjectModule,
  ProjectResourceService,
} from '../../core/project';
import { Models } from '../../models';
import { parseYDocFromBinary } from '../../native';
import { createTestingModule, type TestingModule } from '../utils';

const test = ava.serial as TestFn<{
  module: TestingModule;
  models: Models;
  db: PrismaClient;
  resources: ProjectResourceService;
  blobs: ProjectBlobStorage;
  projectId: string;
  actorId: string;
  memberId: string;
  outsiderId: string;
}>;

test.before(async t => {
  const module = await createTestingModule({ imports: [ProjectModule] });
  Object.assign(t.context, {
    module,
    db: module.get(PrismaClient),
    models: module.get(Models),
    resources: module.get(ProjectResourceService),
    blobs: module.get(ProjectBlobStorage),
  });
});

test.beforeEach(async t => {
  const { module, db, models } = t.context;
  await module.initTestingDB();
  const actor = await models.user.create({
    email: 'project-native-owner@example.com',
  });
  const member = await models.user.create({
    email: 'project-native-member@example.com',
  });
  const outsider = await models.user.create({
    email: 'project-native-outsider@example.com',
  });
  const project = await db.aiContextProject.create({
    data: {
      name: 'Native resources',
      aiPolicy: 'read_write',
      createdByUserId: actor.id,
      members: {
        create: [
          { userId: actor.id, role: 'owner' },
          { userId: member.id, role: 'member' },
        ],
      },
    },
  });
  Object.assign(t.context, {
    actorId: actor.id,
    memberId: member.id,
    outsiderId: outsider.id,
    projectId: project.id,
  });
});

test.after.always(async t => {
  await t.context.module.close();
});

test('Project text files save the same identity, reject stale writes and retain searchable immutable revisions', async t => {
  const { resources, models, blobs, db, outsiderId } = t.context;
  const scope = actor(t.context);
  for (const extension of ['txt', 'md', 'csv', 'json']) {
    const original = extension === 'json' ? '{"first":"原文"}' : '原文';
    const replacement =
      extension === 'json' ? '{"new":"searchneedle"}' : 'searchneedle';
    const blob = await blobs.put({
      ...scope,
      bytes: Buffer.from(original),
      mimeType: 'text/plain',
    });
    const file = await resources.createFile({
      ...scope,
      blobKey: blob.key,
      title: `文件.${extension}`,
      requestKey: extension,
    });
    const input = {
      ...scope,
      resourceId: file.id,
      expectedContentVersion: 1,
      requestKey: 'save',
      text: replacement,
      editLease: await editProof(models, scope, file.id),
    };
    t.is((await resources.readTextFile(input)).text, original);
    const saved = await resources.saveFile(input);
    t.is(saved.sequence, 2);
    t.is((await resources.saveFile(input)).id, saved.id);
    await t.throwsAsync(resources.saveFile({ ...input, requestKey: 'stale' }), {
      message: /content changed/,
    });
    await t.throwsAsync(resources.saveFile({ ...input, text: 'different' }), {
      message: /reused/,
    });
    await t.throwsAsync(
      resources.saveFile({
        ...input,
        actorId: outsiderId,
        expectedContentVersion: 2,
        requestKey: 'outsider',
      })
    );
    t.is(
      (await resources.readTextFile({ ...input, sequence: 1 })).text,
      original
    );
    t.is((await resources.readTextFile(input)).text, replacement);
    t.true(
      (
        await models.projectResource.search({ ...scope, query: 'searchneedle' })
      ).items.some(item => item.id === file.id)
    );
    t.is(
      await db.projectResourceRevision.count({
        where: { resourceId: file.id },
      }),
      2
    );
  }
});

test('Project file editing rejects binary, invalid UTF-8, oversized text, invalid JSON and lost leases', async t => {
  const { resources, models, blobs } = t.context;
  const scope = actor(t.context);
  for (const [title, bytes] of [
    ['binary.bin', Buffer.from([0, 1, 2])],
    ['invalid.txt', Buffer.from([255])],
    ['large.md', Buffer.alloc(1024 * 1024 + 1, 65)],
  ] as const) {
    const blob = await blobs.put({
      ...scope,
      bytes,
      mimeType: 'application/octet-stream',
    });
    const file = await resources.createFile({
      ...scope,
      blobKey: blob.key,
      title,
      requestKey: title,
    });
    await t.throwsAsync(
      resources.readTextFile({ ...scope, resourceId: file.id })
    );
    await t.throwsAsync(
      resources.saveFile({
        ...scope,
        resourceId: file.id,
        expectedContentVersion: 1,
        requestKey: 'text',
        text: 'unsafe',
        editLease: await editProof(models, scope, file.id),
      })
    );
    t.deepEqual(
      (await resources.readFile({ ...scope, resourceId: file.id })).bytes,
      bytes
    );
  }
  const blob = await blobs.put({
    ...scope,
    bytes: Buffer.from('{}'),
    mimeType: 'application/json',
  });
  const file = await resources.createFile({
    ...scope,
    blobKey: blob.key,
    title: 'data.json',
    requestKey: 'json',
  });
  const input = {
    ...scope,
    resourceId: file.id,
    expectedContentVersion: 1,
    requestKey: 'bad',
    text: 'invalid',
  };
  await t.throwsAsync(resources.saveFile(input));
  await t.throwsAsync(
    resources.saveFile({
      ...input,
      editLease: await editProof(models, scope, file.id),
    }),
    { message: /valid JSON/ }
  );
});

function actor(context: { projectId: string; actorId: string }) {
  return { projectId: context.projectId, actorId: context.actorId };
}

async function editProof(
  models: Models,
  scope: { projectId: string; actorId: string },
  resourceId: string
) {
  const identity = { kind: 'user' as const, tabId: randomUUID() };
  const result = await models.projectResourceEditLease.acquire({
    ...scope,
    ...identity,
    resourceId,
  });
  if (!result.acquired || !result.lease)
    throw new Error('Fixture lease denied');
  return { ...identity, leaseId: result.lease.leaseId };
}

test('Project text search follows committed versions, excludes trashed ancestors and checks current membership', async t => {
  const { resources, models, db, outsiderId } = t.context;
  const scope = actor(t.context);
  const folder = await resources.createFolder({
    ...scope,
    title: 'Search folder',
    requestKey: 'search-folder',
  });
  const doc = await resources.createDocument({
    ...scope,
    title: 'Search document',
    markdown: 'needleoriginal internal text',
    parentId: folder.id,
    requestKey: 'search-doc',
  });
  const results = await models.projectResource.search({
    ...scope,
    query: 'needleoriginal',
  });
  t.is(results.items.length, 1);
  t.is(results.items[0].id, doc.id);
  t.is(results.items[0].contentVersion, 1);
  t.true(results.items[0].snippet.includes('needleoriginal'));
  t.deepEqual(
    results.items[0].path.map(p => p.title),
    ['Search folder', 'Search document']
  );
  await resources.updateMarkdown({
    ...scope,
    resourceId: doc.id,
    expectedContentVersion: 1,
    requestKey: 'search-update',
    editLease: await editProof(models, scope, doc.id),
    origin: 'user',
    markdown: 'needlereplacement updated text',
  });
  t.is(
    (await models.projectResource.search({ ...scope, query: 'needleoriginal' }))
      .items.length,
    0
  );
  t.is(
    (
      await models.projectResource.search({
        ...scope,
        query: 'needlereplacement',
      })
    ).items[0].contentVersion,
    2
  );
  await t.throwsAsync(
    models.projectResource.search({
      ...scope,
      actorId: outsiderId,
      query: 'needlereplacement',
    })
  );
  await resources.change({
    ...scope,
    resourceId: folder.id,
    expectedVersion: folder.version,
    requestKey: 'search-trash',
    trash: true,
  });
  t.is(
    (
      await models.projectResource.search({
        ...scope,
        query: 'needlereplacement',
      })
    ).items.length,
    0
  );
  await resources.change({
    ...scope,
    resourceId: folder.id,
    expectedVersion: folder.version + 1,
    requestKey: 'search-restore',
    trash: false,
  });
  t.is(
    (
      await models.projectResource.search({
        ...scope,
        query: 'needlereplacement',
      })
    ).items.length,
    1
  );
  await db.aiContextProjectMember.delete({
    where: {
      projectId_userId: {
        projectId: scope.projectId,
        userId: t.context.memberId,
      },
    },
  });
  await t.throwsAsync(
    models.projectResource.search({
      ...scope,
      actorId: t.context.memberId,
      query: 'needlereplacement',
    })
  );
});

test('Project search pagination is bounded and its cursor cannot cross projects or queries', async t => {
  const { resources, models, db } = t.context;
  const scope = actor(t.context);
  for (let i = 0; i < 3; i++)
    await resources.createDocument({
      ...scope,
      title: `Result ${i}`,
      markdown: 'searchpagination',
      requestKey: `search-page-${i}`,
    });
  const first = await models.projectResource.search({
    ...scope,
    query: 'searchpagination',
    limit: 2,
  });
  t.is(first.items.length, 2);
  t.truthy(first.nextCursor);
  const second = await models.projectResource.search({
    ...scope,
    query: 'searchpagination',
    cursor: first.nextCursor,
    limit: 2,
  });
  t.is(second.items.length, 1);
  t.is(second.nextCursor, null);
  t.false(first.items.some(row => row.id === second.items[0].id));
  await t.throwsAsync(
    models.projectResource.search({
      ...scope,
      query: 'another',
      cursor: first.nextCursor,
    })
  );
  await t.throwsAsync(
    models.projectResource.search({
      ...scope,
      query: 'searchpagination',
      limit: 101,
    })
  );
  const other = await db.aiContextProject.create({
    data: {
      name: 'Other search',
      members: { create: { userId: scope.actorId, role: 'owner' } },
    },
  });
  await t.throwsAsync(
    models.projectResource.search({
      ...scope,
      projectId: other.id,
      query: 'searchpagination',
      cursor: first.nextCursor,
    })
  );
  t.is(
    (
      await models.projectResource.search({
        ...scope,
        projectId: other.id,
        query: 'searchpagination',
      })
    ).items.length,
    0
  );
});

test('Two ordinary Project-only members collaborate on real Yjs documents with zero Workspace records', async t => {
  const { resources, models, db, memberId, outsiderId } = t.context;
  const scope = { ...actor(t.context), actorId: memberId };
  await db.aiContextProjectMember.create({
    data: { projectId: scope.projectId, userId: outsiderId, role: 'member' },
  });
  const folder = await resources.createFolder({
    ...scope,
    title: 'test1',
    requestKey: 'folder',
  });
  const document = await resources.createDocument({
    ...scope,
    parentId: folder.id,
    title: 'Document A',
    markdown: 'Initial body',
    requestKey: 'document',
  });
  const opened = await resources.readDocument({
    ...scope,
    resourceId: document.id,
  });
  const ydoc = new Doc();
  const firstLease = await editProof(models, scope, document.id);
  try {
    applyUpdate(ydoc, opened.bytes);
    t.true(ydoc.getMap('blocks').size > 0);
    ydoc.getMap('project-test').set('saved-content', 'Member edit');
    const revision = await resources.saveDocument({
      ...scope,
      resourceId: document.id,
      bytes: Buffer.from(encodeStateAsUpdate(ydoc)),
      expectedContentVersion: 1,
      requestKey: 'member-save',
      editLease: firstLease,
    });
    t.is(revision.sequence, 2);
    t.is(revision.parentId, opened.revision.id);
  } finally {
    ydoc.destroy();
    await models.projectResourceEditLease.release({
      ...scope,
      resourceId: document.id,
      ...firstLease,
    });
  }
  const reopened = await resources.readDocument({
    ...scope,
    actorId: outsiderId,
    resourceId: document.id,
  });
  const reloaded = new Doc();
  try {
    applyUpdate(reloaded, reopened.bytes);
    t.is(reloaded.getMap('project-test').get('saved-content'), 'Member edit');
    reloaded.getMap('project-test').set('collaborator', 'Second member edit');
    const revision = await resources.saveDocument({
      ...scope,
      actorId: outsiderId,
      resourceId: document.id,
      bytes: Buffer.from(encodeStateAsUpdate(reloaded)),
      expectedContentVersion: 2,
      requestKey: 'second-member-save',
      editLease: await editProof(
        models,
        { ...scope, actorId: outsiderId },
        document.id
      ),
    });
    t.is(revision.sequence, 3);
    const latest = await resources.readDocument({
      ...scope,
      resourceId: document.id,
    });
    const firstMemberView = new Doc();
    try {
      applyUpdate(firstMemberView, latest.bytes);
      t.is(
        firstMemberView.getMap('project-test').get('saved-content'),
        'Member edit'
      );
      t.is(
        firstMemberView.getMap('project-test').get('collaborator'),
        'Second member edit'
      );
    } finally {
      firstMemberView.destroy();
    }
  } finally {
    reloaded.destroy();
  }
  t.deepEqual(
    (
      await models.projectResource.path({ ...scope, resourceId: document.id })
    ).map(n => n.title),
    ['test1', 'Document A']
  );
  t.is(await db.workspace.count(), 0);
  t.is(await db.workspaceMember.count(), 0);
  t.is(await db.snapshot.count(), 0);
  t.is(await db.blob.count(), 0);
  t.is(await db.projectResourceRevision.count(), 3);
});

test('creation idempotency uses request identity and never merges distinct same-title intentions', async t => {
  const { resources, db } = t.context;
  const input = {
    ...actor(t.context),
    title: 'Same title',
    markdown: 'A',
    requestKey: 'first-intent',
  };
  const first = await resources.createDocument(input);
  const repeated = await resources.createDocument(input);
  t.is(repeated.id, first.id);
  const second = await resources.createDocument({
    ...input,
    requestKey: 'second-intent',
  });
  t.not(second.id, first.id);
  await t.throwsAsync(resources.createDocument({ ...input, markdown: 'B' }));
  t.is(await db.projectResource.count(), 2);
  t.is(await db.projectResourceRevision.count(), 2);
});

test('Markdown retries and tree retries preserve their committed version and synchronize titles', async t => {
  const { resources, models, db } = t.context;
  const scope = actor(t.context);
  const document = await resources.createDocument({
    ...scope,
    title: 'Original',
    markdown: 'Initial',
    requestKey: 'doc',
  });
  const save = {
    ...scope,
    resourceId: document.id,
    expectedContentVersion: 1,
    requestKey: 'markdown',
    markdown: 'Saved',
    origin: 'user' as const,
    editLease: await editProof(models, scope, document.id),
  };
  const saved = await resources.updateMarkdown(save);
  t.is((await resources.updateMarkdown(save)).id, saved.id);
  await t.throwsAsync(
    resources.updateMarkdown({ ...save, markdown: 'Changed retry' })
  );
  const rename = {
    ...scope,
    resourceId: document.id,
    expectedVersion: document.version,
    requestKey: 'rename',
    title: 'Renamed',
    editLease: save.editLease,
  };
  const renamed = await resources.change(rename);
  t.is((await resources.change(rename)).version, renamed.version);
  await t.throwsAsync(resources.change({ ...rename, title: 'Other' }));
  const reopened = await resources.readDocument({
    ...scope,
    resourceId: document.id,
  });
  t.is(parseYDocFromBinary(reopened.bytes, document.id).title, 'Renamed');
  t.is(reopened.resource.title, 'Renamed');
  t.is(await db.projectResourceRevision.count(), 3);
  t.is(
    await db.projectResourceAuditEvent.count({
      where: { requestKey: 'rename' },
    }),
    1
  );
  await t.throwsAsync(
    resources.createDocument({
      ...scope,
      title: 'Unverified AI',
      markdown: 'Secret',
      requestKey: 'unknown-ai',
      origin: 'ai',
    })
  );
  t.is((await models.projectResource.list(scope)).items.length, 1);
});

test('nested Trash entries and attachment downloads respect the complete resource path', async t => {
  const { resources, blobs, models, memberId } = t.context;
  const scope = actor(t.context);
  const parent = await resources.createFolder({
    ...scope,
    title: 'Parent',
    requestKey: 'parent',
  });
  const blob = await blobs.put({
    ...scope,
    bytes: Buffer.from('Project attachment'),
    mimeType: 'text/plain',
  });
  const file = await resources.createFile({
    ...scope,
    title: 'notes.txt',
    parentId: parent.id,
    blobKey: blob.key,
    requestKey: 'file',
  });
  const member = { ...scope, actorId: memberId, key: blob.key };
  await models.projectResource.assertBlobDownload(member);
  const trashed = await resources.change({
    ...scope,
    resourceId: file.id,
    expectedVersion: file.version,
    requestKey: 'trash',
    trash: true,
  });
  t.deepEqual(
    (await models.projectResource.list({ ...scope, trash: true })).items.map(
      item => item.id
    ),
    [file.id]
  );
  await t.throwsAsync(models.projectResource.assertBlobDownload(member));
  await t.throwsAsync(
    models.projectResource.assertBlobDownload({ ...scope, key: blob.key })
  );
  await resources.change({
    ...scope,
    resourceId: file.id,
    expectedVersion: trashed.version,
    requestKey: 'restore',
    trash: false,
  });
  await models.projectResource.assertBlobDownload(member);
  await resources.change({
    ...scope,
    resourceId: parent.id,
    expectedVersion: parent.version,
    requestKey: 'trash-parent',
    trash: true,
  });
  await t.throwsAsync(models.projectResource.assertBlobDownload(member));
  await t.throwsAsync(resources.readFile({ ...scope, resourceId: file.id }));
});

test('nonmembers, removed members and archived Projects cannot read content, Blobs, history or the tree', async t => {
  const { resources, blobs, models, db, outsiderId, memberId } = t.context;
  const doc = await resources.createDocument({
    ...actor(t.context),
    title: 'Restricted',
    markdown: 'Project private content',
    requestKey: 'doc',
  });
  const revision = await models.projectResource.revision({
    ...actor(t.context),
    resourceId: doc.id,
  });
  const denied = async (actorId: string) => {
    const scope = { ...actor(t.context), actorId };
    await t.throwsAsync(
      resources.readDocument({ ...scope, resourceId: doc.id })
    );
    await t.throwsAsync(blobs.read({ ...scope, key: revision.blobKey }));
    await t.throwsAsync(models.projectResource.list(scope));
    await t.throwsAsync(
      models.projectResource.revision({ ...scope, resourceId: doc.id })
    );
    await t.throwsAsync(
      resources.createFolder({
        ...scope,
        title: 'Forbidden',
        requestKey: randomUUID(),
      })
    );
  };
  await denied(outsiderId);
  await db.aiContextProjectMember.delete({
    where: { projectId_userId: { projectId: doc.projectId, userId: memberId } },
  });
  await denied(memberId);
  await db.aiContextProject.update({
    where: { id: doc.projectId },
    data: { status: 'archived' },
  });
  await denied(t.context.actorId);
});

test('concurrent content saves reject stale versions and preserve immutable history and audit', async t => {
  const { resources, models, db } = t.context;
  const scope = actor(t.context);
  const doc = await resources.createDocument({
    ...scope,
    title: 'Versioned',
    markdown: 'Old content',
    requestKey: 'doc',
  });
  const editLease = await editProof(models, scope, doc.id);
  const results = await Promise.allSettled(
    ['first', 'second'].map(requestKey =>
      resources.updateMarkdown({
        ...scope,
        resourceId: doc.id,
        markdown: requestKey,
        expectedContentVersion: 1,
        requestKey,
        origin: 'user',
        editLease,
      })
    )
  );
  t.is(results.filter(r => r.status === 'fulfilled').length, 1);
  t.is(results.filter(r => r.status === 'rejected').length, 1);
  const initial = await models.projectResource.revision({
    ...scope,
    resourceId: doc.id,
    sequence: 1,
  });
  await t.throwsAsync(
    db.projectResourceRevision.update({
      where: { id: initial.id },
      data: { origin: 'ai' },
    })
  );
  await t.throwsAsync(
    db.projectBlob.delete({
      where: {
        projectId_key: { projectId: scope.projectId, key: initial.blobKey },
      },
    })
  );
  await t.throwsAsync(
    db.projectResource.update({
      where: { id: doc.id },
      data: { contentVersion: 12 },
    })
  );
  const audit = await db.projectResourceAuditEvent.findFirstOrThrow({
    where: { resourceId: doc.id },
  });
  await t.throwsAsync(
    db.projectResourceAuditEvent.delete({ where: { id: audit.id } })
  );
  t.is(
    await db.projectResourceRevision.count({ where: { resourceId: doc.id } }),
    2
  );
  t.false(
    JSON.stringify(await db.projectResourceAuditEvent.findMany()).includes(
      'Old content'
    )
  );
});

test('nested folders survive moves, rename, trash and restore with version checks', async t => {
  const { resources, models } = t.context;
  const scope = actor(t.context);
  const left = await resources.createFolder({
    ...scope,
    title: 'Left',
    requestKey: 'left',
  });
  const right = await resources.createFolder({
    ...scope,
    title: 'Right',
    requestKey: 'right',
  });
  const child = await resources.createDocument({
    ...scope,
    parentId: left.id,
    title: 'Child',
    markdown: 'Preserved',
    requestKey: 'child',
  });
  const moved = await models.projectResource.change({
    ...scope,
    resourceId: child.id,
    expectedVersion: child.version,
    parentId: right.id,
    title: 'Renamed',
  });
  await t.throwsAsync(
    models.projectResource.change({
      ...scope,
      resourceId: child.id,
      expectedVersion: child.version,
      title: 'Stale rename',
    })
  );
  t.is(moved.parentId, right.id);
  const trashed = await models.projectResource.change({
    ...scope,
    resourceId: right.id,
    expectedVersion: right.version,
    trash: true,
  });
  await t.throwsAsync(
    resources.readDocument({ ...scope, resourceId: child.id })
  );
  await models.projectResource.change({
    ...scope,
    resourceId: right.id,
    expectedVersion: trashed.version,
    trash: false,
  });
  t.is(
    (await resources.readDocument({ ...scope, resourceId: child.id })).resource
      .title,
    'Renamed'
  );
});

test('tree cycles and forged cross-Project parents are rejected by the model and database', async t => {
  const { resources, models, db } = t.context;
  const scope = actor(t.context);
  const parent = await resources.createFolder({
    ...scope,
    title: 'Parent',
    requestKey: 'parent',
  });
  const child = await resources.createFolder({
    ...scope,
    parentId: parent.id,
    title: 'Child',
    requestKey: 'child',
  });
  await t.throwsAsync(
    models.projectResource.change({
      ...scope,
      resourceId: parent.id,
      parentId: child.id,
      expectedVersion: 1,
    })
  );
  await t.throwsAsync(
    db.projectResource.update({
      where: { id: parent.id },
      data: { parentId: child.id, version: 2 },
    })
  );
  const other = await db.aiContextProject.create({
    data: {
      name: 'Other',
      members: { create: { userId: scope.actorId, role: 'owner' } },
    },
  });
  const foreign = await resources.createFolder({
    ...scope,
    projectId: other.id,
    title: 'Foreign',
    requestKey: 'foreign',
  });
  await t.throwsAsync(
    resources.createFolder({
      ...scope,
      parentId: foreign.id,
      title: 'Invalid',
      requestKey: 'invalid',
    })
  );
  await t.throwsAsync(
    db.projectResource.update({
      where: { id: child.id },
      data: { parentId: foreign.id, version: 2 },
    })
  );
  await t.throwsAsync(
    db.projectResource.update({
      where: { id: child.id },
      data: { projectId: other.id },
    })
  );
});

test('folder uniqueness and request keys survive double submission', async t => {
  const { resources, db } = t.context;
  const input = {
    ...actor(t.context),
    title: 'Folder',
    requestKey: 'same-click',
  };
  const rows = await Promise.all([
    resources.createFolder(input),
    resources.createFolder(input),
  ]);
  t.is(rows[0].id, rows[1].id);
  await t.throwsAsync(
    resources.createFolder({
      ...input,
      title: 'folder',
      requestKey: 'another-click',
    })
  );
  t.is(await db.projectResource.count(), 1);
});

test('tree listing paginates only the selected parent and rejects reused cursors', async t => {
  const { resources, models } = t.context;
  const scope = actor(t.context);
  const folders = [];
  for (let n = 0; n < 5; n++)
    folders.push(
      await resources.createFolder({
        ...scope,
        title: `Folder ${n}`,
        requestKey: `folder-${n}`,
      })
    );
  await resources.createFolder({
    ...scope,
    parentId: folders[0].id,
    title: 'Nested',
    requestKey: 'nested',
  });
  const first = await models.projectResource.list({ ...scope, limit: 2 });
  t.is(first.items.length, 2);
  t.truthy(first.nextCursor);
  const second = await models.projectResource.list({
    ...scope,
    limit: 2,
    cursor: first.nextCursor,
  });
  t.is(second.items.length, 2);
  t.not(first.items[0].id, second.items[0].id);
  await t.throwsAsync(
    models.projectResource.list({
      ...scope,
      parentId: folders[0].id,
      cursor: first.nextCursor,
    })
  );
  await t.throwsAsync(
    models.projectResource.list({
      ...scope,
      search: 'other',
      cursor: first.nextCursor,
    })
  );
  await t.throwsAsync(models.projectResource.list({ ...scope, limit: 101 }));
  t.is(
    (await models.projectResource.list({ ...scope, parentId: folders[0].id }))
      .items[0].title,
    'Nested'
  );
});

test('64-level paths are readable and deeper creation or subtree moves are rejected', async t => {
  const { resources, models } = t.context;
  const scope = actor(t.context);
  let parentId: string | null = null;
  for (let depth = 1; depth <= 64; depth++) {
    const folder = await resources.createFolder({
      ...scope,
      parentId,
      title: `Depth ${depth}`,
      requestKey: `depth-${depth}`,
    });
    parentId = folder.id;
  }
  t.is(
    (await models.projectResource.path({ ...scope, resourceId: parentId! }))
      .length,
    64
  );
  await t.throwsAsync(
    resources.createFolder({
      ...scope,
      parentId,
      title: 'Too deep',
      requestKey: 'depth-65',
    })
  );
});

test('Project document and file history restores append versions and copies preserve independent identities', async t => {
  const { resources, models, blobs, db } = t.context;
  const scope = actor(t.context);
  for (const kind of ['page', 'edgeless', 'file'] as const) {
    const resource =
      kind === 'file'
        ? await resources.createFile({
            ...scope,
            title: 'history.txt',
            blobKey: (
              await blobs.put({
                ...scope,
                bytes: Buffer.from('original'),
                mimeType: 'text/plain',
              })
            ).key,
            requestKey: `create-${kind}`,
          })
        : await resources.createDocument({
            ...scope,
            title: 'Original title',
            kind,
            markdown: 'original',
            requestKey: `create-${kind}`,
          });
    const input = {
      ...scope,
      resourceId: resource.id,
      expectedContentVersion: 1,
      requestKey: 'edit',
      editLease: await editProof(models, scope, resource.id),
    };
    if (kind === 'file')
      await resources.saveFile({ ...input, text: 'changed' });
    else
      await resources.updateMarkdown({
        ...input,
        markdown: 'changed',
        origin: 'user',
      });
    const restore = {
      ...input,
      expectedContentVersion: 2,
      sequence: 1,
      requestKey: 'restore',
    };
    t.is((await resources.restoreVersion(restore)).sequence, 3);
    t.is((await resources.restoreVersion(restore)).sequence, 3);
    t.deepEqual(
      (await resources.history(input)).map(r => r.sequence),
      [3, 2, 1]
    );
    const copyInput = {
      ...scope,
      resourceId: resource.id,
      title: kind === 'file' ? 'copy.txt' : 'Copied title',
      expectedContentVersion: 3,
      requestKey: `copy-${kind}`,
    };
    const copied = await resources.copy(copyInput);
    t.not(copied.id, resource.id);
    t.is((await resources.copy(copyInput)).id, copied.id);
    t.is(copied.kind, kind);
    t.is(copied.title, copyInput.title);
    if (kind === 'file')
      t.is(
        (await resources.readTextFile({ ...scope, resourceId: copied.id }))
          .text,
        'original'
      );
    else
      t.is(
        parseYDocFromBinary(
          (await resources.readDocument({ ...scope, resourceId: copied.id }))
            .bytes,
          copied.id
        ).title,
        copyInput.title
      );
    await t.throwsAsync(
      resources.restoreVersion({ ...restore, requestKey: 'stale' })
    );
    t.is(
      await db.projectResourceRevision.count({
        where: { resourceId: resource.id },
      }),
      3
    );
  }
});
