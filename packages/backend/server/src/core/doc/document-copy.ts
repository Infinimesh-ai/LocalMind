import { isDeepStrictEqual } from 'node:util';

import * as Y from 'yjs';

import { nativeAttachmentCells } from './document-attachments';
import { loadNativeDocument } from './document-editor';
import { updateNativeTitle } from './native-title';

/**
 * Local block/element IDs are document scoped. Retaining them in a new document
 * namespace preserves opaque extensions and all local relationships, including
 * future types whose identity fields this server does not interpret.
 */
export function copyNativeDocument(input: {
  bin: Uint8Array;
  sourceId: string;
  targetId: string;
  title: string;
  comments: ReadonlyMap<string, string>;
  assets?: ReadonlyMap<string, string>;
  workspaceId?: string;
}) {
  const doc = loadNativeDocument(input.bin);
  try {
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const identities = Object.fromEntries(
      [...blocks.keys()].map(id => [id, id])
    );
    const remapAssets = (value: unknown, key = ''): unknown => {
      if (typeof value === 'string') {
        if (/^(?:prop:)?(?:sourceId|blobId)$/.test(key))
          return input.assets?.get(value) ?? value;
        const prefix = `/api/workspaces/${encodeURIComponent(input.workspaceId ?? '')}/blobs/`;
        if (input.workspaceId && value.startsWith(prefix)) {
          const suffix = value.slice(prefix.length),
            end = suffix.search(/[?#]/),
            encoded = end < 0 ? suffix : suffix.slice(0, end);
          const next = input.assets?.get(decodeURIComponent(encoded));
          if (next)
            return `${prefix}${encodeURIComponent(next)}${end < 0 ? '' : suffix.slice(end)}`;
        }
      } else if (Array.isArray(value))
        return value.map(child => remapAssets(child));
      else if (
        value &&
        typeof value === 'object' &&
        !(value instanceof Y.AbstractType)
      )
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => [
            key,
            remapAssets(child, key),
          ])
        );
      return value;
    };
    const remapMarks = (attributes: Record<string, unknown>) => {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(attributes)) {
        const assetValue = remapAssets(value, key);
        if (!isDeepStrictEqual(assetValue, value)) result[key] = assetValue;
        if (key.startsWith('comment-')) {
          result[key] = null;
          const next = input.comments.get(key.slice(8));
          if (next) result[`comment-${next}`] = value;
        } else if (
          key === 'reference' &&
          value &&
          typeof value === 'object' &&
          'pageId' in value &&
          value.pageId === input.sourceId
        ) {
          result[key] = { ...value, pageId: input.targetId };
        } else if (
          key === 'footnote' &&
          value &&
          typeof value === 'object' &&
          'reference' in value
        ) {
          const reference = value.reference;
          if (
            reference &&
            typeof reference === 'object' &&
            'type' in reference &&
            reference.type === 'doc' &&
            'docId' in reference &&
            reference.docId === input.sourceId
          )
            result[key] = {
              ...value,
              reference: { ...reference, docId: input.targetId },
            };
        }
      }
      return result;
    };
    const walk = (value: unknown) => {
      if (value instanceof Y.Text) {
        let offset = 0;
        for (const run of value.toDelta()) {
          const length = typeof run.insert === 'string' ? run.insert.length : 1;
          const attributes = remapMarks(run.attributes ?? {});
          if (Object.keys(attributes).length)
            value.format(offset, length, attributes);
          offset += length;
        }
      } else if (value instanceof Y.Map) {
        for (const [key, child] of value) {
          if (key === 'prop:comments' && child instanceof Y.Map) {
            const pairs = [...child];
            for (const [id] of pairs) child.delete(id);
            for (const [id, state] of pairs) {
              const next = input.comments.get(id);
              if (next) child.set(next, state);
            }
          } else if (
            key === 'comments' &&
            child &&
            typeof child === 'object' &&
            !(child instanceof Y.AbstractType)
          ) {
            value.set(
              key,
              Object.fromEntries(
                Object.entries(child).flatMap(([id, state]) => {
                  const next = input.comments.get(id);
                  return next ? [[next, state]] : [];
                })
              )
            );
          } else if (child instanceof Y.AbstractType) walk(child);
          else {
            const mapped = remapAssets(child, key);
            if (!isDeepStrictEqual(child, mapped)) value.set(key, mapped);
          }
        }
      } else if (value instanceof Y.Array) value.forEach(walk);
    };
    walk(blocks);
    for (const cell of nativeAttachmentCells(blocks)) {
      // Iterate a snapshot: new remapped entries must not be remapped again.
      const entries = Array.from(cell.entries());
      for (const [id, item] of entries) {
        const next = input.assets?.get(id);
        if (!next || next === id || !(item instanceof Y.Map)) continue;
        if (cell.has(next))
          throw new Error('Attachment identity collision during copy');
        const clone = item.clone();
        cell.delete(id);
        cell.set(next, clone);
        clone.set('id', next);
      }
    }
    for (const block of blocks.values()) {
      if (
        ['affine:embed-linked-doc', 'affine:embed-synced-doc'].includes(
          String(block.get('sys:flavour'))
        ) &&
        block.get('prop:pageId') === input.sourceId
      )
        block.set('prop:pageId', input.targetId);
      if (
        block.get('sys:flavour') === 'localmind:subpage' &&
        block.get('prop:kind') === 'doc' &&
        block.get('prop:resourceId') === input.sourceId
      )
        block.set('prop:resourceId', input.targetId);
    }
    Y.applyUpdate(
      doc,
      updateNativeTitle(Y.encodeStateAsUpdate(doc), input.title).update
    );
    // Do not discard unrecognized top-level CRDT types when copying the body.
    const bin = Y.encodeStateAsUpdate(doc);
    return { bin, identities };
  } finally {
    doc.destroy();
  }
}
