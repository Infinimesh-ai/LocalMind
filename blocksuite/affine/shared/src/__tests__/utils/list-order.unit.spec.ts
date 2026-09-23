import {
  ListBlockModel,
  ListBlockSchemaExtension,
  NoteBlockSchemaExtension,
  ParagraphBlockSchemaExtension,
  RootBlockSchemaExtension,
} from '@blocksuite/affine-model';
import { type BlockModel, type Store, Text } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { beforeEach, describe, expect, test } from 'vitest';

import { deleteBlockWithListOrder } from '../../utils/model/list.js';

describe('numbered list deletion', () => {
  let store: Store;
  let note: BlockModel;

  beforeEach(() => {
    const workspace = new TestWorkspace({});
    workspace.meta.initialize();
    const doc = workspace.createDoc('list-order');
    store = doc.getStore({
      extensions: [
        RootBlockSchemaExtension,
        NoteBlockSchemaExtension,
        ParagraphBlockSchemaExtension,
        ListBlockSchemaExtension,
      ],
    });
    doc.load();
    const rootId = store.addBlock('affine:page');
    const noteId = store.addBlock('affine:note', {}, rootId);
    note = store.getBlock(noteId)!.model;
  });

  function list(order: number, parent = note) {
    const id = store.addBlock(
      'affine:list',
      {
        type: 'numbered',
        order,
        text: new Text(String(order)),
      },
      parent
    );
    return store.getBlock(id)!.model as ListBlockModel;
  }

  function paragraph(parent = note) {
    const id = store.addBlock('affine:paragraph', {}, parent);
    return store.getBlock(id)!.model;
  }

  function orders(parent = note) {
    return parent.children.map(model =>
      model instanceof ListBlockModel ? model.props.order : null
    );
  }

  test('renumbers after deleting the inserted middle item, including undo/redo', () => {
    const first = list(1);
    const last = list(2);
    const middleId = store.addBlock(
      'affine:list',
      { type: 'numbered', order: 2 },
      note,
      1
    );
    last.props.order = 3;
    store.resetHistory();

    deleteBlockWithListOrder(store, store.getBlock(middleId)!.model);
    expect(orders()).toEqual([1, 2]);
    expect(note.children.map(model => model.id)).toEqual([first.id, last.id]);
    store.undo();
    expect(orders()).toEqual([1, 2, 3]);
    store.redo();
    expect(orders()).toEqual([1, 2]);
  });

  test.each([false, true])(
    'handles batched deletes with reverse order=%s',
    reverse => {
      list(1);
      const removed = [list(2), list(3)];
      list(4);
      if (reverse) removed.reverse();
      store.resetHistory();

      store.transact(() => {
        removed.forEach(model => deleteBlockWithListOrder(store, model));
      });
      expect(orders()).toEqual([1, 2]);
      store.undo();
      expect(orders()).toEqual([1, 2, 3, 4]);
    }
  );

  test('preserves custom starting numbers when removing the first item', () => {
    const first = list(5);
    list(6);
    list(7);
    deleteBlockWithListOrder(store, first);
    expect(orders()).toEqual([5, 6]);
  });

  test.each(['paragraph', 'bulleted', 'todo'])(
    'does not renumber across a %s block',
    type => {
      list(1);
      const middle = list(2);
      list(3);
      if (type === 'paragraph') paragraph();
      else store.addBlock('affine:list', { type }, note);
      list(8);
      list(9);
      deleteBlockWithListOrder(store, middle);
      expect(orders()).toEqual([1, 2, null, 8, 9]);
    }
  );

  test('reconnects numbering after removing the empty paragraph left by Backspace', () => {
    list(1);
    const empty = paragraph();
    list(3);
    list(4);
    deleteBlockWithListOrder(store, empty);
    expect(orders()).toEqual([1, 2, 3]);
  });

  test('keeps an independent list start after removing a preceding paragraph', () => {
    const empty = paragraph();
    list(5);
    list(6);
    deleteBlockWithListOrder(store, empty);
    expect(orders()).toEqual([5, 6]);
  });

  test('only renumbers the affected nesting level', () => {
    const parent = list(1);
    list(1, parent);
    const middle = list(2, parent);
    list(3, parent);
    list(2);
    deleteBlockWithListOrder(store, middle);
    expect(orders(parent)).toEqual([1, 2]);
    expect(orders()).toEqual([1, 2]);
  });

  test('includes children brought into the deleted item position', () => {
    list(1);
    const removed = list(2);
    list(1, removed);
    list(2, removed);
    list(3);
    deleteBlockWithListOrder(store, removed, { bringChildrenTo: note });
    expect(orders()).toEqual([1, 2, 3, 4]);
  });

  test('does not mutate a readonly document', () => {
    list(1);
    const middle = list(2);
    list(3);
    store.readonly = true;
    deleteBlockWithListOrder(store, middle);
    expect(orders()).toEqual([1, 2, 3]);
  });
});
