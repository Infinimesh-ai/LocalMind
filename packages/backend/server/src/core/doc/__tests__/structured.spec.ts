import test from 'ava';
import * as Y from 'yjs';

import { StructuredDocService } from '../structured';

type YBlock = Y.Map<unknown>;

function block(
  id: string,
  flavour: string,
  children: string[] = [],
  props: Record<string, unknown> = {}
) {
  const value = new Y.Map<unknown>();
  value.set('sys:id', id);
  value.set('sys:flavour', flavour);
  value.set('sys:version', flavour === 'affine:database' ? 3 : 1);
  const childArray = new Y.Array<string>();
  childArray.push(children);
  value.set('sys:children', childArray);
  for (const [key, prop] of Object.entries(props)) {
    value.set(`prop:${key}`, prop);
  }
  return value;
}

function boxedMap(value: Y.Map<unknown>) {
  const boxed = new Y.Map<unknown>();
  boxed.set('type', '$blocksuite:internal:native$');
  boxed.set('value', value);
  return boxed;
}

function fixture() {
  const doc = new Y.Doc({ guid: 'doc-1' });
  const blocks = doc.getMap<YBlock>('blocks');

  const elements = new Y.Map<Y.Map<unknown>>();
  const shape = new Y.Map<unknown>();
  shape.set('id', 'shape-1');
  shape.set('type', 'shape');
  shape.set('xywh', '[0,0,100,100]');
  shape.set('text', new Y.Text('Old'));
  elements.set('shape-1', shape);

  blocks.set('page-1', block('page-1', 'affine:page', ['surface-1', 'note-1']));
  blocks.set(
    'surface-1',
    block('surface-1', 'affine:surface', [], {
      elements: boxedMap(elements as unknown as Y.Map<unknown>),
    })
  );
  blocks.set(
    'note-1',
    block('note-1', 'affine:note', ['paragraph-1', 'database-1'], {
      xywh: '[0,0,800,95]',
    })
  );
  blocks.set(
    'paragraph-1',
    block('paragraph-1', 'affine:paragraph', [], {
      type: 'text',
      text: new Y.Text('Hello'),
    })
  );

  const columns = new Y.Array<Y.Map<unknown>>();
  const views = new Y.Array<Y.Map<unknown>>();
  const cells = new Y.Map<Y.Map<unknown>>();
  blocks.set(
    'database-1',
    block('database-1', 'affine:database', [], {
      title: new Y.Text('Tasks'),
      columns,
      views,
      cells,
    })
  );

  return doc;
}

function createService() {
  let persisted = fixture();
  let timestamp = 1;
  const reader = {
    getDoc: async () => ({
      spaceId: 'workspace-1',
      docId: 'doc-1',
      bin: Y.encodeStateAsUpdate(persisted),
      timestamp,
    }),
  };
  const writer = {
    pushDocUpdate: async (
      _workspaceId: string,
      _docId: string,
      update: Uint8Array
    ) => {
      Y.applyUpdate(persisted, update);
      timestamp++;
      return { success: true, timestamp };
    },
  };
  return new StructuredDocService(reader as never, writer as never);
}

