import { TestWorkspace } from '@blocksuite/affine/store/test';
import { expect, test } from 'vitest';

import { getStoreManager } from '../manager/store';
import { initDocFromProps } from './index';

test('an already loaded empty store gets a real page body exactly once', () => {
  const workspace = new TestWorkspace({});
  workspace.meta.initialize();
  const document = workspace.createDoc('migrated-folder');
  const store = document.getStore({
    extensions: getStoreManager().config.init().value.get('store'),
  });
  store.load();
  expect(store.root).toBeNull();
  initDocFromProps(store, undefined, { title: 'Converted folder' });
  expect(store.root?.flavour).toBe('affine:page');
  expect(store.getBlocksByFlavour('affine:paragraph')).toHaveLength(1);
  const rootId = store.root?.id;
  initDocFromProps(store, undefined, { title: 'Do not replace body' });
  expect(store.root?.id).toBe(rootId);
  expect(store.getBlocksByFlavour('affine:paragraph')).toHaveLength(1);
});
