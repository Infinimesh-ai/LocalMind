import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as Y from 'yjs';

import { editCommentAnchors } from '../../core/doc/document-comment-anchors';
import { copyNativeDocument } from '../../core/doc/document-copy';
import {
  DocumentEditError,
  editNativeDocument,
  inspectNativeDocument,
  nativeValue,
} from '../../core/doc/document-editor';
import {
  nativeCommentIds,
  restoreNativeDocument,
} from '../../core/doc/document-restore';
import { documentNativeBatch } from '../../core/doc/document-schema';
import { reconcileNativeArray } from '../../core/doc/native-array';
import {
  normalizeNativeRuns,
  reconcileNativeText,
} from '../../core/doc/native-text';

function fixture() {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const add = (id: string, flavour: string, childIds: string[] = []) => {
    const block = new Y.Map<unknown>();
    blocks.set(id, block);
    block.set('sys:id', id);
    block.set('sys:flavour', flavour);
    block.set('sys:version', flavour === 'affine:page' ? 2 : 1);
    const children = new Y.Array<string>();
    block.set('sys:children', children);
    children.push(childIds);
    return block;
  };
  add('page', 'affine:page', ['note']).set('prop:title', new Y.Text('Test'));
  add('note', 'affine:note', ['empty', 'paragraph', 'table', 'future']);
  const empty = add('empty', 'affine:paragraph');
  empty.set('prop:type', 'text');
  empty.set('prop:text', new Y.Text());
  const paragraph = add('paragraph', 'affine:paragraph');
  paragraph.set('prop:type', 'text');
  paragraph.set('prop:text', new Y.Text('before KEEP after'));
  paragraph.set('prop:meta:createdBy', 'original-author');
  paragraph.set('prop:comments', new Y.Map([['thread', true]]));
  const table = add('table', 'affine:table');
  for (const [id, order] of [
    ['r1', 'a0'],
    ['r2', 'a1'],
  ]) {
    table.set(`prop:rows.${id}.rowId`, id);
    table.set(`prop:rows.${id}.order`, order);
  }
  for (const [id, order] of [
    ['c1', 'a0'],
    ['c2', 'a1'],
  ]) {
    table.set(`prop:columns.${id}.columnId`, id);
    table.set(`prop:columns.${id}.order`, order);
    table.set(`prop:columns.${id}.width`, 240);
  }
  table.set('prop:rows.r1.backgroundColor', 'red');
  const cell = new Y.Text();
  table.set('prop:cells.r1:c1.text', cell);
  cell.insert(0, 'original', { bold: true, color: 'red' });
  table.set('prop:cells.r2:c2.text', new Y.Text('untouched'));
  table.set('prop:future.extension', { preserve: true });
  add('future', 'future:opaque').set(
    'prop:opaque',
    new Y.Text('DO NOT CHANGE')
  );
  return { doc, blocks, paragraph, table, cell };
}
function apply(doc: Y.Doc, commands: unknown, operationId = 'operation') {
  const result = editNativeDocument({
    bin: Y.encodeStateAsUpdate(doc),
    commands,
    actorId: 'editor',
    operationId,
    now: 12345,
  });
  Y.applyUpdate(doc, result.update);
  return result;
}

void test('native copying preserves opaque roots, local IDs and source evidence while remapping global comment anchors', () => {
  const { doc, paragraph } = fixture();
  const copy = new Y.Doc();
  try {
    doc.getMap('future-root').set('opaque', new Y.Text('future content'));
    const text = paragraph.get('prop:text') as Y.Text;
    text.format(0, 6, {
      'comment-thread': true,
      reference: { pageId: 'source', params: { blockIds: ['paragraph'] } },
    });
    const before = Y.encodeStateAsUpdate(doc);
    const result = copyNativeDocument({
      bin: before,
      sourceId: 'source',
      targetId: 'copy',
      title: 'Copied title',
      comments: new Map([['thread', 'copied-thread']]),
    });
    Y.applyUpdate(copy, result.bin);
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
    assert.equal(result.identities.future, 'future');
    assert.deepEqual(
      copy.getMap('future-root').toJSON(),
      doc.getMap('future-root').toJSON()
    );
    const block = copy.getMap<Y.Map<unknown>>('blocks').get('paragraph')!;
    assert.equal(block.get('prop:meta:createdBy'), 'original-author');
    assert.deepEqual((block.get('prop:comments') as Y.Map<unknown>).toJSON(), {
      'copied-thread': true,
    });
    const attributes = (block.get('prop:text') as Y.Text).toDelta()[0]
      .attributes;
    assert.equal(attributes?.['comment-thread'], undefined);
    assert.equal(attributes?.['comment-copied-thread'], true);
    assert.deepEqual(attributes?.reference, {
      pageId: 'copy',
      params: { blockIds: ['paragraph'] },
    });
    assert.equal(
      (
        copy
          .getMap<Y.Map<unknown>>('blocks')
          .get('page')!
          .get('prop:title') as Y.Text
      ).toString(),
      'Copied title'
    );
  } finally {
    doc.destroy();
    copy.destroy();
  }
});

