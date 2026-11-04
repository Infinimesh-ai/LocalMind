import { isDeepStrictEqual } from 'node:util';

import { collectNativeCommentIds } from '@blocksuite/affine-model/comment-anchors';
import * as Y from 'yjs';

import { documentMetadataFlavours } from './document-block-defaults';
import { loadNativeDocument, nativeValue } from './document-editor';
import { reconcileNativeArray } from './native-array';
import { reconcileNativeText } from './native-text';

function clone(value: unknown): unknown {
  if (value instanceof Y.AbstractType) return value.clone();
  return structuredClone(value);
}

/** Only accepts a trusted, stored native snapshot, never a public patch. */
function reconcile(
  current: unknown,
  target: unknown,
  preserveComment?: (key: string) => boolean
): boolean {
  if (preserveComment && current instanceof Y.Map && target instanceof Y.Map) {
    const existing = current.get('comments'),
      previous = target.get('comments');
    if (
      existing &&
      typeof existing === 'object' &&
      !(existing instanceof Y.AbstractType)
    ) {
      const merged = {
        ...(previous && typeof previous === 'object' ? previous : {}),
      } as Record<string, unknown>;
      for (const [id, value] of Object.entries(existing))
        if (preserveComment(`comment-${id}`)) merged[id] = value;
      if (!isDeepStrictEqual(merged, previous) && Object.keys(merged).length)
        target.set('comments', merged);
    }
  }
  if (isDeepStrictEqual(nativeValue(current), nativeValue(target))) return true;
  if (current instanceof Y.Text && target instanceof Y.Text) {
    reconcileNativeText(current, target, preserveComment);
    return true;
  }
  if (current instanceof Y.Map && target instanceof Y.Map) {
    for (const key of current.keys()) if (!target.has(key)) current.delete(key);
    for (const [key, value] of target)
      if (!reconcile(current.get(key), value, preserveComment))
        current.set(key, clone(value));
    return true;
  }
  if (current instanceof Y.Array && target instanceof Y.Array) {
    const identity = (value: unknown) => {
      const id = value instanceof Y.Map ? value.get('id') : undefined;
      return id === undefined
        ? `value:${JSON.stringify(nativeValue(value))}`
        : `id:${String(id)}`;
    };
    reconcileNativeArray(
      current,
      target.toArray(),
      identity,
      value => clone(value),
      (existing, value) => {
        reconcile(existing, value, preserveComment);
      }
    );
    return true;
  }
  return false;
}

export function nativeCommentIds(...binaries: Uint8Array[]) {
  const ids = new Set<string>();
  for (const bin of binaries) {
    const doc = loadNativeDocument(bin);
    try {
      for (const id of collectNativeCommentIds(doc)) ids.add(id);
    } finally {
      doc.destroy();
    }
  }
  return [...ids];
}

export function restoreNativeDocument(
  currentBinary: Uint8Array,
  targetBinary: Uint8Array,
  options?: {
    actorId: string;
    now: number;
    comments: ReadonlyMap<string, boolean>;
  }
) {
  const current = loadNativeDocument(currentBinary),
    target = loadNativeDocument(targetBinary);
  try {
    const blocks = current.getMap<Y.Map<unknown>>('blocks'),
      wanted = target.getMap<Y.Map<unknown>>('blocks');
    const before = new Map(
      [...blocks].map(([id, value]) => [id, nativeValue(value)])
    );
    const vector = Y.encodeStateVector(current);
    if (options) {
      // Current creation evidence is immutable. Restoration is a new edit, not
      // a claim that an old actor performed it again.
      for (const [id, block] of wanted) {
        const existing = blocks.get(id);
        if (!existing) continue;
        for (const key of [
          'prop:meta:createdAt',
          'prop:meta:createdBy',
          'prop:meta:updatedAt',
          'prop:meta:updatedBy',
        ]) {
          if (existing.has(key)) block.set(key, existing.get(key));
          else block.delete(key);
        }
        const comments = existing.get('prop:comments');
        if (comments instanceof Y.Map) {
          let next = block.get('prop:comments');
          if (!(next instanceof Y.Map)) {
            next = new Y.Map();
            block.set('prop:comments', next);
          }
          for (const [id, state] of comments)
            if (options.comments.has(id))
              (next as Y.Map<unknown>).set(id, state);
        }
      }
    }
    current.transact(() => {
      reconcile(
        blocks,
        wanted,
        options
          ? key =>
              key.startsWith('comment-') && options.comments.has(key.slice(8))
          : undefined
      );
      if (options) {
        const clean = (value: unknown, key?: string) => {
          if (value instanceof Y.Text) {
            let offset = 0;
            for (const run of value.toDelta()) {
              const length =
                typeof run.insert === 'string' ? run.insert.length : 1;
              for (const [mark, state] of Object.entries(run.attributes ?? {}))
                if (mark.startsWith('comment-')) {
                  const next = options.comments.get(mark.slice(8)) ?? null;
                  if (state !== next)
                    value.format(offset, length, { [mark]: next });
                }
              offset += length;
            }
          } else if (value instanceof Y.Map) {
            if (key === 'prop:comments')
              for (const [id, state] of value) {
                const next = options.comments.get(id);
                if (next === undefined) value.delete(id);
                else if (next !== state) value.set(id, next);
              }
            else
              for (const [field, child] of value) {
                if (
                  field === 'comments' &&
                  child &&
                  typeof child === 'object' &&
                  !(child instanceof Y.AbstractType)
                ) {
                  const comments = Object.fromEntries(
                    Object.keys(child)
                      .filter(id => options.comments.has(id))
                      .map(id => [id, options.comments.get(id)])
                  );
                  if (!isDeepStrictEqual(child, comments))
                    value.set(field, comments);
                } else clean(child, field);
              }
          } else if (value instanceof Y.Array)
            value.forEach(child => clean(child));
        };
        clean(blocks);
        for (const [id, block] of blocks)
          if (
            !isDeepStrictEqual(before.get(id), nativeValue(block)) &&
            documentMetadataFlavours.has(String(block.get('sys:flavour')))
          ) {
            block.set('prop:meta:updatedAt', options.now);
            block.set('prop:meta:updatedBy', options.actorId);
          }
      }
    });
    const changedIds = [
      ...new Set([...before.keys(), ...blocks.keys()]),
    ].filter(
      id => !isDeepStrictEqual(before.get(id), nativeValue(blocks.get(id)))
    );
    const page = [...blocks.values()].find(
      block => block.get('sys:flavour') === 'affine:page'
    );
    const title = page?.get('prop:title');
    return {
      update: Y.encodeStateAsUpdate(current, vector),
      changed: !!changedIds.length,
      changedIds,
      title: title instanceof Y.Text ? title.toString() : undefined,
    };
  } finally {
    current.destroy();
    target.destroy();
  }
}
