import type { Store } from '@blocksuite/affine/store';
import { expect, test, vi } from 'vitest';

import { ensureProjectDocumentParagraph } from './document-editor';

function fixture(readonly = false, children: object[] = []) {
  return {
    readonly,
    root: { children: [{ id: 'note', flavour: 'affine:note', children }] },
    addBlock: vi.fn(),
  };
}
test('makes an empty native snapshot editable', () => {
  const store = fixture();
  ensureProjectDocumentParagraph(store as unknown as Store);
  expect(store.addBlock).toHaveBeenCalledWith(
    'affine:paragraph',
    { type: 'text' },
    'note'
  );
});
test('never changes read-only snapshots or existing content', () => {
  for (const store of [fixture(true), fixture(false, [{ id: 'paragraph' }])]) {
    ensureProjectDocumentParagraph(store as unknown as Store);
    expect(store.addBlock).not.toHaveBeenCalled();
  }
});
