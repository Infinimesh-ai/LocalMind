import { Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { DocReader } from './reader';
import { DocWriter } from './writer';

const MAX_OPERATIONS = 100;
const MAX_INPUT_BYTES = 512 * 1024;
const NATIVE_BOX_TYPE = '$blocksuite:internal:native$';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SURFACE_ELEMENT_TYPES = new Set([
  'brush',
  'connector',
  'group',
  'highlighter',
  'mindmap',
  'shape',
  'text',
]);

const BLOCK_VERSIONS: Record<string, number> = {
  'affine:attachment': 1,
  'affine:bookmark': 1,
  'affine:callout': 1,
  'affine:code': 1,
  'affine:data-view': 1,
  'affine:database': 3,
  'affine:divider': 1,
  'affine:edgeless-text': 1,
  'affine:embed-figma': 1,
  'affine:embed-github': 1,
  'affine:embed-html': 1,
  'affine:embed-iframe': 1,
  'affine:embed-linked-doc': 1,
  'affine:embed-loom': 1,
  'affine:embed-synced-doc': 1,
  'affine:embed-youtube': 1,
  'affine:frame': 1,
  'affine:image': 1,
  'affine:latex': 1,
  'affine:list': 1,
  'affine:note': 1,
  'affine:page': 2,
  'affine:paragraph': 1,
  'affine:surface': 5,
  'affine:surface-ref': 1,
  'affine:table': 1,
};

const TEXT_BLOCK_PROPS = new Set(['text', 'title']);
const BLOCK_DEFAULTS: Record<string, JsonObject> = {
  'affine:callout': {
    icon: { type: 'emoji', unicode: '\u{1F4A1}' },
    text: '',
    backgroundColorName: 'grey',
  },
  'affine:code': { text: '', language: null, wrap: false, caption: '' },
  'affine:data-view': { views: [], title: '', columns: [], cells: {} },
  'affine:database': { views: [], title: '', cells: {}, columns: [] },
  'affine:edgeless-text': {
    xywh: '[0,0,16,16]',
    index: 'a0',
    lockedBySelf: false,
    scale: 1,
    rotate: 0,
    hasMaxWidth: false,
    text: '',
  },
  'affine:frame': {
    title: '',
    background: 'transparent',
    xywh: '[0,0,100,100]',
    index: 'a0',
    childElementIds: {},
  },
  'affine:latex': {
    xywh: '[0,0,16,16]',
    index: 'a0',
    lockedBySelf: false,
    scale: 1,
    rotate: 0,
    latex: '',
  },
  'affine:list': {
    type: 'bulleted',
    text: '',
    checked: false,
    collapsed: false,
  },
  'affine:note': {
    xywh: '[0,0,800,95]',
    index: 'a0',
    lockedBySelf: false,
    hidden: false,
    displayMode: 'both',
    collapse: false,
    collapsedHeight: 95,
  },
  'affine:paragraph': { type: 'text', text: '', collapsed: false },
  'affine:surface-ref': {
    reference: '',
    caption: '',
    refFlavour: '',
  },
  'affine:table': { rows: {}, columns: {}, cells: {} },
};

export type JsonObject = Record<string, unknown>;
type YBlock = Y.Map<unknown>;

export type BlockOperation =
  | {
      op: 'add';
      flavour: string;
      id?: string;
      parentId?: string;
      index?: number;
      props?: JsonObject;
    }
  | { op: 'update'; blockId: string; props: JsonObject }
  | {
      op: 'move';
      blockIds: string[];
      parentId: string;
      targetSiblingId?: string;
      before?: boolean;
    }
  | {
      op: 'delete';
      blockId: string;
      deleteChildren?: boolean;
      bringChildrenTo?: string;
    };

export type WhiteboardOperation =
  | {
      op: 'add_element';
      surfaceId?: string;
      type: string;
      props?: JsonObject;
    }
  | {
      op: 'update_element';
      surfaceId?: string;
      elementId: string;
      props: JsonObject;
    }
  | {
      op: 'delete_element';
      surfaceId?: string;
      elementId: string;
    };

export type DatabaseOperation =
  | {
      op: 'add_column';
      id?: string;
      index?: number;
      name: string;
      type: string;
      data?: JsonObject;
    }
  | {
      op: 'update_column';
      columnId: string;
      name?: string;
      type?: string;
      data?: JsonObject;
    }
  | { op: 'delete_column'; columnId: string }
  | {
      op: 'add_row';
      id?: string;
      index?: number;
      title?: string;
      cells?: Record<string, unknown>;
    }
  | { op: 'update_row_title'; rowId: string; title: string }
  | {
      op: 'update_cell';
      rowId: string;
      columnId: string;
      value: unknown;
    }
  | { op: 'delete_row'; rowId: string }
  | { op: 'add_view'; view: JsonObject; index?: number }
  | { op: 'update_view'; viewId: string; patch: JsonObject }
  | { op: 'delete_view'; viewId: string };

type LoadedDoc = {
  doc: Y.Doc;
  blocks: Y.Map<YBlock>;
  stateVector: Uint8Array;
};

function assertJsonValue(value: unknown, path = 'value', seen = new Set()) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`${path} must contain only JSON values.`);
  }
  if (seen.has(value)) throw new Error(`${path} must not contain cycles.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertJsonValue(item, `${path}[${index}]`, seen)
    );
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`${path} contains a forbidden key.`);
      }
      assertJsonValue(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function assertOperationInput(operations: unknown[]) {
  if (operations.length > MAX_OPERATIONS) {
    throw new Error(`At most ${MAX_OPERATIONS} operations are allowed.`);
  }
  assertJsonValue(operations, 'operations');
  if (Buffer.byteLength(JSON.stringify(operations)) > MAX_INPUT_BYTES) {
    throw new Error(`Operation input exceeds ${MAX_INPUT_BYTES} bytes.`);
  }
}

function jsonToY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    array.push(value.map(jsonToY));
    return array;
  }
  if (value && typeof value === 'object') {
    const map = new Y.Map<unknown>();
    for (const [key, item] of Object.entries(value)) {
      map.set(key, jsonToY(item));
    }
    return map;
  }
  return value;
}

function serializeYValue(value: unknown): unknown {
  if (value instanceof Y.Text) {
    return { text: value.toString(), delta: value.toDelta() };
  }
  if (value instanceof Y.Array) return value.toArray().map(serializeYValue);
  if (value instanceof Y.Map) {
    if (value.get('type') === NATIVE_BOX_TYPE) {
      return serializeYValue(value.get('value'));
    }
    return Object.fromEntries(
      Array.from(value.entries()).map(([key, item]) => [
        key,
        serializeYValue(item),
      ])
    );
  }
  if (value instanceof Uint8Array) {
    return { base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(serializeYValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeYValue(item)])
    );
  }
  return value;
}

function childrenOf(block: YBlock) {
  const children = block.get('sys:children');
  if (!(children instanceof Y.Array)) {
    throw new Error(
      `Block ${String(block.get('sys:id'))} has invalid children.`
    );
  }
  return children as Y.Array<string>;
}

function flavourOf(block: YBlock) {
  return block.get('sys:flavour') as string;
}

function idOf(block: YBlock) {
  return block.get('sys:id') as string;
}

function parentOf(blocks: Y.Map<YBlock>, blockId: string) {
  for (const block of blocks.values()) {
    if (childrenOf(block).toArray().includes(blockId)) return block;
  }
  return null;
}

function serializeBlock(block: YBlock, parentId: string | null) {
  const props: JsonObject = {};
  block.forEach((value, key) => {
    if (key.startsWith('prop:')) props[key.slice(5)] = serializeYValue(value);
  });
  return {
    id: idOf(block),
    flavour: flavourOf(block),
    version: block.get('sys:version') as number,
    parentId,
    children: childrenOf(block).toArray(),
    props,
  };
}

function setBlockProp(
  block: YBlock,
  key: string,
  value: unknown,
  flavour = flavourOf(block)
) {
  block.set(
    `prop:${key}`,
    TEXT_BLOCK_PROPS.has(key) &&
      typeof value === 'string' &&
      flavour !== 'affine:data-view'
      ? new Y.Text(value)
      : jsonToY(value)
  );
}

function createBlock(flavour: string, id: string, props: JsonObject) {
  const version = BLOCK_VERSIONS[flavour];
  if (!version) throw new Error(`Unsupported block flavour ${flavour}.`);
  if (flavour === 'affine:page' || flavour === 'affine:surface') {
    throw new Error(
      `Creating ${flavour} through block operations is not allowed.`
    );
  }
  const block = new Y.Map<unknown>();
  block.set('sys:id', id);
  block.set('sys:flavour', flavour);
  block.set('sys:version', version);
  block.set('sys:children', new Y.Array<string>());
  for (const [key, value] of Object.entries({
    ...BLOCK_DEFAULTS[flavour],
    ...props,
  })) {
    setBlockProp(block, key, value, flavour);
  }
  return block;
}

function insertAt(array: Y.Array<string>, value: string, index?: number) {
  const position = Math.max(0, Math.min(index ?? array.length, array.length));
  array.insert(position, [value]);
}

function removeFromParent(blocks: Y.Map<YBlock>, blockId: string) {
  const parent = parentOf(blocks, blockId);
  if (!parent) return;
  const children = childrenOf(parent);
  const index = children.toArray().indexOf(blockId);
  if (index >= 0) children.delete(index, 1);
}

function descendantsOf(blocks: Y.Map<YBlock>, blockId: string) {
  const descendants = new Set<string>();
  const visit = (id: string) => {
    const block = blocks.get(id);
    if (!block) return;
    childrenOf(block).forEach(childId => {
      if (!descendants.has(childId)) {
        descendants.add(childId);
        visit(childId);
      }
    });
  };
  visit(blockId);
  return descendants;
}

function surfaceElements(blocks: Y.Map<YBlock>, surfaceId?: string) {
  let surface: YBlock | undefined;
  if (surfaceId) {
    surface = blocks.get(surfaceId);
  } else {
    surface = Array.from(blocks.values()).find(
      block => flavourOf(block) === 'affine:surface'
    );
  }
  if (!surface || flavourOf(surface) !== 'affine:surface') {
    throw new Error(
      surfaceId
        ? `Surface block ${surfaceId} was not found.`
        : 'The document has no surface block.'
    );
  }
  const boxed = surface.get('prop:elements');
  const elements =
    boxed instanceof Y.Map && boxed.get('type') === NATIVE_BOX_TYPE
      ? boxed.get('value')
      : boxed;
  if (!(elements instanceof Y.Map)) {
    throw new Error(`Surface block ${idOf(surface)} has invalid elements.`);
  }
  return { surface, elements: elements as Y.Map<Y.Map<unknown>> };
}

function setElementProp(element: Y.Map<unknown>, key: string, value: unknown) {
  if (['text', 'title'].includes(key) && typeof value === 'string') {
    element.set(key, new Y.Text(value));
    return;
  }
  if (key === 'children' && value && typeof value === 'object') {
    const children = new Y.Map<unknown>();
    for (const [childId, detail] of Object.entries(value)) {
      children.set(childId, jsonToY(detail === true ? true : detail));
    }
    element.set(key, children);
    return;
  }
  element.set(key, jsonToY(value));
}

function ensureYArray(block: YBlock, prop: string) {
  const value = block.get(`prop:${prop}`);
  if (!(value instanceof Y.Array)) {
    throw new Error(`Database property ${prop} is invalid.`);
  }
  return value as Y.Array<Y.Map<unknown>>;
}

function ensureYMap(block: YBlock, prop: string) {
  const value = block.get(`prop:${prop}`);
  if (!(value instanceof Y.Map)) {
    throw new Error(`Database property ${prop} is invalid.`);
  }
  return value as Y.Map<Y.Map<unknown>>;
}

function mapWith(values: JsonObject) {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(values))
    map.set(key, jsonToY(value));
  return map;
}

function blockSnapshot(blocks: Y.Map<YBlock>, docId: string) {
  return {
    docId,
    blocks: Array.from(blocks.values()).map(block =>
      serializeBlock(
        block,
        (parentOf(blocks, idOf(block))?.get('sys:id') as string) ?? null
      )
    ),
  };
}

function whiteboardSnapshot(blocks: Y.Map<YBlock>, docId: string) {
  const surfaces = Array.from(blocks.values())
    .filter(block => flavourOf(block) === 'affine:surface')
    .map(surface => {
      const { elements } = surfaceElements(blocks, idOf(surface));
      return {
        surfaceId: idOf(surface),
        elements: Array.from(elements.entries()).map(([id, element]) => ({
          id,
          type: element.get('type') as string,
          props: serializeYValue(element),
        })),
      };
    });
  const edgelessBlocks = Array.from(blocks.values())
    .filter(block =>
      ['affine:note', 'affine:frame', 'affine:edgeless-text'].includes(
        flavourOf(block)
      )
    )
    .map(block =>
      serializeBlock(
        block,
        (parentOf(blocks, idOf(block))?.get('sys:id') as string) ?? null
      )
    );
  return { docId, surfaces, blocks: edgelessBlocks };
}

function databaseSnapshot(blocks: Y.Map<YBlock>, docId: string) {
  const databases = Array.from(blocks.values())
    .filter(block => flavourOf(block) === 'affine:database')
    .map(block => ({
      databaseId: idOf(block),
      title: serializeYValue(block.get('prop:title')),
      columns: serializeYValue(block.get('prop:columns')),
      views: serializeYValue(block.get('prop:views')),
      cells: serializeYValue(block.get('prop:cells')),
      rows: childrenOf(block)
        .toArray()
        .map(rowId => {
          const row = blocks.get(rowId);
          return {
            id: rowId,
            flavour: row ? flavourOf(row) : null,
            title: row ? serializeYValue(row.get('prop:text')) : null,
          };
        }),
    }));
  return { docId, databases };
}

function cloneYValue(value: unknown): unknown {
  if (value instanceof Y.Text) {
    const text = new Y.Text();
    text.applyDelta(value.toDelta());
    return text;
  }
  if (value instanceof Y.Array) {
    const array = new Y.Array<unknown>();
    array.push(value.toArray().map(cloneYValue));
    return array;
  }
  if (value instanceof Y.Map) {
    const map = new Y.Map<unknown>();
    value.forEach((item, key) => map.set(key, cloneYValue(item)));
    return map;
  }
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return value.map(cloneYValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneYValue(item)])
    );
  }
  return value;
}

function replaceTopLevelMap(current: Y.Map<unknown>, target: Y.Map<unknown>) {
  current.clear();
  target.forEach((value, key) => current.set(key, cloneYValue(value)));
}

@Injectable()
export class StructuredDocService {
  constructor(
    private readonly reader: DocReader,
    private readonly writer: DocWriter
  ) {}

  private async load(workspaceId: string, docId: string): Promise<LoadedDoc> {
    const record = await this.reader.getDoc(workspaceId, docId);
    if (!record?.bin)
      throw new NotFoundException(`Document ${docId} not found`);
    const doc = new Y.Doc({ guid: docId });
    Y.applyUpdate(doc, record.bin);
    return {
      doc,
      blocks: doc.getMap('blocks'),
      stateVector: Y.encodeStateVector(doc),
    };
  }

  private async save(
    workspaceId: string,
    docId: string,
    editorId: string,
    loaded: LoadedDoc
  ) {
    const update = Y.encodeStateAsUpdate(loaded.doc, loaded.stateVector);
    return await this.writer.pushDocUpdate(
      workspaceId,
      docId,
      update,
      editorId
    );
  }

  async readBlocks(workspaceId: string, docId: string) {
    const loaded = await this.load(workspaceId, docId);
    try {
      return blockSnapshot(loaded.blocks, docId);
    } finally {
      loaded.doc.destroy();
    }
  }

  async applyBlockOperations(
    workspaceId: string,
    docId: string,
    editorId: string,
    operations: BlockOperation[]
  ) {
    assertOperationInput(operations);
    const loaded = await this.load(workspaceId, docId);
    const createdBlockIds: string[] = [];
    try {
      loaded.doc.transact(() => {
        for (const operation of operations) {
          switch (operation.op) {
            case 'add': {
              const id = operation.id ?? nanoid();
              if (loaded.blocks.has(id))
                throw new Error(`Block ${id} already exists.`);
              const parent = operation.parentId
                ? loaded.blocks.get(operation.parentId)
                : undefined;
              if (operation.parentId && !parent) {
                throw new Error(
                  `Parent block ${operation.parentId} was not found.`
                );
              }
              const block = createBlock(
                operation.flavour,
                id,
                operation.props ?? {}
              );
              loaded.blocks.set(id, block);
              if (parent) insertAt(childrenOf(parent), id, operation.index);
              createdBlockIds.push(id);
              break;
            }
            case 'update': {
              const block = loaded.blocks.get(operation.blockId);
              if (!block)
                throw new Error(`Block ${operation.blockId} was not found.`);
              if (
                Object.keys(operation.props).some(key =>
                  ['id', 'flavour', 'children'].includes(key)
                )
              ) {
                throw new Error(
                  'Block identity and children cannot be updated as props.'
                );
              }
              for (const [key, value] of Object.entries(operation.props)) {
                setBlockProp(block, key, value);
              }
              break;
            }
            case 'move': {
              const parent = loaded.blocks.get(operation.parentId);
              if (!parent)
                throw new Error(
                  `Parent block ${operation.parentId} was not found.`
                );
              for (const blockId of operation.blockIds) {
                if (!loaded.blocks.has(blockId))
                  throw new Error(`Block ${blockId} was not found.`);
                if (
                  blockId === operation.parentId ||
                  descendantsOf(loaded.blocks, blockId).has(operation.parentId)
                ) {
                  throw new Error(
                    'A block cannot be moved into itself or its descendant.'
                  );
                }
              }
              let targetIndex = operation.targetSiblingId
                ? childrenOf(parent)
                    .toArray()
                    .indexOf(operation.targetSiblingId)
                : childrenOf(parent).length;
              if (operation.targetSiblingId && targetIndex < 0) {
                throw new Error(
                  `Sibling block ${operation.targetSiblingId} was not found.`
                );
              }
              if (operation.targetSiblingId && !(operation.before ?? true))
                targetIndex++;
              for (const blockId of operation.blockIds)
                removeFromParent(loaded.blocks, blockId);
              operation.blockIds.forEach((blockId, offset) =>
                insertAt(childrenOf(parent), blockId, targetIndex + offset)
              );
              break;
            }
            case 'delete': {
              const block = loaded.blocks.get(operation.blockId);
              if (!block)
                throw new Error(`Block ${operation.blockId} was not found.`);
              if (flavourOf(block) === 'affine:page')
                throw new Error('The root block cannot be deleted.');
              const children = childrenOf(block).toArray();
              const parent = parentOf(loaded.blocks, operation.blockId);
              if (operation.bringChildrenTo) {
                const target = loaded.blocks.get(operation.bringChildrenTo);
                if (!target)
                  throw new Error(
                    `Target block ${operation.bringChildrenTo} was not found.`
                  );
                children.forEach(childId => childrenOf(target).push([childId]));
              } else if (operation.deleteChildren ?? true) {
                descendantsOf(loaded.blocks, operation.blockId).forEach(id =>
                  loaded.blocks.delete(id)
                );
              } else if (parent) {
                children.forEach(childId => childrenOf(parent).push([childId]));
              }
              removeFromParent(loaded.blocks, operation.blockId);
              loaded.blocks.delete(operation.blockId);
              break;
            }
          }
        }
      });
      const saved = await this.save(workspaceId, docId, editorId, loaded);
      return { docId, createdBlockIds, ...saved };
    } finally {
      loaded.doc.destroy();
    }
  }

  async readWhiteboard(workspaceId: string, docId: string) {
    const loaded = await this.load(workspaceId, docId);
    try {
      return whiteboardSnapshot(loaded.blocks, docId);
    } finally {
      loaded.doc.destroy();
    }
  }

  async applyWhiteboardOperations(
    workspaceId: string,
    docId: string,
    editorId: string,
    operations: WhiteboardOperation[]
  ) {
    assertOperationInput(operations);
    const loaded = await this.load(workspaceId, docId);
    const createdElementIds: string[] = [];
    try {
      loaded.doc.transact(() => {
        for (const operation of operations) {
          const { elements } = surfaceElements(
            loaded.blocks,
            operation.surfaceId
          );
          switch (operation.op) {
            case 'add_element': {
              if (!SURFACE_ELEMENT_TYPES.has(operation.type)) {
                throw new Error(
                  `Unsupported surface element type ${operation.type}.`
                );
              }
              const id = nanoid();
              const element = new Y.Map<unknown>();
              element.set('id', id);
              element.set('type', operation.type);
              for (const [key, value] of Object.entries(
                operation.props ?? {}
              )) {
                if (['id', 'type'].includes(key)) continue;
                setElementProp(element, key, value);
              }
              elements.set(id, element);
              createdElementIds.push(id);
              break;
            }
            case 'update_element': {
              const element = elements.get(operation.elementId);
              if (!element)
                throw new Error(
                  `Surface element ${operation.elementId} was not found.`
                );
              for (const [key, value] of Object.entries(operation.props)) {
                if (['id', 'type'].includes(key)) continue;
                setElementProp(element, key, value);
              }
              break;
            }
            case 'delete_element': {
              const element = elements.get(operation.elementId);
              if (!element)
                throw new Error(
                  `Surface element ${operation.elementId} was not found.`
                );
              const pending = [operation.elementId];
              const deleted = new Set<string>();
              while (pending.length) {
                const id = pending.pop();
                if (id === undefined) break;
                if (deleted.has(id)) continue;
                deleted.add(id);
                const candidate = elements.get(id);
                const children = candidate?.get('children');
                if (children instanceof Y.Map) pending.push(...children.keys());
              }
              for (const candidate of elements.values()) {
                const children = candidate.get('children');
                if (children instanceof Y.Map) {
                  deleted.forEach(id => children.delete(id));
                }
              }
              deleted.forEach(id => elements.delete(id));
              break;
            }
          }
        }
      });
      const saved = await this.save(workspaceId, docId, editorId, loaded);
      return { docId, createdElementIds, ...saved };
    } finally {
      loaded.doc.destroy();
    }
  }

  async readDatabases(workspaceId: string, docId: string) {
    const loaded = await this.load(workspaceId, docId);
    try {
      return databaseSnapshot(loaded.blocks, docId);
    } finally {
      loaded.doc.destroy();
    }
  }

  async applyDatabaseOperations(
    workspaceId: string,
    docId: string,
    databaseId: string,
    editorId: string,
    operations: DatabaseOperation[]
  ) {
    assertOperationInput(operations);
    const loaded = await this.load(workspaceId, docId);
    const createdRowIds: string[] = [];
    const createdColumnIds: string[] = [];
    try {
      const database = loaded.blocks.get(databaseId);
      if (!database || flavourOf(database) !== 'affine:database') {
        throw new Error(`Database block ${databaseId} was not found.`);
      }
      const columns = ensureYArray(database, 'columns');
      const views = ensureYArray(database, 'views');
      const cells = ensureYMap(database, 'cells');
      loaded.doc.transact(() => {
        for (const operation of operations) {
          switch (operation.op) {
            case 'add_column': {
              const id = operation.id ?? nanoid();
              if (columns.toArray().some(column => column.get('id') === id)) {
                throw new Error(`Column ${id} already exists.`);
              }
              const column = mapWith({
                id,
                name: operation.name,
                type: operation.type,
                data: operation.data ?? {},
              });
              columns.insert(
                Math.max(
                  0,
                  Math.min(operation.index ?? columns.length, columns.length)
                ),
                [column]
              );
              createdColumnIds.push(id);
              break;
            }
            case 'update_column': {
              const column = columns
                .toArray()
                .find(candidate => candidate.get('id') === operation.columnId);
              if (!column)
                throw new Error(`Column ${operation.columnId} was not found.`);
              if (operation.name !== undefined)
                column.set('name', operation.name);
              if (operation.type !== undefined)
                column.set('type', operation.type);
              if (operation.data !== undefined)
                column.set('data', jsonToY(operation.data));
              break;
            }
            case 'delete_column': {
              const index = columns
                .toArray()
                .findIndex(column => column.get('id') === operation.columnId);
              if (index < 0)
                throw new Error(`Column ${operation.columnId} was not found.`);
              columns.delete(index, 1);
              cells.forEach(row => row.delete(operation.columnId));
              break;
            }
            case 'add_row': {
              const rowId = operation.id ?? nanoid();
              if (loaded.blocks.has(rowId))
                throw new Error(`Row ${rowId} already exists.`);
              const row = createBlock('affine:paragraph', rowId, {
                text: operation.title ?? '',
              });
              loaded.blocks.set(rowId, row);
              insertAt(childrenOf(database), rowId, operation.index);
              const rowCells = new Y.Map<unknown>();
              for (const [columnId, value] of Object.entries(
                operation.cells ?? {}
              )) {
                rowCells.set(columnId, mapWith({ columnId, value }));
              }
              cells.set(rowId, rowCells);
              createdRowIds.push(rowId);
              break;
            }
            case 'update_row_title': {
              if (!childrenOf(database).toArray().includes(operation.rowId)) {
                throw new Error(`Row ${operation.rowId} was not found.`);
              }
              loaded.blocks
                .get(operation.rowId)
                ?.set('prop:text', new Y.Text(operation.title));
              break;
            }
            case 'update_cell': {
              if (!childrenOf(database).toArray().includes(operation.rowId)) {
                throw new Error(`Row ${operation.rowId} was not found.`);
              }
              if (
                !columns
                  .toArray()
                  .some(column => column.get('id') === operation.columnId)
              ) {
                throw new Error(`Column ${operation.columnId} was not found.`);
              }
              let row = cells.get(operation.rowId);
              if (!row) {
                row = new Y.Map();
                cells.set(operation.rowId, row);
              }
              row.set(
                operation.columnId,
                mapWith({
                  columnId: operation.columnId,
                  value: operation.value,
                })
              );
              break;
            }
            case 'delete_row': {
              const index = childrenOf(database)
                .toArray()
                .indexOf(operation.rowId);
              if (index < 0)
                throw new Error(`Row ${operation.rowId} was not found.`);
              childrenOf(database).delete(index, 1);
              loaded.blocks.delete(operation.rowId);
              cells.delete(operation.rowId);
              break;
            }
            case 'add_view': {
              const view = mapWith(operation.view);
              views.insert(
                Math.max(
                  0,
                  Math.min(operation.index ?? views.length, views.length)
                ),
                [view]
              );
              break;
            }
            case 'update_view': {
              const view = views
                .toArray()
                .find(candidate => candidate.get('id') === operation.viewId);
              if (!view)
                throw new Error(`View ${operation.viewId} was not found.`);
              for (const [key, value] of Object.entries(operation.patch)) {
                view.set(key, jsonToY(value));
              }
              break;
            }
            case 'delete_view': {
              const index = views
                .toArray()
                .findIndex(view => view.get('id') === operation.viewId);
              if (index < 0)
                throw new Error(`View ${operation.viewId} was not found.`);
              views.delete(index, 1);
              break;
            }
          }
        }
      });
      const saved = await this.save(workspaceId, docId, editorId, loaded);
      return {
        docId,
        databaseId,
        createdRowIds,
        createdColumnIds,
        ...saved,
      };
    } finally {
      loaded.doc.destroy();
    }
  }

  readSnapshot(docId: string, binary: Uint8Array) {
    const doc = new Y.Doc({ guid: docId });
    try {
      Y.applyUpdate(doc, binary);
      const blocks = doc.getMap<YBlock>('blocks');
      return {
        docId,
        blocks: blockSnapshot(blocks, docId).blocks,
        whiteboard: whiteboardSnapshot(blocks, docId),
        databases: databaseSnapshot(blocks, docId).databases,
      };
    } finally {
      doc.destroy();
    }
  }

  async restoreSnapshot(
    workspaceId: string,
    docId: string,
    editorId: string,
    binary: Uint8Array
  ) {
    const loaded = await this.load(workspaceId, docId);
    const target = new Y.Doc({ guid: docId });
    try {
      Y.applyUpdate(target, binary);
      const names = new Set([
        ...loaded.doc.share.keys(),
        ...target.share.keys(),
      ]);
      loaded.doc.transact(() => {
        for (const name of names) {
          const currentMap = loaded.doc.getMap<unknown>(name);
          const targetType = target.share.get(name);
          if (!targetType) {
            currentMap.clear();
            continue;
          }
          const targetMap = target.getMap<unknown>(name);
          replaceTopLevelMap(currentMap, targetMap);
        }
      });
      const saved = await this.save(workspaceId, docId, editorId, loaded);
      return { docId, restored: true, ...saved };
    } finally {
      target.destroy();
      loaded.doc.destroy();
    }
  }
}
