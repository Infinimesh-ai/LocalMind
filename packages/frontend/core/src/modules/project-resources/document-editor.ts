import type { Store } from '@blocksuite/affine/store';

/** Empty imported/native snapshots contain a note but no editable paragraph. */
export function ensureProjectDocumentParagraph(store: Store) {
  if (store.readonly || !store.root) return;
  const notes = store.root.children.filter(
    block => block.flavour === 'affine:note'
  );
  if (notes.length !== 1 || notes[0].children.length) return;
  store.addBlock('affine:paragraph', { type: 'text' }, notes[0].id);
}
