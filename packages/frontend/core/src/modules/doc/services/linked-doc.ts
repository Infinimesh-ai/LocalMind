import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import type { BlockModel, Store, Text } from '@blocksuite/affine/store';

const EMBEDDED_DOC_FLAVOURS = new Set([
  'affine:embed-linked-doc',
  'affine:embed-synced-doc',
]);

const referencesDoc = (
  attributes: Record<string, unknown> | undefined,
  docId: string
) => {
  const reference = attributes?.reference as
    | AffineTextAttributes['reference']
    | undefined;
  return reference?.type === 'LinkedPage' && reference.pageId === docId;
};

const isEmbeddedDoc = (model: BlockModel, docId: string) =>
  EMBEDDED_DOC_FLAVOURS.has(model.flavour) &&
  (model.props as { pageId?: string }).pageId === docId;

export const hasLinkedDocReference = (store: Store, linkedDocId: string) =>
  store.getAllModels().some(model => {
    if (isEmbeddedDoc(model, linkedDocId)) {
      return true;
    }
    return model.text
      ?.toDelta()
      .some(delta => referencesDoc(delta.attributes, linkedDocId));
  });

export const removeLinkedDocReferences = (
  store: Store,
  linkedDocId: string
) => {
  const embeddedBlocks: BlockModel[] = [];
  const textRanges: { text: Text; index: number; length: number }[] = [];

  for (const model of store.getAllModels()) {
    if (isEmbeddedDoc(model, linkedDocId)) {
      embeddedBlocks.push(model);
      continue;
    }

    const text = model.text;
    if (!text) {
      continue;
    }

    let index = 0;
    for (const delta of text.toDelta()) {
      const length = delta.insert?.length ?? 0;
      if (length > 0 && referencesDoc(delta.attributes, linkedDocId)) {
        textRanges.push({ text, index, length });
      }
      index += length;
    }
  }

  if (embeddedBlocks.length === 0 && textRanges.length === 0) {
    return 0;
  }

  store.transact(() => {
    for (const block of embeddedBlocks) {
      store.deleteBlock(block);
    }
    for (const { text, index, length } of textRanges.reverse()) {
      text.delete(index, length);
    }
  });

  return embeddedBlocks.length + textRanges.length;
};
