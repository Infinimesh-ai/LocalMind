import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import test from 'ava';
import * as Y from 'yjs';

import { backfillWorkspaceResourceDisplay } from '../../../scripts/backfill-workspace-resource-display';
import { DocWriter, WorkspaceOrganizationService } from '../../core/doc';
import { WorkspaceNativeResourceService } from '../../core/office/workspace-resource-service';
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
  const creator = await app.createUser(),
    editor = await app.createUser();
  const workspace = await app.models.workspace.create(creator.id);
  const db = app.get(PrismaClient);
  await db.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: editor.id,
      role: 'member',
      state: 'active',
    },
  });
  const root = new Y.Doc();
  root.getMap('meta').set('pages', new Y.Array());
  await app
    .get(DocWriter)
    .pushDocUpdate(
      workspace.id,
      workspace.id,
      Y.encodeStateAsUpdate(root),
      creator.id
    );
  root.destroy();
  const actor = { workspaceId: workspace.id, actorId: creator.id };
  const service = app.get(WorkspaceNativeResourceService);
  const created = await service.create({
    ...actor,
    title: '文件2.txt',
    requestKey: 'create',
    content: { format: 'txt', text: 'initial' },
  });
  return {
    db,
    service,
    created,
    actor,
    editor,
    identity: { ...actor, resourceId: created.id, kind: 'file' as const },
  };
}

test.serial(
  'creation, content, metadata, indexing, lifecycle and replay keep paired update evidence',
  async t => {
    const { db, service, created, identity, editor } = await fixture();
    const source = await db.workspaceFile.findUniqueOrThrow({
      where: { id: created.id },
    });
    t.is(created.lastUpdatedBy, identity.actorId);
    t.deepEqual(created.lastUpdatedAt, created.createdAt);
    const saved = await service.save({
      ...identity,
      actorId: editor.id,
      expectedContentVersion: 1,
      requestKey: 'edit',
      text: 'changed',
    });
    t.is(saved.lastUpdatedBy, editor.id);
    const revision = await db.workspaceFileRevision.findFirstOrThrow({
      where: { fileId: created.id, sequence: 2 },
    });
    t.deepEqual(saved.lastUpdatedAt, revision.createdAt);
    const renamed = await service.change({
      ...identity,
      actorId: editor.id,
      action: 'rename',
      title: '伪装.pdf',
      expectedVersion: 1,
      requestKey: 'rename',
    });
    t.is(renamed.documentType, 'txt');
    await app.models.workspaceNativeResource.index({
      ...identity,
      sequence: 2,
      text: 'indexed',
    });
    const indexed = await service.get(identity);
    t.deepEqual(indexed.lastUpdatedAt, renamed.lastUpdatedAt);
    t.is(indexed.lastUpdatedBy, editor.id);
    const noChange = await service.save({
      ...identity,
      expectedContentVersion: 2,
      requestKey: 'no-content-change',
      text: 'changed',
    });
    t.is(noChange.contentVersion, 2);
    t.deepEqual(noChange.lastUpdatedAt, renamed.lastUpdatedAt);
    const noRename = await service.change({
      ...identity,
      action: 'rename',
      title: '伪装.pdf',
      expectedVersion: 2,
      requestKey: 'no-rename',
    });
    t.is(noRename.metadataVersion, 2);
    await service.change({
      ...identity,
      action: 'trash',
      expectedVersion: 2,
      requestKey: 'trash',
    });
    const restored = await service.change({
      ...identity,
      action: 'restore',
      expectedVersion: 3,
      requestKey: 'restore',
    });
    t.deepEqual(restored.lastUpdatedAt, renamed.lastUpdatedAt);
    const version = await service.restoreVersion({
      ...identity,
      expectedContentVersion: 2,
      sequence: 1,
      requestKey: 'restore-version',
    });
    t.is(version.lastUpdatedBy, identity.actorId);
    t.is(version.contentVersion, 3);
    t.deepEqual(
      await db.workspaceFile.findUniqueOrThrow({ where: { id: created.id } }),
      source
    );
  }
);

