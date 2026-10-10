import { initDocFromProps } from '@affine/core/blocksuite/initialization';
import { Doc as YDoc } from 'yjs';

import type { WorkspaceDBService } from '../../db';
import type { Workspace } from '../../workspace/entities/workspace';
import { LocalPageTreeAdapter } from './page-tree-local';

export function localWorkspacePageTree(
  workspace: Workspace,
  db: WorkspaceDBService
) {
  if (workspace.flavour !== 'local')
    throw new Error('Local page tree requires a local Workspace');
  const collection = workspace.docCollection;
  const engine = workspace.engine.doc;
  const folders = db.localTableDoc('folders'),
    properties = db.localTableDoc('docProperties'),
    journal = new YDoc({ guid: 'db$localPageTree' });
  engine.connectDoc(journal);
  const ready = async () => {
    await Promise.all(
      [workspace.id, folders.guid, properties.guid, journal.guid].map(id =>
        engine.waitForDocLoaded(id)
      )
    );
  };
  const parentStore = async (id: string, after: string) => {
    const doc = collection.getDoc(id);
    if (!doc) throw new Error('Parent page unavailable');
    const store = doc.getStore({ id });
    store.load();
    await engine.waitForDocLoaded(id);
    const anchor = store.getBlock(after)?.model;
    const parent = anchor && store.getParent(anchor);
    if (
      !anchor ||
      !parent ||
      !['affine:note', 'affine:callout'].includes(parent.flavour)
    )
      throw new Error('Subpage insertion position changed');
    return { store, parent, anchor };
  };
  return {
    adapter: new LocalPageTreeAdapter({
      workspaceId: workspace.id,
      root: workspace.rootYDoc,
      folders,
      properties,
      journal,
      ready,
      persist: () => engine.waitForUpdated(),
      exclusive: async run => {
        if (!navigator.locks)
          throw new Error(
            'This browser does not support safe local page tree writes'
          );
        return await navigator.locks.request(
          `localmind-page-tree:${workspace.id}`,
          run
        );
      },
      create: async ({ id, title, primaryMode, at }) => {
        if (!collection.meta.getDocMeta(id))
          collection.meta.addDocMeta({ id, title, createDate: at, tags: [] });
        const doc = collection.getDoc(id);
        if (!doc) throw new Error('Local page unavailable');
        const store = doc.getStore({ id });
        store.load();
        await engine.waitForDocLoaded(id);
        if (!store.root) initDocFromProps(store, undefined, { title });
        if (!store.root)
          throw new Error('Local page body initialization failed');
        properties.getMap(id).set('id', id);
        properties.getMap(id).set('primaryMode', primaryMode);
      },
      delete: async id => {
        if (collection.getDoc(id)) collection.removeDoc(id);
      },
      validateInsert: async (id, after) => {
        await parentStore(id, after);
      },
      insert: async ({ parentId, after, resourceId, blockId }) => {
        const { store, parent, anchor } = await parentStore(parentId, after);
        if (!store.getBlock(blockId))
          store.addBlock(
            'localmind:subpage',
            { id: blockId, resourceId, kind: 'doc' },
            parent,
            parent.children.findIndex(item => item.id === anchor.id) + 1
          );
      },
    }),
    dispose: () => {
      engine.disconnectDoc(journal);
      journal.destroy();
    },
  };
}
