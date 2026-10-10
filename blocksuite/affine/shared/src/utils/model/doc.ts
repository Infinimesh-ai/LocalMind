import {
  DEFAULT_PAGE_BLOCK_HEIGHT,
  DEFAULT_PAGE_BLOCK_WIDTH,
} from '@blocksuite/affine-model';
import type { BlockStdScope } from '@blocksuite/std';
import type { Workspace } from '@blocksuite/store';
import { Text } from '@blocksuite/store';

import { DocCreationProvider } from '../../services/doc-creation-service';

export function createDefaultDoc(
  collection: Workspace,
  options: { id?: string; title?: string } = {}
) {
  const doc = collection.createDoc(options.id);
  doc.load();

  const store = doc.getStore();
  const title = options.title ?? '';
  const rootId = store.addBlock('affine:page', {
    title: new Text(title),
  });
  collection.meta.setDocMeta(doc.id, {
    title,
  });

  store.addBlock('affine:surface', {}, rootId);
  const noteId = store.addBlock(
    'affine:note',
    {
      xywh: `[0, 0, ${DEFAULT_PAGE_BLOCK_WIDTH}, ${DEFAULT_PAGE_BLOCK_HEIGHT}]`,
    },
    rootId
  );
  store.addBlock('affine:paragraph', {}, noteId);
  // To make sure the content of new doc would not be clear
  // By undo operation for the first time
  store.resetHistory();

  return store;
}

export async function createEditorDoc(std: BlockStdScope) {
  const provider = std.getOptional(DocCreationProvider);
  if (provider) return provider.create();
  const document = std.store.workspace.createDoc();
  const store = document.getStore();
  store.load();
  return store;
}

export async function createDefaultEditorDoc(
  std: BlockStdScope,
  options: { title?: string } = {}
) {
  const store = await createEditorDoc(std);
  const root = store.addBlock('affine:page', {
    title: new Text(options.title ?? ''),
  });
  store.addBlock('affine:surface', {}, root);
  const note = store.addBlock(
    'affine:note',
    {
      xywh: `[0, 0, ${DEFAULT_PAGE_BLOCK_WIDTH}, ${DEFAULT_PAGE_BLOCK_HEIGHT}]`,
    },
    root
  );
  store.addBlock('affine:paragraph', {}, note);
  store.workspace.meta.setDocMeta(store.id, { title: options.title ?? '' });
  store.resetHistory();
  return store;
}