void test('frame membership is explicit, cyclic membership rolls back, and deleting a graphic detaches its rotated connector', () => {
  const { doc, blocks } = fixture();
  try {
    const created = apply(doc, [
      {
        opId: 'surface',
        type: 'block.create',
        parentId: 'page',
        flavour: 'affine:surface',
        clientRef: 'surface',
      },
      {
        opId: 'frame',
        type: 'block.create',
        parentId: '$surface',
        flavour: 'affine:frame',
        clientRef: 'frame',
      },
      {
        opId: 'image',
        type: 'block.create',
        parentId: '$surface',
        flavour: 'affine:image',
        clientRef: 'image',
      },
      {
        opId: 'image-size',
        type: 'block.properties',
        blockId: '$image',
        flavour: 'affine:image',
        properties: { xywh: '[0,0,100,100]', rotate: 90 },
      },
      {
        opId: 'connector',
        type: 'element.create',
        surfaceId: '$surface',
        clientRef: 'line',
        element: {
          kind: 'connector',
          properties: { source: { id: '$image', position: [1, 0.5] } },
        },
      },
      {
        opId: 'members',
        type: 'frame.members.set',
        surfaceId: '$surface',
        frameId: '$frame',
        members: ['$image'],
      },
    ]);
    const { surface, image, frame, line } = created.identities;
    const before = Y.encodeStateAsUpdate(doc);
    assert.throws(
      () =>
        apply(doc, [
          {
            opId: 'cycle',
            type: 'frame.members.set',
            surfaceId: surface,
            frameId: frame,
            members: [frame],
          },
        ]),
      DocumentEditError
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
    assert.throws(
      () =>
        apply(doc, [
          {
            opId: 'remove',
            type: 'block.delete',
            blockId: image,
            includeDescendants: false,
          },
        ]),
      DocumentEditError
    );
    apply(doc, [
      {
        opId: 'remove',
        type: 'block.delete',
        blockId: image,
        includeDescendants: false,
        references: 'detach',
      },
    ]);
    assert.equal(
      (blocks.get(frame)!.get('prop:childElementIds') as Y.Map<unknown>).size,
      0
    );
    const boxed = blocks.get(surface)!.get('prop:elements') as Y.Map<unknown>;
    const elements = boxed.get('value') as Y.Map<Y.Map<unknown>>;
    const source = elements.get(line)!.get('source') as {
      id?: string;
      position: number[];
    };
    assert.equal(source.id, undefined);
    assert.ok(Math.abs(source.position[0] - 50) < 1e-9);
    assert.ok(Math.abs(source.position[1] - 100) < 1e-9);
  } finally {
    doc.destroy();
  }
});

void test('split and merge retain the first text object, carry inline anchors, and preserve unknown fields', () => {
  const { doc, blocks, paragraph } = fixture();
  try {
    const text = paragraph.get('prop:text') as Y.Text;
    text.format(7, 4, { 'comment-inline': true });
    paragraph.set('prop:opaque', { exact: 'preserve' });
    const anchor = Y.createRelativePositionFromTypeIndex(text, 2);
    const result = apply(doc, [
      {
        opId: 'split',
        type: 'block.split',
        blockId: 'paragraph',
        offset: 7,
        clientRef: 'right',
        children: 'move_right',
        blockComments: 'keep_left',
      },
    ]);
    const right = blocks.get(result.identities.right)!;
    assert.deepEqual(result.textMappings, [
      {
        opId: 'split',
        source: { blockId: 'paragraph', offset: 7, length: 10 },
        target: { blockId: result.identities.right, offset: 0 },
      },
    ]);
    assert.equal(text.toString(), 'before ');
    assert.equal(
      Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index,
      2
    );
    assert.equal(
      (right.get('prop:text') as Y.Text).toDelta()[0].attributes?.[
        'comment-inline'
      ],
      true
    );
    assert.deepEqual(right.get('prop:opaque'), { exact: 'preserve' });
    apply(
      doc,
      [
        {
          opId: 'merge',
          type: 'block.merge',
          firstBlockId: 'paragraph',
          secondBlockId: result.identities.right,
        },
      ],
      'merge'
    );
    assert.equal(text.toString(), 'before KEEP after');
    assert.equal(text.toDelta()[1].attributes?.['comment-inline'], true);
    assert.equal(paragraph.get('prop:meta:createdBy'), 'original-author');
    assert.equal(blocks.has(result.identities.right), false);
  } finally {
    doc.destroy();
  }
});

void test('mindmap membership uses the editor layout and repeating layout is a true no-op', () => {
  const { doc, blocks } = fixture();
  try {
    const created = apply(doc, [
      {
        opId: 'surface',
        type: 'block.create',
        parentId: 'page',
        flavour: 'affine:surface',
        clientRef: 'surface',
      },
      ...['root', 'left', 'right'].map(id => ({
        opId: id,
        type: 'element.create',
        surfaceId: '$surface',
        clientRef: id,
        element: { kind: 'shape', properties: { xywh: '[0,0,100,40]' } },
      })),
      {
        opId: 'mindmap',
        type: 'element.create',
        surfaceId: '$surface',
        clientRef: 'mindmap',
        element: { kind: 'mindmap', properties: { layoutType: 2 } },
      },
      {
        opId: 'members',
        type: 'element.members.set',
        surfaceId: '$surface',
        elementId: '$mindmap',
        members: [
          { id: '$root', index: 'a0' },
          { id: '$right', parent: '$root', index: 'a0' },
          { id: '$left', parent: '$root', index: 'a1' },
        ],
      },
    ]);
    const { surface, root, left, right, mindmap } = created.identities;
    const elements = (
      blocks.get(surface)!.get('prop:elements') as Y.Map<unknown>
    ).get('value') as Y.Map<Y.Map<unknown>>;
    assert.equal(elements.get(root)!.get('xywh'), '[0,0,100,40]');
    assert.equal(elements.get(left)!.get('xywh'), '[-300,0,100,40]');
    assert.equal(elements.get(right)!.get('xywh'), '[300,0,100,40]');
    const before = Y.encodeStateAsUpdate(doc);
    assert.equal(
      apply(doc, [
        {
          opId: 'layout',
          type: 'mindmap.layout',
          surfaceId: surface,
          elementId: mindmap,
        },
      ]).changed,
      false
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  } finally {
    doc.destroy();
  }
});

void test('rectangular table paste changes only addressed cells and preserves surviving comment marks', () => {
  const { doc, table, cell } = fixture();
  try {
    cell.format(0, 8, { 'comment-cell': true });
    const unaffected = table.get('prop:cells.r2:c2.text');
    apply(doc, [
      {
        opId: 'paste',
        type: 'table.cells.set',
        blockId: 'table',
        rowIds: ['r1'],
        columnIds: ['c1', 'c2'],
        cells: [[[{ insert: 'original!' }], [{ insert: 'new' }]]],
        marksPolicy: 'preserve_existing',
      },
    ]);
    assert.equal(cell.toString(), 'original!');
    assert.equal(cell.toDelta()[0].attributes?.bold, true);
    assert.equal(cell.toDelta()[0].attributes?.['comment-cell'], true);
    assert.equal(table.get('prop:cells.r2:c2.text'), unaffected);
    assert.equal(table.get('prop:columns.c1.width'), 240);
  } finally {
    doc.destroy();
  }
});
const splice = (
  blockId: string,
  offset: number,
  deleteCount: number,
  insert: string
) => ({
  opId: 'edit',
  type: 'text.splice',
  target: { kind: 'block_text', blockId },
  offset,
  deleteCount,
  insert: [{ insert }],
});

void test('native edits retain empty paragraphs, unrelated unknown nodes and creation evidence', () => {
  const { doc, blocks, paragraph } = fixture();
  try {
    const unknown = nativeValue(blocks.get('future'));
    const result = apply(doc, [splice('empty', 0, 0, 'now editable')]);
    assert.equal(result.changed, true);
    assert.equal(
      (blocks.get('empty')!.get('prop:text') as Y.Text).toString(),
      'now editable'
    );
    assert.deepEqual(nativeValue(blocks.get('future')), unknown);
    assert.equal(paragraph.get('prop:meta:createdBy'), 'original-author');
    assert.equal(
      inspectNativeDocument(Y.encodeStateAsUpdate(doc)).find(
        b => b.id === 'future'
      )?.supported,
      false
    );
  } finally {
    doc.destroy();
  }
});

void test('text changes retain Y.Text identity, unedited item anchors and unknown marks', () => {
  const { doc, paragraph } = fixture();
  try {
    const text = paragraph.get('prop:text') as Y.Text;
    text.format(7, 4, { futureMark: 'opaque', bold: true });
    const anchor = Y.createRelativePositionFromTypeIndex(text, 8);
    const result = apply(doc, [
      splice('paragraph', 0, 6, 'first'),
      { ...splice('paragraph', 10, 6, ' last'), opId: 'second' },
    ]);
    assert.deepEqual(result.changedIds, ['paragraph']);
    assert.equal(paragraph.get('prop:text'), text);
    assert.equal(text.toString(), 'first KEEP last');
    const resolved = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
    assert.equal(resolved?.type, text);
    assert.equal(resolved?.index, 7);
    assert.deepEqual(text.toDelta()[1].attributes, {
      futureMark: 'opaque',
      bold: true,
    });
    assert.deepEqual(nativeValue(paragraph.get('prop:comments')), {
      thread: true,
    });
  } finally {
    doc.destroy();
  }
});

void test('one cell update preserves row/column identity, order, width, style and other cells', () => {
  const { doc, table, cell } = fixture();
  try {
    const before = Object.fromEntries(
      [...table].filter(([key]) => key !== 'prop:cells.r1:c1.text')
    );
    const anchor = Y.createRelativePositionFromTypeIndex(cell, 4);
    apply(doc, [
      {
        ...splice('table', 0, 1, 'O'),
        target: {
          kind: 'table_cell',
          blockId: 'table',
          rowId: 'r1',
          columnId: 'c1',
        },
        marksPolicy: 'inherit_replaced_range',
      },
    ]);
    assert.equal(table.get('prop:cells.r1:c1.text'), cell);
    assert.equal(cell.toString(), 'Original');
    assert.deepEqual(cell.toDelta(), [
      { insert: 'Original', attributes: { bold: true, color: 'red' } },
    ]);
    assert.equal(
      Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index,
      4
    );
    for (const [key, value] of Object.entries(before))
      assert.equal(table.get(key), value, key);
  } finally {
    doc.destroy();
  }
});

void test('identical text and formatting are no-ops without timestamp churn', () => {
  const { doc, paragraph } = fixture();
  try {
    const before = Y.encodeStateAsUpdate(doc);
    const result = apply(doc, [
      splice('paragraph', 0, 17, 'before KEEP after'),
      {
        opId: 'format',
        type: 'text.format',
        target: { kind: 'block_text', blockId: 'paragraph' },
        offset: 0,
        length: 17,
        marks: { bold: null },
      },
    ]);
    assert.equal(result.changed, false);
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
    assert.equal(paragraph.has('prop:meta:updatedAt'), false);
  } finally {
    doc.destroy();
  }
});

void test('failed command batches leave the supplied document completely unchanged', () => {
  const { doc } = fixture();
  try {
    const before = Y.encodeStateAsUpdate(doc);
    assert.throws(
      () =>
        apply(doc, [
          splice('empty', 0, 0, 'not committed'),
          { ...splice('missing', 0, 0, 'bad'), opId: 'invalid' },
        ]),
      (error: unknown) =>
        error instanceof DocumentEditError && error.detail.opId === 'invalid'
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  } finally {
    doc.destroy();
  }
});

void test('UTF-16 offsets reject surrogate and grapheme splits', () => {
  const { doc } = fixture();
  try {
    apply(doc, [splice('empty', 0, 0, 'A👨‍👩‍👧‍👦éB')]);
    for (const offset of [2, 3, 5, 13]) {
      assert.throws(
        () => apply(doc, [splice('empty', offset, 0, '!')]),
        DocumentEditError
      );
    }
  } finally {
    doc.destroy();
  }
});

void test('client references are deterministic and cannot refer forward', () => {
  const { doc } = fixture();
  try {
    const commands = [
      {
        opId: 'create',
        type: 'block.create',
        clientRef: 'created',
        parentId: 'note',
        flavour: 'affine:paragraph',
      },
      splice('$created', 0, 0, 'new'),
    ];
    const input = {
      bin: Y.encodeStateAsUpdate(doc),
      commands,
      actorId: 'editor',
      operationId: 'stable',
      now: 1,
    };
    const first = editNativeDocument(input),
      retry = editNativeDocument(input);
    assert.deepEqual(first.identities, retry.identities);
    assert.equal(first.digest, retry.digest);
    assert.throws(
      () => editNativeDocument({ ...input, commands: [...commands].reverse() }),
      DocumentEditError
    );
  } finally {
    doc.destroy();
  }
});

void test('table structural edits retain unaffected cells and only delete the requested axis', () => {
  const { doc, table, cell } = fixture();
  try {
    apply(doc, [
      {
        opId: 'insert',
        type: 'table.axis.insert',
        blockId: 'table',
        axis: 'column',
        clientRef: 'col',
        index: 1,
      },
      {
        opId: 'format',
        type: 'table.axis.format',
        blockId: 'table',
        axis: 'column',
        id: '$col',
        width: 300,
      },
      {
        opId: 'move',
        type: 'table.axis.move',
        blockId: 'table',
        axis: 'row',
        id: 'r2',
        index: 0,
      },
      {
        opId: 'delete',
        type: 'table.axis.delete',
        blockId: 'table',
        axis: 'column',
        id: 'c2',
      },
    ]);
    assert.equal(table.get('prop:cells.r1:c1.text'), cell);
    assert.equal(table.has('prop:cells.r2:c2.text'), false);
    assert.equal(table.get('prop:columns.c1.width'), 240);
    assert.equal(table.get('prop:rows.r1.backgroundColor'), 'red');
  } finally {
    doc.destroy();
  }
});

void test('strict schema rejects provenance, generic props and unsafe links', () => {
  const invalid = [
    {
      opId: 'x',
      type: 'block.properties',
      blockId: 'paragraph',
      flavour: 'affine:paragraph',
      properties: { 'meta:createdBy': 'forged' },
    },
    { ...splice('paragraph', 0, 0, 'x'), props: { arbitrary: true } },
    {
      opId: 'x',
      type: 'text.format',
      target: { kind: 'block_text', blockId: 'paragraph' },
      offset: 0,
      length: 1,
      marks: { link: 'javascript:alert(1)' },
    },
  ];
  for (const command of invalid)
    assert.equal(documentNativeBatch.safeParse([command]).success, false);
});

void test('Markdown reconciliation retains anchors between separate edits and applies marks in place', () => {
  const { doc, paragraph } = fixture();
  const other = new Y.Doc();
  try {
    const text = paragraph.get('prop:text') as Y.Text;
    const anchor = Y.createRelativePositionFromTypeIndex(text, 8);
    const target = other.getText('text');
    target.insert(0, 'FIRST KEEP LAST', { underline: true });
    reconcileNativeText(text, target);
    assert.equal(paragraph.get('prop:text'), text);
    assert.equal(
      Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index,
      7
    );
    assert.deepEqual(text.toDelta(), target.toDelta());
  } finally {
    doc.destroy();
    other.destroy();
  }
});

void test('database commands preserve rich text cells, unrelated schema fields and view identities', () => {
  const { doc, blocks } = fixture();
  try {
    const created = apply(doc, [
      {
        opId: 'db',
        type: 'block.create',
        parentId: 'note',
        flavour: 'affine:database',
        clientRef: 'db',
      },
      {
        opId: 'column',
        type: 'database.column.create',
        blockId: '$db',
        clientRef: 'rich',
        column: { name: 'Details', type: 'rich-text', data: {} },
      },
      {
        opId: 'row',
        type: 'database.row.create',
        blockId: '$db',
        clientRef: 'row',
        title: 'Row title',
      },
      {
        opId: 'cell',
        type: 'text.splice',
        target: {
          kind: 'database_cell',
          blockId: '$db',
          rowId: '$row',
          columnId: '$rich',
        },
        offset: 0,
        deleteCount: 0,
        insert: [{ insert: 'Rich text', attributes: { bold: true } }],
      },
    ]);
    const id = created.identities.db,
      row = created.identities.row,
      column = created.identities.rich;
    const db = blocks.get(id)!;
    db.set('prop:future', { unknown: 'retained' });
    const cells = db.get('prop:cells') as Y.Map<Y.Map<Y.Map<unknown>>>;
    const rich = cells.get(row)!.get(column)!.get('value') as Y.Text;
    const anchor = Y.createRelativePositionFromTypeIndex(rich, 6);
    const views = db.get('prop:views');
    const result = apply(
      doc,
      [
        {
          opId: 'rename',
          type: 'database.column.update',
          blockId: id,
          columnId: column,
          column: { name: 'Notes', type: 'rich-text', data: {} },
        },
        {
          opId: 'edit',
          type: 'text.splice',
          target: {
            kind: 'database_cell',
            blockId: id,
            rowId: row,
            columnId: column,
          },
          offset: 0,
          deleteCount: 4,
          insert: [{ insert: 'More' }],
          marksPolicy: 'inherit_replaced_range',
        },
      ],
      'second-operation'
    );
    assert.equal(result.changed, true);
    assert.equal(cells.get(row)!.get(column)!.get('value'), rich);
    assert.equal(rich.toString(), 'More text');
    assert.equal(
      Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index,
      6
    );
    assert.equal(db.get('prop:views'), views);
    assert.deepEqual(db.get('prop:future'), { unknown: 'retained' });
  } finally {
    doc.destroy();
  }
});

void test('database type changes and dependent-column deletion fail atomically', () => {
  const { doc } = fixture();
  try {
    const result = apply(doc, [
      {
        opId: 'db',
        type: 'block.create',
        parentId: 'note',
        flavour: 'affine:database',
        clientRef: 'db',
      },
    ]);
    const before = Y.encodeStateAsUpdate(doc);
    assert.throws(
      () =>
        apply(doc, [
          {
            opId: 'change',
            type: 'database.column.update',
            blockId: result.identities.db,
            columnId: result.identities['db:title'],
            column: {
              name: 'Wrong type',
              type: 'number',
              data: { format: 'number' },
            },
          },
        ]),
      DocumentEditError
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  } finally {
    doc.destroy();
  }
});

void test('surface edits use plain native fields, preserve text identity and detach connectors explicitly', () => {
  const { doc, blocks } = fixture();
  try {
    const made = apply(doc, [
      {
        opId: 'surface',
        type: 'block.create',
        clientRef: 'surface',
        parentId: 'page',
        flavour: 'affine:surface',
      },
      {
        opId: 'shape',
        type: 'element.create',
        surfaceId: '$surface',
        clientRef: 'shape',
        element: {
          kind: 'shape',
          properties: {
            xywh: '[10,20,100,80]',
            fillColor: { light: 'red', dark: 'blue' },
          },
        },
      },
      {
        opId: 'connector',
        type: 'element.create',
        surfaceId: '$surface',
        clientRef: 'edge',
        element: {
          kind: 'connector',
          properties: {
            source: { id: '$shape', position: [1, 0.5] },
            target: { position: [300, 300] },
          },
        },
      },
      {
        opId: 'text',
        type: 'text.splice',
        target: {
          kind: 'element_text',
          surfaceId: '$surface',
          elementId: '$shape',
        },
        offset: 0,
        deleteCount: 0,
        insert: [{ insert: 'Shape title' }],
      },
    ]);
    const surfaceId = made.identities.surface,
      elementId = made.identities.shape,
      edgeId = made.identities.edge;
    const surface = blocks.get(surfaceId)!;
    const elements = (surface.get('prop:elements') as Y.Map<unknown>).get(
      'value'
    ) as Y.Map<Y.Map<unknown>>;
    const element = elements.get(elementId)!;
    const text = element.get('text');
    element.set('futureAttribute', { preserve: true });
    apply(
      doc,
      [
        {
          opId: 'edit',
          type: 'element.update',
          surfaceId,
          elementId,
          element: {
            kind: 'shape',
            properties: {
              filled: true,
              fillColor: { light: 'green', dark: 'blue' },
            },
          },
        },
      ],
      'shape-edit'
    );
    assert.equal(element.get('text'), text);
    assert.equal(element.get('fillColor') instanceof Y.Map, false);
    assert.deepEqual(element.get('futureAttribute'), { preserve: true });
    assert.throws(
      () =>
        apply(doc, [
          {
            opId: 'delete',
            type: 'element.delete',
            surfaceId,
            elementId,
            includeChildren: false,
            references: 'reject',
          },
        ]),
      DocumentEditError
    );
    apply(
      doc,
      [
        {
          opId: 'delete',
          type: 'element.delete',
          surfaceId,
          elementId,
          includeChildren: false,
          references: 'detach',
        },
      ],
      'delete-shape'
    );
    assert.equal(elements.has(elementId), false);
    assert.deepEqual(elements.get(edgeId)!.get('source'), {
      position: [110, 60],
    });
  } finally {
    doc.destroy();
  }
});

void test('stroke resizing preserves pressure and uses the editor geometry transform', () => {
  const { doc, blocks } = fixture();
  try {
    const made = apply(doc, [
      {
        opId: 'surface',
        type: 'block.create',
        clientRef: 'surface',
        parentId: 'page',
        flavour: 'affine:surface',
      },
      {
        opId: 'brush',
        type: 'element.create',
        surfaceId: '$surface',
        clientRef: 'brush',
        element: { kind: 'brush', properties: {} },
      },
      {
        opId: 'points',
        type: 'element.stroke.set_points',
        surfaceId: '$surface',
        elementId: '$brush',
        points: [
          [10, 20, 0.4],
          [30, 40, 0.8],
        ],
      },
    ]);
    const surfaceId = made.identities.surface,
      elementId = made.identities.brush;
    const elements = (
      blocks.get(surfaceId)!.get('prop:elements') as Y.Map<unknown>
    ).get('value') as Y.Map<Y.Map<unknown>>;
    const brush = elements.get(elementId)!;
    assert.deepEqual(brush.get('points'), [
      [2, 2, 0.4],
      [22, 22, 0.8],
    ]);
    apply(
      doc,
      [
        {
          opId: 'resize',
          type: 'element.update',
          surfaceId,
          elementId,
          element: { kind: 'brush', properties: { xywh: '[8,18,44,44]' } },
        },
      ],
      'resize-stroke'
    );
    assert.deepEqual(brush.get('points'), [
      [2, 2, 0.4],
      [42, 42, 0.8],
    ]);
  } finally {
    doc.destroy();
  }
});

void test('array insertions and moves retain unrelated maps, opaque data and item anchors', () => {
  const doc = new Y.Doc(),
    array = doc.getArray<unknown>('values');
  for (const id of ['a', 'b', 'c'])
    array.push([
      new Y.Map<string | number>([
        ['id', id],
        ['unknown', 42],
      ]),
    ]);
  const a = array.get(0),
    b = array.get(1),
    c = array.get(2);
  const anchor = Y.createRelativePositionFromTypeIndex(array, 1);
  const identity = (value: unknown) =>
    String(value instanceof Y.Map ? value.get('id') : value);
  reconcileNativeArray(
    array,
    ['new', 'a', 'b', 'c'],
    identity,
    (id, previous) =>
      previous instanceof Y.Map ? previous.clone() : new Y.Map([['id', id]]),
    () => {}
  );
  assert.equal(array.get(1), a);
  assert.equal(array.get(2), b);
  assert.equal(array.get(3), c);
  assert.equal(
    Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index,
    2
  );
  reconcileNativeArray(
    array,
    ['new', 'c', 'a', 'b'],
    identity,
    (id, previous) =>
      previous instanceof Y.Map ? previous.clone() : new Y.Map([['id', id]]),
    () => {}
  );
  assert.equal(array.get(2), a);
  assert.equal(array.get(3), b);
  assert.equal((array.get(1) as Y.Map<unknown>).get('unknown'), 42);
  doc.destroy();
});

void test('missing and legacy table cells remain byte-identical on empty or equal edits', () => {
  const { doc, table } = fixture();
  table.set('prop:cells.r1:c2.text', 'legacy');
  const before = Y.encodeStateAsUpdate(doc);
  assert.equal(
    apply(doc, [
      {
        ...splice('table', 0, 0, ''),
        target: {
          kind: 'table_cell',
          blockId: 'table',
          rowId: 'r2',
          columnId: 'c1',
        },
      },
    ]).changed,
    false
  );
  assert.equal(
    apply(doc, [
      {
        ...splice('table', 0, 6, 'legacy'),
        target: {
          kind: 'table_cell',
          blockId: 'table',
          rowId: 'r1',
          columnId: 'c2',
        },
      },
    ]).changed,
    false
  );
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  doc.destroy();
});

void test('history reconciliation retains unaffected text objects and relative anchors', () => {
  const { doc, paragraph, table } = fixture();
  const before = Y.encodeStateAsUpdate(doc);
  const text = paragraph.get('prop:text') as Y.Text,
    cell = table.get('prop:cells.r2:c2.text');
  const anchor = Y.createRelativePositionFromTypeIndex(text, 9);
  apply(doc, [splice('paragraph', 0, 6, 'changed')]);
  const plan = restoreNativeDocument(Y.encodeStateAsUpdate(doc), before);
  Y.applyUpdate(doc, plan.update);
  assert.equal(paragraph.get('prop:text'), text);
  assert.equal(table.get('prop:cells.r2:c2.text'), cell);
  assert.equal(text.toString(), 'before KEEP after');
  assert.equal(
    Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index,
    9
  );
  assert.equal(
    restoreNativeDocument(Y.encodeStateAsUpdate(doc), before).changed,
    false
  );
  doc.destroy();
});

void test('equivalent run segmentation is no-op and insertion can inherit either side', () => {
  const { doc, paragraph } = fixture();
  try {
    const text = paragraph.get('prop:text') as Y.Text;
    text.delete(0, text.length);
    text.insert(0, 'AB', { bold: true });
    text.insert(2, 'CD', { italic: true });
    const vector = Y.encodeStateVector(doc);
    const unchanged = apply(doc, [
      {
        type: 'text.splice',
        opId: 'same',
        target: { kind: 'block_text', blockId: 'paragraph' },
        offset: 0,
        deleteCount: 2,
        insert: [
          { insert: 'A', attributes: { bold: true } },
          { insert: 'B', attributes: { bold: true } },
        ],
      },
    ]);
    assert.equal(unchanged.changed, false);
    assert.deepEqual(Y.encodeStateVector(doc), vector);
    apply(
      doc,
      [
        {
          type: 'text.splice',
          opId: 'left',
          target: { kind: 'block_text', blockId: 'paragraph' },
          offset: 2,
          deleteCount: 0,
          marksPolicy: 'inherit_left',
          insert: [{ insert: 'L' }],
        },
      ],
      'left'
    );
    apply(
      doc,
      [
        {
          type: 'text.splice',
          opId: 'right',
          target: { kind: 'block_text', blockId: 'paragraph' },
          offset: 3,
          deleteCount: 0,
          marksPolicy: 'inherit_right',
          insert: [{ insert: 'R' }],
        },
      ],
      'right'
    );
    assert.deepEqual(normalizeNativeRuns(text.toDelta()), [
      { insert: 'ABL', attributes: { bold: true } },
      { insert: 'RCD', attributes: { italic: true } },
    ]);
  } finally {
    doc.destroy();
  }
});

void test('document comment anchors survive normal edits, resolve, reopen and explicit removal', () => {
  const { doc } = fixture();
  try {
    const change = (state: boolean | null, anchor?: { kind: 'document' }) => {
      const plan = editCommentAnchors(Y.encodeStateAsUpdate(doc), [
        { id: 'document-thread', state, anchor },
      ]);
      Y.applyUpdate(doc, plan.update);
      return plan;
    };
    assert.equal(change(true, { kind: 'document' }).changed, true);
    assert.ok(
      nativeCommentIds(Y.encodeStateAsUpdate(doc)).includes('document-thread')
    );
    change(false);
    assert.ok(
      nativeCommentIds(Y.encodeStateAsUpdate(doc)).includes('document-thread')
    );
    change(true);
    assert.equal(change(true, { kind: 'document' }).changed, false);
    change(null);
    assert.ok(
      !nativeCommentIds(Y.encodeStateAsUpdate(doc)).includes('document-thread')
    );
  } finally {
    doc.destroy();
  }
});

void test('range replacement retains unchanged interior CRDT items and their comment anchors', () => {
  const { doc, paragraph } = fixture();
  try {
    const text = paragraph.get('prop:text') as Y.Text;
    text.format(7, 4, { 'comment-thread': true, futureMark: 'keep' });
    const position = Y.createRelativePositionFromTypeIndex(text, 8);
    apply(doc, [
      {
        opId: 'rewrite-range',
        type: 'text.splice',
        target: { kind: 'block_text', blockId: 'paragraph', field: 'text' },
        offset: 0,
        deleteCount: text.length,
        insert: [{ insert: 'changed KEEP ending' }],
        marksPolicy: 'explicit',
      },
    ]);
    const resolved = Y.createAbsolutePositionFromRelativePosition(
      position,
      doc
    );
    assert.equal(resolved?.type, text);
    assert.equal(resolved?.index, 9);
    assert.ok(
      text
        .toDelta()
        .some(
          run =>
            run.insert === 'KEEP' && run.attributes?.['comment-thread'] === true
        )
    );
  } finally {
    doc.destroy();
  }
});

void test('mapped Markdown preserves unknown marks, empty siblings and interior anchors while applying expressed formats', () => {
  const { doc, paragraph, blocks } = fixture();
  try {
    const text = paragraph.get('prop:text') as Y.Text;
    text.format(7, 4, {
      underline: true,
      'comment-thread': true,
      futureMark: 'keep',
    });
    const position = Y.createRelativePositionFromTypeIndex(text, 8);
    const command = {
      type: 'markdown.rewrite',
      opId: 'rewrite',
      parentId: 'note',
      selectedBlockIds: ['paragraph'],
      mode: 'update_preserve',
      markdown: 'changed **KEEP** ending',
      marksPolicy: 'preserve_existing',
      mappings: [{ path: '0', blockId: 'paragraph' }],
    };
    apply(doc, [command]);
    assert.equal(text.toString(), 'changed KEEP ending');
    assert.equal(
      Y.createAbsolutePositionFromRelativePosition(position, doc)?.index,
      9
    );
    assert.ok(
      text
        .toDelta()
        .some(
          run =>
            run.insert === 'KEEP' &&
            run.attributes?.underline &&
            run.attributes?.bold &&
            run.attributes?.futureMark === 'keep' &&
            run.attributes?.['comment-thread']
        )
    );
    assert.ok(blocks.has('empty') && blocks.has('future'));
    assert.equal(apply(doc, [command]).changed, false);
  } finally {
    doc.destroy();
  }
});

void test('Markdown table mapping retains axes, widths and unrelated cells and rejects ambiguous mappings atomically', () => {
  const { doc, table, cell } = fixture();
  try {
    const command = {
      type: 'markdown.rewrite',
      opId: 'table',
      parentId: 'note',
      selectedBlockIds: ['table'],
      mode: 'update_preserve',
      markdown: '| Header |\n| --- |\n| Changed |',
      marksPolicy: 'preserve_existing',
      mappings: [
        {
          path: '0',
          blockId: 'table',
          rowIds: ['r1', 'r2'],
          columnIds: ['c1'],
        },
      ],
    };
    apply(doc, [command]);
    assert.equal(table.get('prop:cells.r1:c1.text'), cell);
    assert.equal(cell.toString(), 'Header');
    assert.equal(
      (table.get('prop:cells.r2:c2.text') as Y.Text).toString(),
      'untouched'
    );
    assert.equal(table.get('prop:columns.c1.width'), 240);
    const before = Y.encodeStateAsUpdate(doc);
    assert.throws(
      () =>
        apply(doc, [
          {
            ...command,
            mappings: [
              {
                path: '0',
                blockId: 'table',
                rowIds: ['r1', 'r1'],
                columnIds: ['c1'],
              },
            ],
          },
        ]),
      DocumentEditError
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  } finally {
    doc.destroy();
  }
});

void test('Markdown creates native nested task lists, code literals and controlled inline HTML without fetching assets', () => {
  const { doc, blocks } = fixture();
  try {
    const result = apply(doc, [
      {
        type: 'markdown.rewrite',
        opId: 'new',
        parentId: 'note',
        selectedBlockIds: [],
        mode: 'update_preserve',
        markdown:
          '- [x] Done\n  - Child\n\n```txt\n<img src=x> | ![a](b)\n```\n\nText <u>underlined</u> and <span style="color: red">red</span>',
        marksPolicy: 'preserve_existing',
        mappings: [],
      },
    ]);
    const created = Object.values(result.identities).map(id => blocks.get(id)!);
    assert.ok(
      created.some(
        block =>
          block.get('sys:flavour') === 'affine:list' &&
          block.get('prop:checked') === true
      )
    );
    assert.ok(
      created.some(
        block =>
          block.get('sys:flavour') === 'affine:code' &&
          (block.get('prop:text') as Y.Text).toString() ===
            '<img src=x> | ![a](b)'
      )
    );
    assert.ok(
      created.some(block =>
        (block.get('prop:text') as Y.Text)
          ?.toDelta()
          .some(run => run.insert === 'underlined' && run.attributes?.underline)
      )
    );
    const before = Y.encodeStateAsUpdate(doc);
    assert.throws(
      () =>
        apply(doc, [
          {
            type: 'markdown.rewrite',
            opId: 'missing-asset',
            parentId: 'note',
            selectedBlockIds: [],
            mode: 'update_preserve',
            markdown: '![caption](https://example.invalid/image.png)',
            marksPolicy: 'preserve_existing',
            mappings: [],
          },
        ]),
      DocumentEditError
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  } finally {
    doc.destroy();
  }
});

void test('LocalMind database attachment/member/created-by columns keep native storage and immutable evidence', () => {
  const { doc, blocks } = fixture();
  try {
    const dependencies = {
      assets: { 'blob-a': { size: 2, mimeType: 'text/plain' } },
      resources: new Set<string>(),
      members: new Set(['user-a']),
    };
    const commands = [
      {
        type: 'block.create',
        opId: 'db',
        clientRef: 'db',
        parentId: 'note',
        flavour: 'affine:database',
      },
      ...['attachment', 'member', 'created-by'].map(type => ({
        type: 'database.column.create',
        opId: type,
        blockId: '$db',
        clientRef: type,
        column: { type, name: type, data: {} },
      })),
      {
        type: 'database.row.create',
        opId: 'row',
        blockId: '$db',
        clientRef: 'row',
        title: 'Native extensions',
      },
      {
        type: 'database.cell.files.set',
        opId: 'files',
        blockId: '$db',
        rowId: '$row',
        columnId: '$attachment',
        files: [{ blobId: 'blob-a', name: 'Notes.txt' }],
      },
      {
        type: 'database.cell.members.set',
        opId: 'members',
        blockId: '$db',
        rowId: '$row',
        columnId: '$member',
        userIds: ['user-a'],
      },
    ];
    const created = editNativeDocument({
      bin: Y.encodeStateAsUpdate(doc),
      commands,
      dependencies,
      actorId: 'editor',
      operationId: 'extensions',
      now: 1,
    });
    Y.applyUpdate(doc, created.update);
    const cells = blocks.get(created.identities.db)!.get('prop:cells') as Y.Map<
      Y.Map<Y.Map<unknown>>
    >;
    const files = cells
      .get(created.identities.row)!
      .get(created.identities.attachment)!
      .get('value') as Y.Map<Y.Map<unknown>>;
    files.get('blob-a')!.set('futureFileMetadata', { keep: true });
    const second = editNativeDocument({
      bin: Y.encodeStateAsUpdate(doc),
      commands: [
        {
          ...commands[5],
          blockId: created.identities.db,
          rowId: created.identities.row,
          columnId: created.identities.attachment,
        },
      ],
      dependencies,
      actorId: 'editor',
      operationId: 'no-op-files',
      now: 2,
    });
    assert.equal(second.changed, false);
    const copy = copyNativeDocument({
      bin: Y.encodeStateAsUpdate(doc),
      sourceId: 'source',
      targetId: 'copy',
      title: 'Copied',
      comments: new Map(),
      assets: new Map([['blob-a', 'blob-b']]),
    });
    const copied = new Y.Doc();
    try {
      Y.applyUpdate(copied, copy.bin);
      const values = (
        copied
          .getMap<Y.Map<unknown>>('blocks')
          .get(created.identities.db)!
          .get('prop:cells') as Y.Map<Y.Map<Y.Map<unknown>>>
      )
        .get(created.identities.row)!
        .get(created.identities.attachment)!
        .get('value') as Y.Map<Y.Map<unknown>>;
      assert.equal(values.get('blob-b')!.get('id'), 'blob-b');
      assert.deepEqual(values.get('blob-b')!.get('futureFileMetadata'), {
        keep: true,
      });
    } finally {
      copied.destroy();
    }
    assert.throws(
      () =>
        apply(doc, [
          {
            type: 'database.cell.set',
            opId: 'forge',
            blockId: created.identities.db,
            rowId: created.identities.row,
            columnId: created.identities['created-by'],
            value: 'another-author',
          },
        ]),
      DocumentEditError
    );
  } finally {
    doc.destroy();
  }
});

void test('maximum native command batch remains bounded and oversized input commits nothing', () => {
  const { doc, blocks, paragraph } = fixture();
  try {
    const before = Y.encodeStateAsUpdate(doc),
      retained = paragraph.get('prop:text');
    const commands = Array.from({ length: 1000 }, (_, index) => ({
      opId: `p-${index}`,
      type: 'block.create',
      parentId: 'note',
      flavour: 'affine:paragraph',
      clientRef: `p-${index}`,
      text: [{ insert: `段落 ${index}` }],
    }));
    assert.throws(() =>
      apply(doc, [
        ...commands,
        { ...commands[0], opId: 'overflow', clientRef: 'overflow' },
      ])
    );
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
    const edited = apply(doc, commands);
    assert.equal(Object.keys(edited.identities).length, 1000);
    assert.equal(blocks.size, 1006);
    assert.equal(paragraph.get('prop:text'), retained);
    assert.equal(
      (blocks.get('future')!.get('prop:opaque') as Y.Text).toString(),
      'DO NOT CHANGE'
    );
  } finally {
    doc.destroy();
  }
});

void test('seeded edit and undo sequences retain unrelated CRDT items, unknown marks and stable anchors', () => {
  const { doc, paragraph, table } = fixture();
  try {
    const text = paragraph.get('prop:text') as Y.Text;
    text.format(7, 4, {
      'future-mark': { retain: true },
      'comment-thread': true,
    });
    const anchor = Y.createRelativePositionFromTypeIndex(text, 8),
      initial = text.toDelta(),
      tableBefore = table.toJSON();
    let seed = 12345;
    for (let index = 0; index < 50; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const insert = ['中', '😀', 'e\u0301', '\n'][seed % 4];
      apply(
        doc,
        [
          {
            opId: 'insert',
            type: 'text.splice',
            target: { kind: 'block_text', blockId: 'paragraph' },
            offset: 0,
            deleteCount: 0,
            insert: [{ insert }],
          },
        ],
        `insert-${index}`
      );
      apply(
        doc,
        [
          {
            opId: 'remove',
            type: 'text.splice',
            target: { kind: 'block_text', blockId: 'paragraph' },
            offset: 0,
            deleteCount: insert.length,
            insert: [],
          },
        ],
        `remove-${index}`
      );
      assert.equal(paragraph.get('prop:text'), text);
      assert.equal(
        Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index,
        8
      );
      assert.deepEqual(text.toDelta(), initial);
      assert.deepEqual(table.toJSON(), tableBefore);
    }
  } finally {
    doc.destroy();
  }
});