test('structured document service round-trips blocks and whiteboard elements', async t => {
  const service = createService();

  const before = await service.readWhiteboard('workspace-1', 'doc-1');
  t.is(before.surfaces[0]?.elements[0]?.id, 'shape-1');

  const whiteboardWrite = await service.applyWhiteboardOperations(
    'workspace-1',
    'doc-1',
    'user-1',
    [
      {
        op: 'update_element',
        elementId: 'shape-1',
        props: { text: 'Updated' },
      },
      {
        op: 'add_element',
        type: 'text',
        props: { text: 'New label', xywh: '[120,0,80,30]' },
      },
    ]
  );
  t.is(whiteboardWrite.createdElementIds.length, 1);

  const blockWrite = await service.applyBlockOperations(
    'workspace-1',
    'doc-1',
    'user-1',
    [
      {
        op: 'add',
        flavour: 'affine:paragraph',
        parentId: 'note-1',
        props: { text: 'Second paragraph' },
      },
    ]
  );
  t.is(blockWrite.createdBlockIds.length, 1);

  const after = await service.readWhiteboard('workspace-1', 'doc-1');
  t.is(after.surfaces[0]?.elements.length, 2);
  const shape = after.surfaces[0]?.elements.find(
    element => element.id === 'shape-1'
  );
  if (!shape) {
    t.fail('Expected shape-1 after whiteboard update.');
    return;
  }
  t.deepEqual((shape.props as { text?: unknown }).text, {
    text: 'Updated',
    delta: [{ insert: 'Updated' }],
  });

  const blocks = await service.readBlocks('workspace-1', 'doc-1');
  const created = blocks.blocks.find(
    item => item.id === blockWrite.createdBlockIds[0]
  );
  t.is(created?.parentId, 'note-1');
  t.deepEqual(created?.props.text, {
    text: 'Second paragraph',
    delta: [{ insert: 'Second paragraph' }],
  });
});

test('structured document service round-trips database operations', async t => {
  const service = createService();
  const result = await service.applyDatabaseOperations(
    'workspace-1',
    'doc-1',
    'database-1',
    'user-1',
    [
      {
        op: 'add_column',
        id: 'status',
        name: 'Status',
        type: 'select',
        data: { options: [{ id: 'todo', value: 'Todo' }] },
      },
      {
        op: 'add_row',
        id: 'row-1',
        title: 'Ship MCP',
        cells: { status: 'todo' },
      },
      {
        op: 'update_cell',
        rowId: 'row-1',
        columnId: 'status',
        value: 'done',
      },
      {
        op: 'add_view',
        view: { id: 'view-1', name: 'All', mode: 'table' },
      },
    ]
  );

  t.deepEqual(result.createdColumnIds, ['status']);
  t.deepEqual(result.createdRowIds, ['row-1']);

  const read = await service.readDatabases('workspace-1', 'doc-1');
  const database = read.databases[0];
  t.deepEqual(database?.columns, [
    {
      id: 'status',
      name: 'Status',
      type: 'select',
      data: { options: [{ id: 'todo', value: 'Todo' }] },
    },
  ]);
  t.deepEqual(database?.cells, {
    'row-1': { status: { columnId: 'status', value: 'done' } },
  });
  t.deepEqual(database?.views, [{ id: 'view-1', name: 'All', mode: 'table' }]);
  t.deepEqual(database?.rows, [
    {
      id: 'row-1',
      flavour: 'affine:paragraph',
      title: { text: 'Ship MCP', delta: [{ insert: 'Ship MCP' }] },
    },
  ]);
});

test('structured document service restores a historical snapshot with a real update', async t => {
  const service = createService();
  const historical = Y.encodeStateAsUpdate(fixture());

  await service.applyWhiteboardOperations('workspace-1', 'doc-1', 'user-1', [
    {
      op: 'update_element',
      elementId: 'shape-1',
      props: { text: 'Changed after snapshot' },
    },
  ]);
  const changed = await service.readWhiteboard('workspace-1', 'doc-1');
  const changedShape = changed.surfaces[0]?.elements[0];
  if (!changedShape) {
    t.fail('Expected changed whiteboard shape.');
    return;
  }
  t.deepEqual((changedShape.props as { text?: unknown }).text, {
    text: 'Changed after snapshot',
    delta: [{ insert: 'Changed after snapshot' }],
  });

  const result = await service.restoreSnapshot(
    'workspace-1',
    'doc-1',
    'user-1',
    historical
  );
  t.true(result.restored);

  const restored = await service.readWhiteboard('workspace-1', 'doc-1');
  const restoredShape = restored.surfaces[0]?.elements[0];
  if (!restoredShape) {
    t.fail('Expected restored whiteboard shape.');
    return;
  }
  t.deepEqual((restoredShape.props as { text?: unknown }).text, {
    text: 'Old',
    delta: [{ insert: 'Old' }],
  });
});
