import 'fake-indexeddb/auto';

import { expect, test, vi } from 'vitest';
import { Doc, encodeStateAsUpdate } from 'yjs';

import { DocFrontend } from '../frontend/doc';
import { IndexedDBDocStorage, IndexedDBDocSyncStorage } from '../impls/idb';
import { DocSyncImpl } from '../sync/doc';

test('targeted pulls reconcile server trash and restore without broadcasts or overwriting local edits', async () => {
  const local = new IndexedDBDocStorage({
    id: 'pull',
    flavour: 'local',
    type: 'workspace',
  });
  const remote = new IndexedDBDocStorage({
    id: 'pull',
    flavour: 'remote',
    type: 'workspace',
  });
  const clocks = new IndexedDBDocSyncStorage({
    id: 'pull',
    flavour: 'local',
    type: 'workspace',
  });
  const source = new Doc({ guid: 'root' });
  source.getMap('meta').set('title', 'Original');
  const visible = new Doc({ guid: 'root' });
  const sync = new DocSyncImpl({ local, remotes: { remote } }, clocks);
  const frontend = new DocFrontend(local, sync);
  const silent = vi
    .spyOn(remote, 'subscribeDocUpdate')
    .mockReturnValue(() => {});
  try {
    for (const storage of [local, remote, clocks]) {
      storage.connection.connect();
      await storage.connection.waitForConnected();
    }
    await remote.pushDocUpdate({
      docId: 'root',
      bin: encodeStateAsUpdate(source),
    });
    frontend.connectDoc(visible);
    frontend.start();
    sync.start();
    await vi.waitFor(() =>
      expect(visible.getMap('meta').get('title')).toBe('Original')
    );
    await frontend.waitForSynced('root');

    source.getMap('meta').set('trash', true);
    source.getMap('meta').set('$localmindTrashClaims', ['direct']);
    await remote.pushDocUpdate({
      docId: 'root',
      bin: encodeStateAsUpdate(source),
    });
    expect(visible.getMap('meta').get('trash')).toBeUndefined();
    await frontend.requestPull('root');
    await vi.waitFor(() =>
      expect(visible.getMap('meta').get('trash')).toBe(true)
    );
    expect(visible.getMap('meta').get('$localmindTrashClaims')).toEqual([
      'direct',
    ]);
    await frontend.waitForSynced('root');

    source.getMap('meta').delete('trash');
    source.getMap('meta').delete('$localmindTrashClaims');
    await remote.pushDocUpdate({
      docId: 'root',
      bin: encodeStateAsUpdate(source),
    });
    visible.getMap('meta').set('localDraft', 'Kept');
    await frontend.requestPull('root');
    await frontend.requestPull('root');
    await vi.waitFor(() =>
      expect(visible.getMap('meta').get('trash')).toBeUndefined()
    );
    expect(visible.getMap('meta').get('$localmindTrashClaims')).toBeUndefined();
    expect(visible.getMap('meta').get('localDraft')).toBe('Kept');
  } finally {
    frontend.stop();
    sync.stop();
    visible.destroy();
    source.destroy();
    silent.mockRestore();
    for (const storage of [local, remote, clocks])
      storage.connection.disconnect();
  }
});