test.serial(
  'tags share definitions, enforce scope/CAS/ACL, survive Trash and never mutate creation evidence',
  async t => {
    const { db, service, created, identity, actor, editor } = await fixture();
    const organization = app.get(WorkspaceOrganizationService);
    await organization.applyRootOperations(actor.workspaceId, actor.actorId, [
      { op: 'create_tag', id: 'red', value: 'First', color: 'red' },
      { op: 'create_tag', id: 'blue', value: 'Second', color: 'blue' },
    ]);
    const input = {
      ...identity,
      actorId: editor.id,
      expectedVersion: 1,
      requestKey: 'tags',
      tagIds: ['red', 'blue', 'red'],
    };
    const tagged = await service.setTags(input);
    t.deepEqual(tagged.tags?.map(tag => tag.id).sort(), ['blue', 'red']);
    t.is(tagged.lastUpdatedBy, editor.id);
    t.is(tagged.metadataVersion, 2);
    t.deepEqual(await service.setTags(input), tagged);
    await t.throwsAsync(
      service.setTags({ ...input, requestKey: 'stale', tagIds: [] })
    );
    const noop = await service.setTags({
      ...input,
      requestKey: 'same',
      expectedVersion: 2,
      tagIds: ['red', 'blue'],
    });
    t.is(noop.metadataVersion, 2);
    t.deepEqual(noop.lastUpdatedAt, tagged.lastUpdatedAt);
    await organization.applyRootOperations(actor.workspaceId, actor.actorId, [
      { op: 'update_tag', tagId: 'red', value: 'Renamed', color: 'green' },
    ]);
    const recolored = await service.get(identity);
    t.is(recolored.tags.find(tag => tag.id === 'red')?.name, 'Renamed');
    t.deepEqual(recolored.lastUpdatedAt, tagged.lastUpdatedAt);
    await service.change({
      ...identity,
      expectedVersion: 2,
      requestKey: 'trash',
      action: 'trash',
    });
    await service.change({
      ...identity,
      expectedVersion: 3,
      requestKey: 'restore',
      action: 'restore',
    });
    t.is((await service.get(identity)).tags.length, 2);
    await organization.applyRootOperations(actor.workspaceId, actor.actorId, [
      { op: 'delete_tag', tagId: 'red' },
    ]);
    t.deepEqual(
      (await service.get(identity)).tags.map(tag => tag.id),
      ['blue']
    );
    await t.throwsAsync(
      service.setTags({
        ...identity,
        requestKey: 'foreign',
        expectedVersion: 4,
        tagIds: ['another-workspace-tag'],
      })
    );
    const outsider = await app.createUser();
    await t.throwsAsync(
      service.setTags({
        ...identity,
        actorId: outsider.id,
        requestKey: 'denied',
        expectedVersion: 4,
        tagIds: [],
      })
    );
    t.is(
      await db.workspaceNativeTag.count({ where: { fileId: created.id } }),
      2
    );
  }
);

test.serial(
  'competing metadata writes have one winner and failed writes cannot change the display event',
  async t => {
    const { service, identity, editor } = await fixture();
    const operations = [identity.actorId, editor.id].map((actorId, index) =>
      service.change({
        ...identity,
        actorId,
        action: 'rename',
        title: `winner-${index}.txt`,
        requestKey: `race-${index}`,
        expectedVersion: 1,
      })
    );
    const results = await Promise.allSettled(operations);
    t.is(results.filter(result => result.status === 'fulfilled').length, 1);
    const current = await service.get(identity);
    const winner = results.find(result => result.status === 'fulfilled');
    t.is(winner?.status, 'fulfilled');
    if (winner?.status === 'fulfilled') {
      t.deepEqual(current.lastUpdatedAt, winner.value.lastUpdatedAt);
      t.is(current.lastUpdatedBy, winner.value.lastUpdatedBy);
    }
  }
);

