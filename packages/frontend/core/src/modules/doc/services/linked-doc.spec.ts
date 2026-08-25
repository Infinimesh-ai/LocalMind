import 'fake-indexeddb/auto';

import { getStoreManager } from '@affine/core/blocksuite/manager/store';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { type DeltaInsert, Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { describe, expect, it } from 'vitest';

import { hasLinkedDocReference, removeLinkedDocReferences } from './linked-doc';

const extensions = getStoreManager().config.init().value.get('store');

const createStore = () => {
  const workspace = new TestWorkspace({ id: 'linked-doc-test' });
  workspace.meta.initialize();
  const store = workspace.createDoc('source').getStore({ extensions });
  store.load();
  const pageId = store.addBlock('affine:page', { title: new Text('Source') });
  const noteId = store.addBlock('affine:note', {}, pageId);
  return { store, noteId };
};

describe('linked doc references', () => {
  it('removes inline and embedded links without removing other references', () => {
    const { store, noteId } = createStore();
    const text = new Text<AffineTextAttributes>([
      { insert: 'before ' },
      {
        insert: 'first',
        attributes: {
          reference: { type: 'LinkedPage', pageId: 'target' },
        },
      },
      { insert: ' middle ' },
      {
        insert: 'second',
        attributes: {
          reference: { type: 'LinkedPage', pageId: 'target' },
        },
      },
      { insert: ' after ' },
      {
        insert: 'subpage',
        attributes: {
          reference: { type: 'Subpage', pageId: 'target' },
        },
      },
    ] satisfies DeltaInsert<AffineTextAttributes>[]);
    const paragraphId = store.addBlock('affine:paragraph', { text }, noteId);
    const linkedEmbedId = store.addBlock(
      'affine:embed-linked-doc',
      { pageId: 'target' },
      noteId
    );
    const syncedEmbedId = store.addBlock(
      'affine:embed-synced-doc',
      { pageId: 'target' },
      noteId
    );
    store.addBlock('affine:embed-linked-doc', { pageId: 'other' }, noteId);

    expect(hasLinkedDocReference(store, 'target')).toBe(true);
    expect(removeLinkedDocReferences(store, 'target')).toBe(4);
    expect(hasLinkedDocReference(store, 'target')).toBe(false);
    expect(store.getModelById(linkedEmbedId)).toBeNull();
    expect(store.getModelById(syncedEmbedId)).toBeNull();
    expect(store.getModelById(paragraphId)?.text?.toString()).toBe(
      'before  middle  after subpage'
    );
    expect(
      store.getModelById(paragraphId)?.text?.toDelta().at(-1)?.attributes
        ?.reference
    ).toMatchObject({ type: 'Subpage', pageId: 'target' });
    expect(hasLinkedDocReference(store, 'other')).toBe(true);
  });

  it('is a no-op when the linked document is not referenced', () => {
    const { store } = createStore();

    expect(removeLinkedDocReferences(store, 'missing')).toBe(0);
  });
});
