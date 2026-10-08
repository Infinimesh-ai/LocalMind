import {
  createORMClient,
  Framework,
  LiveData,
  YjsDBAdapter,
} from '@toeverything/infra';
import { afterEach, expect, test } from 'vitest';
import { Doc } from 'yjs';

import type { WorkspaceServerService } from '../../cloud';
import type { CollectionService } from '../../collection';
import type { WorkspaceDBService } from '../../db';
import {
  AFFiNE_WORKSPACE_DB_SCHEMA,
  AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA,
} from '../../db/schema';
import type { DocsService } from '../../doc';
import type { TagService } from '../../tag';
import type { WorkspaceService } from '../../workspace';
import type { WorkspaceResourcesService } from '../../workspace-resources';
import type { DirectoryAccessStore } from '../stores/directory-access';
import { FolderStore } from '../stores/folder';
import { FolderSortingStore } from '../stores/folder-sorting';
import { FolderNode } from './folder-node';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
function fixture() {
  const docs = new Map<string, Doc>();
  const db = new (createORMClient(AFFiNE_WORKSPACE_DB_SCHEMA))(
    new YjsDBAdapter(AFFiNE_WORKSPACE_DB_SCHEMA, {
      getDoc: id => {
        const doc = new Doc();
        docs.set(id, doc);
        return doc;
      },
    })
  );
  const userdata = new (createORMClient(AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA))(
    new YjsDBAdapter(AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA, {
      getDoc: () => new Doc(),
    })
  );
  const title$ = new LiveData('9-23');
  const meta$ = new LiveData({ trash: false });
  const dbService = {
    db: {
      folders: Object.assign(db.folders, { isLoading$: new LiveData(false) }),
    },
    userdataDB$: new LiveData({
      settings: Object.assign(userdata.settings, {
        isReady$: new LiveData(true),
      }),
    }),
    transact: (table: string, operation: () => void) =>
      docs.get(table)!.transact(operation),
  } as unknown as WorkspaceDBService;
  const docsService = {
    list: {
      docsMap$: new LiveData(new Map([['doc', { id: 'doc', title$, meta$ }]])),
      trashDocs$: new LiveData([]),
      isReady$: new LiveData(true),
    },
  } as unknown as DocsService;
  const access = {
    state$: new LiveData({ mode: 'local', items: [], error: null }),
    saving$: new LiveData(false),
  } as unknown as DirectoryAccessStore;
  const framework = new Framework();
  framework
    .store(FolderStore, () => new FolderStore(dbService, docsService, access))
    .store(
      FolderSortingStore,
      () =>
        new FolderSortingStore(
          {
            workspace: { id: 'workspace', flavour: 'local' },
          } as unknown as WorkspaceService,
          {
            server$: new LiveData(null),
            server: null,
          } as unknown as WorkspaceServerService,
          dbService,
          docsService,
          { tagList: { tags$: new LiveData([]) } } as unknown as TagService,
          {
            collectionMetas$: new LiveData([]),
          } as unknown as CollectionService,
          {
            active$: new LiveData({
              items: [
                { id: 'file', kind: 'file', title: '9-24' },
                { id: 'office', kind: 'office', title: '10-2' },
              ],
            }),
          } as unknown as WorkspaceResourcesService
        )
    )
    .entity(FolderNode, [FolderStore, FolderSortingStore]);
  const provider = framework.provider();
  const store = provider.get(FolderStore);
  const sorting = provider.get(FolderSortingStore);
  const folderId = store.createFolder(null, 'Parent', 'a0');
  db.folders.create({
    id: 'a',
    parentId: folderId,
    type: 'doc',
    data: 'doc',
    index: 'a0',
  });
  db.folders.create({
    id: 'b',
    parentId: folderId,
    type: 'file',
    data: 'file',
    index: 'a1',
  });
  db.folders.create({
    id: 'c',
    parentId: folderId,
    type: 'office',
    data: 'office',
    index: 'a2',
  });
  db.folders.create({
    id: 'd',
    parentId: folderId,
    type: 'folder',
    data: '9-9',
    index: 'a3',
  });
  const node = provider.createEntity(FolderNode, { id: folderId });
  cleanups.push(() => {
    node.dispose();
    store.dispose();
    sorting.dispose();
    docs.forEach(doc => doc.destroy());
  });
  const order = () => node.displayChildren$.value.map(child => child.id);
  return {
    node,
    db,
    store,
    sorting,
    title$,
    meta$,
    order,
    folderId,
    userdata,
    access,
    folderDoc: docs.get('folders')!,
  };
}

test('new folders use name descending; old folders retain their manual order', () => {
  const { node, folderDoc, order, folderId } = fixture();
  expect(node.sortMode$.value).toBe('name-desc');
  expect(order()).toEqual(['c', 'b', 'a', 'd']);
  folderDoc.getMap(folderId).delete('defaultSortMode');
  expect(node.sortMode$.value).toBe('manual');
  expect(order()).toEqual(['a', 'b', 'c', 'd']);
});
test('view changes preserve the manual order and renames react immediately', () => {
  const { node, title$, order, userdata, folderId } = fixture();
  node.setSortMode('manual');
  title$.next('12-1');
  expect(order()).toEqual(['a', 'b', 'c', 'd']);
  node.setSortMode('name-desc');
  expect(order()).toEqual(['a', 'c', 'b', 'd']);
  node.setSortMode('name-asc');
  expect(order()).toEqual(['d', 'b', 'c', 'a']);
  node.setSortMode('manual');
  expect(order()).toEqual(['a', 'b', 'c', 'd']);
  expect(
    userdata.settings.get(
      `folder-sort:${JSON.stringify(['workspace', folderId])}`
    )?.value
  ).toEqual({ mode: 'manual' });
});
test('readers can choose a personal view while directory writes stay disabled', () => {
  const { node, access, order } = fixture();
  access.state$.next({
    mode: 'full',
    items: [],
    error: null,
    rootRights: {
      canRead: true,
      canWrite: false,
      canOrganize: false,
      canCreateFolder: false,
    },
  });
  expect(node.canMutate$.value).toBe(false);
  node.setSortMode('name-asc');
  expect(order()).toEqual(['d', 'a', 'b', 'c']);
});
test('dragging in automatic mode saves the displayed order and undo restores both states', async () => {
  const { node, order } = fixture();
  const undo = await node.reorderChild('d', 'b', 'before');
  expect(node.sortMode$.value).toBe('manual');
  expect(order()).toEqual(['c', 'd', 'b', 'a']);
  await undo!();
  expect(node.sortMode$.value).toBe('name-desc');
  expect(order()).toEqual(['c', 'b', 'a', 'd']);
  node.setSortMode('manual');
  expect(order()).toEqual(['a', 'b', 'c', 'd']);
});
test('a changed directory prevents undo from overwriting a subsequent reorder', async () => {
  const { node, db, order } = fixture();
  const undo = await node.reorderChild('d', 'b', 'before');
  db.folders.update('a', { index: 'Zz' });
  await expect(undo!()).rejects.toThrow(/Folder changed/);
  expect(node.sortMode$.value).toBe('manual');
  expect(order()[0]).toBe('a');
});
test('a failed write leaves the selected view and previous indices intact', async () => {
  const { node, store, order } = fixture();
  store.reorderChildren = async () => {
    throw new Error('Access revoked');
  };
  await expect(node.reorderChild('d', 'b', 'before')).rejects.toThrow(
    'Access revoked'
  );
  expect(node.sortMode$.value).toBe('name-desc');
  expect(order()).toEqual(['c', 'b', 'a', 'd']);
  expect(node.sorting$.value).toBe(false);
});
