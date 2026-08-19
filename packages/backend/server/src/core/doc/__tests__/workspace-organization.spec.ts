import test from 'ava';
import * as Y from 'yjs';

import {
  resolveWorkspaceDataDocId,
  WorkspaceOrganizationService,
} from '../workspace-organization';

function rootFixture() {
  const doc = new Y.Doc({ guid: 'workspace-1' });
  const meta = doc.getMap<unknown>('meta');
  meta.set('name', 'LocalMind');

  const pages = new Y.Array<Y.Map<unknown>>();
  const page = new Y.Map<unknown>();
  page.set('id', 'doc-1');
  page.set('title', 'Document');
  page.set('tags', new Y.Array<string>());
  pages.push([page]);
  meta.set('pages', pages);

  const properties = new Y.Map<unknown>();
  const tags = new Y.Map<unknown>();
  tags.set('options', new Y.Array<unknown>());
  properties.set('tags', tags);
  meta.set('properties', properties);

  const setting = doc.getMap<unknown>('setting');
  setting.set('collections', new Y.Array<unknown>());
  return doc;
}

function createService() {
  const docs = new Map<string, Y.Doc>([['workspace-1', rootFixture()]]);
  let timestamp = 1;
  const reader = {
    getDoc: async (_workspaceId: string, docId: string) => {
      const doc = docs.get(docId);
      return doc
        ? {
            spaceId: 'workspace-1',
            docId,
            bin: Y.encodeStateAsUpdate(doc),
            timestamp,
          }
        : null;
    },
  };
  const writer = {
    pushDocUpdate: async (
      _workspaceId: string,
      docId: string,
      update: Uint8Array
    ) => {
      let doc = docs.get(docId);
      if (!doc) {
        doc = new Y.Doc({ guid: docId });
        docs.set(docId, doc);
      }
      Y.applyUpdate(doc, update);
      timestamp++;
      return { success: true, timestamp };
    },
  };
  return new WorkspaceOrganizationService(reader as never, writer as never);
}

test('workspace organization resolves browser-compatible storage doc IDs', t => {
  const workspaceId = 'workspace-1';
  const userId = 'user-1';

  t.deepEqual(
    {
      folders: resolveWorkspaceDataDocId('folders', workspaceId, userId),
      documentProperties: resolveWorkspaceDataDocId(
        'document_properties',
        workspaceId,
        userId
      ),
      workspaceProperties: resolveWorkspaceDataDocId(
        'workspace_properties',
        workspaceId,
        userId
      ),
      pinnedCollections: resolveWorkspaceDataDocId(
        'pinned_collections',
        workspaceId,
        userId
      ),
      explorerIcons: resolveWorkspaceDataDocId(
        'explorer_icons',
        workspaceId,
        userId
      ),
      favorites: resolveWorkspaceDataDocId('favorites', workspaceId, userId),
      userSettings: resolveWorkspaceDataDocId(
        'user_settings',
        workspaceId,
        userId
      ),
    },
    {
      folders: 'db$workspace-1$folders',
      documentProperties: 'db$workspace-1$docProperties',
      workspaceProperties: 'db$workspace-1$docCustomPropertyInfo',
      pinnedCollections: 'db$workspace-1$pinnedCollections',
      explorerIcons: 'db$workspace-1$explorerIcon',
      favorites: 'userdata$user-1$workspace-1$favorite',
      userSettings: 'userdata$user-1$workspace-1$settings',
    }
  );
});

test('workspace organization service round-trips root metadata operations', async t => {
  const service = createService();

  const result = await service.applyRootOperations('workspace-1', 'user-1', [
    {
      op: 'create_tag',
      id: 'tag-1',
      value: 'Important',
      color: 'red',
    },
    {
      op: 'set_document_tags',
      docId: 'doc-1',
      tagIds: ['tag-1'],
    },
    {
      op: 'create_collection',
      id: 'collection-1',
      name: 'Focus',
      rules: { filters: [] },
      allowList: ['doc-1'],
    },
    { op: 'set_document_trashed', docId: 'doc-1', trashed: true },
  ]);
  t.deepEqual(result.createdTagIds, ['tag-1']);
  t.deepEqual(result.createdCollectionIds, ['collection-1']);

  const read = await service.readOrganization('workspace-1', 'user-1');
  t.deepEqual(read.tags, [
    {
      id: 'tag-1',
      value: 'Important',
      color: 'red',
      createDate: (read.tags as { createDate: number }[])[0].createDate,
      updateDate: (read.tags as { updateDate: number }[])[0].updateDate,
    },
  ]);
  t.deepEqual(read.collections, [
    {
      id: 'collection-1',
      name: 'Focus',
      rules: { filters: [] },
      allowList: ['doc-1'],
    },
  ]);
  t.deepEqual(read.documents, [
    {
      id: 'doc-1',
      title: 'Document',
      tags: ['tag-1'],
      trash: true,
    },
  ]);
});

test('workspace organization service round-trips ORM table operations', async t => {
  const service = createService();

  await service.applyDataOperations(
    'workspace-1',
    'user-1',
    'user-1',
    'favorites',
    [{ op: 'upsert', key: 'doc:doc-1', values: { index: 'a0' } }]
  );
  await service.applyDataOperations(
    'workspace-1',
    'user-1',
    'user-1',
    'folders',
    [
      {
        op: 'upsert',
        key: 'folder-1',
        values: {
          parentId: null,
          type: 'folder',
          data: 'Projects',
          index: 'a0',
        },
      },
      {
        op: 'upsert',
        key: 'link-1',
        values: {
          parentId: 'folder-1',
          type: 'doc',
          data: 'doc-1',
          index: 'a0',
        },
      },
    ]
  );
  await service.applyDataOperations(
    'workspace-1',
    'user-1',
    'user-1',
    'document_properties',
    [
      {
        op: 'upsert',
        key: 'doc-1',
        values: { primaryMode: 'edgeless', isTemplate: true },
      },
    ]
  );

  const read = await service.readOrganization('workspace-1', 'user-1');
  t.deepEqual(read.favorites, [{ key: 'doc:doc-1', index: 'a0' }]);
  t.deepEqual(read.folders, [
    {
      id: 'folder-1',
      parentId: null,
      type: 'folder',
      data: 'Projects',
      index: 'a0',
    },
    {
      id: 'link-1',
      parentId: 'folder-1',
      type: 'doc',
      data: 'doc-1',
      index: 'a0',
    },
  ]);
  t.deepEqual(read.documentProperties, [
    { id: 'doc-1', primaryMode: 'edgeless', isTemplate: true },
  ]);
});