test.serial(
  'Office revisions, true system edits and copies use current resource evidence',
  async t => {
    const { service, actor, editor } = await fixture();
    const first = await service.create({
      ...actor,
      title: 'first',
      requestKey: 'office-a',
      content: { format: 'docx', paragraphs: [{ text: 'first' }] },
    });
    const second = await service.create({
      ...actor,
      title: 'second',
      requestKey: 'office-b',
      content: { format: 'docx', paragraphs: [{ text: 'second' }] },
    });
    const db = app.get(PrismaClient);
    const source = await db.officeRevision.findUniqueOrThrow({
      where: { id: second.revisionId },
    });
    const appended = await app.models.officeArtifact.appendRevision({
      ...actor,
      actorId: editor.id,
      artifactId: first.id,
      expectedParentRevisionId: first.revisionId,
      origin: 'system',
      idempotencyKey: 'system-fix',
      idempotencyFingerprint: `sha256:${randomUUID()}`,
      package: {
        key: source.packageBlobKey,
        mimeType: source.packageMimeType,
        byteSize: source.packageByteSize,
        fingerprint: source.packageFingerprint,
      },
      state: source.stateBlobKey
        ? {
            key: source.stateBlobKey,
            byteSize: source.stateByteSize!,
            fingerprint: source.stateFingerprint!,
          }
        : undefined,
    });
    const current = await service.get({
      ...actor,
      kind: 'office',
      resourceId: first.id,
    });
    t.is(current.createdBy, actor.actorId);
    t.is(current.documentType, 'docx');
    t.is(current.lastUpdateActor, 'system');
    t.is(current.lastUpdatedBy, null);
    t.deepEqual(current.lastUpdatedAt, appended.revision.createdAt);
    const copy = await service.copy({
      ...actor,
      actorId: editor.id,
      kind: 'office',
      resourceId: first.id,
      expectedContentVersion: 2,
      requestKey: 'copy',
      title: 'copy',
    });
    t.not(copy.id, first.id);
    t.is(copy.createdBy, editor.id);
    t.deepEqual(copy.lastUpdatedAt, copy.createdAt);
  }
);

test.serial(
  'bounded historical backfill is idempotent and cannot replace a newer live event',
  async t => {
    const { db, identity, service } = await fixture();
    await db.workspaceFileState.update({
      where: { fileId: identity.resourceId },
      data: {
        lastUpdatedAt: null,
        lastUpdatedBy: null,
        lastUpdateActor: 'unknown',
        lastUpdateEvent: null,
      },
    });
    const evidence = await db.workspaceFileRevision.findFirstOrThrow({
      where: { fileId: identity.resourceId },
    });
    const first = await backfillWorkspaceResourceDisplay(db);
    t.is(first.backfilled, 1);
    t.deepEqual(
      (await service.get(identity)).lastUpdatedAt,
      evidence.createdAt
    );
    t.is((await backfillWorkspaceResourceDisplay(db)).alreadyRecorded, 1);
    const renamed = await service.change({
      ...identity,
      action: 'rename',
      title: 'live.txt',
      requestKey: 'live',
      expectedVersion: 1,
    });
    await backfillWorkspaceResourceDisplay(db);
    t.deepEqual(
      (await service.get(identity)).lastUpdatedAt,
      renamed.lastUpdatedAt
    );
    await db.workspaceFileState.update({
      where: { fileId: identity.resourceId },
      data: {
        lastUpdatedAt: null,
        lastUpdatedBy: null,
        lastUpdateActor: 'unknown',
        lastUpdateEvent: null,
      },
    });
    t.is((await backfillWorkspaceResourceDisplay(db)).unknownMetadata, 1);
    t.is((await service.get(identity)).lastUpdatedAt, null);
  }
);

