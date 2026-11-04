import * as Y from 'yjs';

import { loadNativeDocument } from './document-editor';
import { reconcileNativeText } from './native-text';
import { ResourceError } from './resource-types';

export function updateNativeTitle(binary: Uint8Array, title: string) {
  const doc = loadNativeDocument(binary),
    scratch = new Y.Doc();
  try {
    const pages = [...doc.getMap<Y.Map<unknown>>('blocks').values()].filter(
      block => block.get('sys:flavour') === 'affine:page'
    );
    const text = pages.length === 1 ? pages[0].get('prop:title') : undefined;
    if (!(text instanceof Y.Text))
      throw new ResourceError('unsupported_document_structure');
    const changed = text.toString() !== title,
      vector = Y.encodeStateVector(doc);
    if (changed) {
      const target = scratch.getText('title');
      target.insert(0, title);
      reconcileNativeText(text, target, () => true);
    }
    return { changed, update: Y.encodeStateAsUpdate(doc, vector) };
  } finally {
    doc.destroy();
    scratch.destroy();
  }
}
