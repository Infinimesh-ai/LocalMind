import { isDeepStrictEqual } from 'node:util';

import * as Y from 'yjs';
import type { z } from 'zod';

import {
  DocumentEditError,
  loadNativeDocument,
  nativeValue,
} from './document-editor';
import type { documentTextTarget } from './document-schema';
import { isTextBoundary } from './native-text';

export type DocumentCommentAnchor =
  | { kind: 'document' }
  | { kind: 'block'; blockId: string }
  | { kind: 'element'; surfaceId: string; elementId: string }
  | {
      kind: 'text';
      target: z.infer<typeof documentTextTarget>;
      offset: number;
      length: number;
    };
export type CommentAnchorChange = {
  id: string;
  state: boolean | null;
  anchor?: DocumentCommentAnchor;
};
function invalid(reason: string): never {
  throw new DocumentEditError('invalid_input', { reason });
}

/** Trusted comment-domain changes, deliberately absent from public content patches. */
export function editCommentAnchors(
  bin: Uint8Array,
  changes: CommentAnchorChange[]
) {
  const doc = loadNativeDocument(bin);
  try {
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const before = new Map(
      [...blocks].map(([id, block]) => [id, nativeValue(block)])
    );
    const vector = Y.encodeStateVector(doc);
    const block = (id: string) =>
      blocks.get(id) ?? invalid('comment_anchor_block_not_found');
    const element = (surfaceId: string, elementId: string) => {
      const stored = block(surfaceId).get('prop:elements');
      const elements =
        stored instanceof Y.Map &&
        stored.get('type') === '$blocksuite:internal:native$'
          ? stored.get('value')
          : stored;
      if (!(elements instanceof Y.Map))
        invalid('comment_anchor_surface_not_found');
      const value = elements.get(elementId);
      if (!(value instanceof Y.Map))
        invalid('comment_anchor_element_not_found');
      return value;
    };
    const textAt = (target: z.infer<typeof documentTextTarget>) => {
      let value: unknown;
      if (target.kind === 'element_text')
        value = element(target.surfaceId, target.elementId).get(target.field);
      else {
        const source = block(target.blockId);
        if (target.kind === 'block_text')
          value = source.get(`prop:${target.field}`);
        else if (target.kind === 'table_cell')
          value = source.get(
            `prop:cells.${target.rowId}:${target.columnId}.text`
          );
        else {
          const columns = source.get('prop:columns');
          const column =
            columns instanceof Y.Array
              ? columns
                  .toArray()
                  .find(
                    c => c instanceof Y.Map && c.get('id') === target.columnId
                  )
              : undefined;
          if (!column) invalid('comment_anchor_column_not_found');
          if (column.get('type') === 'title')
            value = block(target.rowId).get('prop:text');
          else {
            const cells = source.get('prop:cells');
            const row =
              cells instanceof Y.Map ? cells.get(target.rowId) : undefined;
            const cell =
              row instanceof Y.Map ? row.get(target.columnId) : undefined;
            value =
              source.get('sys:flavour') === 'affine:data-view'
                ? cell
                : cell instanceof Y.Map
                  ? cell.get('value')
                  : undefined;
          }
        }
      }
      if (!(value instanceof Y.Text)) invalid('comment_anchor_text_not_found');
      return value;
    };
    doc.transact(() => {
      for (const change of changes) {
        const marker = `comment-${change.id}`;
        const state = change.anchor ? null : change.state;
        const walk = (value: unknown) => {
          if (value instanceof Y.Text) {
            let offset = 0;
            for (const run of value.toDelta()) {
              const length =
                typeof run.insert === 'string' ? run.insert.length : 1;
              if (
                run.attributes &&
                marker in run.attributes &&
                run.attributes[marker] !== state
              )
                value.format(offset, length, { [marker]: state });
              offset += length;
            }
          } else if (value instanceof Y.Map) {
            for (const [key, child] of value) {
              if (
                key === 'prop:comments' &&
                child instanceof Y.Map &&
                child.has(change.id)
              ) {
                if (state === null) child.delete(change.id);
                else if (child.get(change.id) !== state)
                  child.set(change.id, state);
              } else if (
                key === 'comments' &&
                child &&
                typeof child === 'object' &&
                !(child instanceof Y.AbstractType)
              ) {
                const comments = { ...child } as Record<string, unknown>;
                if (change.id in comments && comments[change.id] !== state) {
                  if (state === null) delete comments[change.id];
                  else comments[change.id] = state;
                  value.set(key, comments);
                }
              } else walk(child);
            }
          } else if (value instanceof Y.Array) value.forEach(walk);
        };
        walk(blocks);
        const anchor = change.anchor;
        if (!anchor || change.state === null) continue;
        if (anchor.kind === 'text') {
          const text = textAt(anchor.target),
            source = text.toString();
          if (
            anchor.length < 1 ||
            !isTextBoundary(source, anchor.offset) ||
            !isTextBoundary(source, anchor.offset + anchor.length)
          )
            invalid('invalid_comment_anchor_range');
          text.format(anchor.offset, anchor.length, { [marker]: change.state });
        } else if (anchor.kind === 'block' || anchor.kind === 'document') {
          const pages = [...blocks.values()].filter(
            value => value.get('sys:flavour') === 'affine:page'
          );
          const target =
            anchor.kind === 'block'
              ? block(anchor.blockId)
              : pages.length === 1
                ? pages[0]
                : invalid('ambiguous_document_comment_anchor');
          let comments = target.get('prop:comments');
          if (comments === undefined) {
            comments = new Y.Map();
            target.set('prop:comments', comments);
          }
          if (!(comments instanceof Y.Map))
            invalid('invalid_comment_anchor_storage');
          comments.set(change.id, change.state);
        } else {
          const target = element(anchor.surfaceId, anchor.elementId),
            comments = target.get('comments');
          if (
            comments !== undefined &&
            (!comments ||
              typeof comments !== 'object' ||
              comments instanceof Y.AbstractType)
          )
            invalid('invalid_comment_anchor_storage');
          target.set('comments', {
            ...(comments as Record<string, unknown>),
            [change.id]: change.state,
          });
        }
      }
    });
    const changedIds = [...blocks]
      .filter(
        ([id, value]) => !isDeepStrictEqual(before.get(id), nativeValue(value))
      )
      .map(([id]) => id);
    return {
      update: Y.encodeStateAsUpdate(doc, vector),
      changed: !!changedIds.length,
      changedIds,
    };
  } finally {
    doc.destroy();
  }
}
