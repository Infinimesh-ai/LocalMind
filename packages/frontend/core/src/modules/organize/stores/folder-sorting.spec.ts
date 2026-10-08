import {
  createORMClient,
  Framework,
  LiveData,
  YjsDBAdapter,
} from '@toeverything/infra';
import { expect, test } from 'vitest';
import { Doc } from 'yjs';

import type { WorkspaceServerService } from '../../cloud';
import type { CollectionService } from '../../collection';
import type { WorkspaceDBService } from '../../db';
import type { DocsService } from '../../doc';
import type { TagService } from '../../tag';
import { USER_DB_SCHEMA } from '../../userspace/schema';
import type { WorkspaceService } from '../../workspace';
import type { WorkspaceResourcesService } from '../../workspace-resources';
import { FolderSortingStore } from './folder-sorting';

function userDB() {
  const db = new (createORMClient(USER_DB_SCHEMA))(
    new YjsDBAdapter(USER_DB_SCHEMA, { getDoc: () => new Doc() })
  );
  const docSyncState$ = new LiveData<{ loaded: boolean } | null>(null);
  return {
    folderSortPreference: Object.assign(db.folderSortPreference, {
      docSyncState$,
    }),
  };
}
test('personal folder modes isolate accounts and workspaces and survive reopening', () => {
  const a = userDB(),
    b = userDB();
  const currentUserDB$ = new LiveData<typeof a | null>(a);
  const account$ = new LiveData<{ id: string } | null>({ id: 'a' });
  const server = {
    id: 'selfhosted',
    account$,
    scope: { get: () => ({ currentUserDB: { db$: currentUserDB$ } }) },
  };
  const stores: FolderSortingStore[] = [];
  const create = (workspaceId: string) => {
    const framework = new Framework();
    framework.store(
      FolderSortingStore,
      () =>
        new FolderSortingStore(
          {
            workspace: { id: workspaceId, flavour: 'affine-cloud' },
          } as unknown as WorkspaceService,
          {
            server$: new LiveData(server),
            server,
          } as unknown as WorkspaceServerService,
          {} as WorkspaceDBService,
          {
            list: { docsMap$: new LiveData(new Map()) },
          } as unknown as DocsService,
          { tagList: { tags$: new LiveData([]) } } as unknown as TagService,
          {
            collectionMetas$: new LiveData([]),
          } as unknown as CollectionService,
          {
            active$: new LiveData({ items: [] }),
          } as unknown as WorkspaceResourcesService
        )
    );
    const store = framework.provider().get(FolderSortingStore);
    stores.push(store);
    return store;
  };
  try {
    const first = create('one');
    expect(first.ready$.value).toBe(false);
    expect(() => first.setMode('folder', 'name-desc')).toThrow(/loading/);
    a.folderSortPreference.docSyncState$.next({ loaded: true });
    first.setMode('folder', 'name-desc');
    let mode: unknown;
    const subscription = first.watchMode('folder').subscribe(value => {
      mode = value;
    });
    expect(mode).toBe('name-desc');
    const reopened = create('one');
    let restored: unknown;
    const restoreSubscription = reopened
      .watchMode('folder')
      .subscribe(value => {
        restored = value;
      });
    expect(restored).toBe('name-desc');
    const otherWorkspace = create('two');
    otherWorkspace.setMode('folder', 'name-asc');
    expect(mode).toBe('name-desc');
    b.folderSortPreference.docSyncState$.next({ loaded: true });
    account$.next({ id: 'b' });
    currentUserDB$.next(b);
    expect(mode).toBe(null);
    first.setMode('folder', 'manual');
    account$.next({ id: 'a' });
    currentUserDB$.next(a);
    expect(mode).toBe('name-desc');
    account$.next(null);
    currentUserDB$.next(null);
    expect(mode).toBe(null);
    expect(first.ready$.value).toBe(false);
    subscription.unsubscribe();
    restoreSubscription.unsubscribe();
  } finally {
    stores.forEach(store => store.dispose());
  }
});