test.serial(
  'BlockSuite metadata and content writes keep events paired and rejected changes leave no evidence',
  async t => {
    const { actor, editor } = await fixture();
    const writer = app.get(DocWriter),
      organization = app.get(WorkspaceOrganizationService);
    const { docId } = await writer.createDoc(
      actor.workspaceId,
      'Page',
      'initial body',
      actor.actorId
    );
    const { DocReader } = await import('../../core/doc');
    const event = async () => {
      const bin = await app
        .get(DocReader)
        .getDoc(actor.workspaceId, actor.workspaceId);
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, bin!.bin);
        const pages = doc.getMap('meta').get('pages') as Y.Array<
          Y.Map<unknown> | { id: string; displayUpdateEvent?: string }
        >;
        const page = pages
          .toArray()
          .find(page =>
            page instanceof Y.Map ? page.get('id') === docId : page.id === docId
          )!;
        return JSON.parse(
          String(
            page instanceof Y.Map
              ? page.get('displayUpdateEvent')
              : page.displayUpdateEvent
          )
        ) as {
          at: number;
          by: string;
          actor: string;
        };
      } finally {
        doc.destroy();
      }
    };
    t.is((await event()).by, actor.actorId);
    await writer.updateDoc(actor.workspaceId, docId, 'edited body', editor.id);
    t.is((await event()).by, editor.id);
    // Older root documents store page metadata as a JSON object in the array.
    const root = new Y.Doc();
    try {
      const snapshot = await app
        .get(DocReader)
        .getDoc(actor.workspaceId, actor.workspaceId);
      Y.applyUpdate(root, snapshot!.bin);
      const before = Y.encodeStateVector(root);
      const pages = root.getMap('meta').get('pages') as Y.Array<Y.Map<unknown>>;
      const index = pages.toArray().findIndex(page => page.get('id') === docId);
      const legacy = pages.get(index).toJSON();
      pages.delete(index, 1);
      pages.insert(index, [legacy]);
      await writer.pushDocUpdate(
        actor.workspaceId,
        actor.workspaceId,
        Y.encodeStateAsUpdate(root, before),
        actor.actorId
      );
    } finally {
      root.destroy();
    }
    await writer.updateDoc(
      actor.workspaceId,
      docId,
      'legacy root content update',
      actor.actorId
    );
    t.is((await event()).by, actor.actorId);
    await organization.applyDataOperations(
      actor.workspaceId,
      actor.actorId,
      actor.actorId,
      'document_properties',
      [{ op: 'upsert', key: docId, values: { primaryMode: 'edgeless' } }]
    );
    const changed = await event();
    t.is(changed.by, actor.actorId);
    await organization.applyDataOperations(
      actor.workspaceId,
      editor.id,
      editor.id,
      'document_properties',
      [{ op: 'upsert', key: docId, values: { primaryMode: 'edgeless' } }]
    );
    t.deepEqual(await event(), changed);
    await t.throwsAsync(
      organization.applyDataOperations(
        actor.workspaceId,
        editor.id,
        editor.id,
        'document_properties',
        [
          { op: 'upsert', key: docId, values: { primaryMode: 'page' } },
          { op: 'upsert', key: docId, values: { primaryMode: 'invalid' } },
        ]
      )
    );
    t.deepEqual(await event(), changed);
    await organization.applyRootOperations(actor.workspaceId, editor.id, [
      { op: 'create_tag', id: 'page-tag', value: 'Page tag', color: 'blue' },
      { op: 'set_document_tags', docId, tagIds: ['page-tag'] },
    ]);
    t.is((await event()).by, editor.id);
  }
);

test.serial(
  'a backfill that read old evidence loses CAS to a live rename',
  async t => {
    const { db, service, identity, editor } = await fixture();
    await db.workspaceFileState.update({
      where: { fileId: identity.resourceId },
      data: {
        lastUpdatedAt: null,
        lastUpdatedBy: null,
        lastUpdateActor: 'unknown',
        lastUpdateEvent: null,
      },
    });
    const update = db.workspaceFileState.updateMany.bind(db.workspaceFileState);
    db.workspaceFileState.updateMany = (async args => {
      await service.change({
        ...identity,
        actorId: editor.id,
        title: 'Live winner.txt',
        action: 'rename',
        requestKey: 'race-live',
        expectedVersion: 1,
      });
      return update(args);
    }) as typeof db.workspaceFileState.updateMany;
    try {
      const counts = await backfillWorkspaceResourceDisplay(db);
      t.is(counts.raced, 1);
      t.is(counts.backfilled, 0);
      const current = await service.get(identity);
      t.is(current.lastUpdatedBy, editor.id);
      t.is(current.title, 'Live winner.txt');
    } finally {
      db.workspaceFileState.updateMany = update;
    }
  }
);
