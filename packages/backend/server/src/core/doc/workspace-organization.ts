import { Injectable, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { DocReader } from './reader';
import { DocWriter } from './writer';

const MAX_OPERATIONS = 100;
const MAX_INPUT_BYTES = 512 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type JsonObject = Record<string, unknown>;

export type WorkspaceRootOperation =
  | { op: 'set_workspace_profile'; name?: string; avatar?: string | null }
  | { op: 'set_document_trashed'; docId: string; trashed: boolean }
  | {
      op: 'create_tag';
      id?: string;
      value: string;
      color: string;
      parentId?: string | null;
    }
  | {
      op: 'update_tag';
      tagId: string;
      value?: string;
      color?: string;
      parentId?: string | null;
    }
  | { op: 'delete_tag'; tagId: string }
  | { op: 'set_document_tags'; docId: string; tagIds: string[] }
  | {
      op: 'create_collection';
      id?: string;
      name: string;
      rules?: JsonObject;
      allowList?: string[];
    }
  | {
      op: 'update_collection';
      collectionId: string;
      name?: string;
      rules?: JsonObject;
      allowList?: string[];
    }
  | { op: 'delete_collection'; collectionId: string };

export const WORKSPACE_DATA_TABLES = [
  'folders',
  'document_properties',
  'workspace_properties',
  'pinned_collections',
  'explorer_icons',
  'favorites',
  'user_settings',
] as const;

export type WorkspaceDataTable = (typeof WORKSPACE_DATA_TABLES)[number];

export type WorkspaceDataOperation =
  | { op: 'upsert'; key: string; values: JsonObject }
  | { op: 'delete'; key: string };

type TableDescriptor = {
  docId: (workspaceId: string, userId: string) => string;
  keyField: string;
};

const TABLES: Record<WorkspaceDataTable, TableDescriptor> = {
  // The server reads persisted docs directly, so use the physical IDs emitted
  // by the frontend nbstore id converter rather than its logical table IDs.
  folders: {
    docId: workspaceId => `db$${workspaceId}$folders`,
    keyField: 'id',
  },
  document_properties: {
    docId: workspaceId => `db$${workspaceId}$docProperties`,
    keyField: 'id',
  },
  workspace_properties: {
    docId: workspaceId => `db$${workspaceId}$docCustomPropertyInfo`,
    keyField: 'id',
  },
  pinned_collections: {
    docId: workspaceId => `db$${workspaceId}$pinnedCollections`,
    keyField: 'collectionId',
  },
  explorer_icons: {
    docId: workspaceId => `db$${workspaceId}$explorerIcon`,
    keyField: 'id',
  },
  favorites: {
    docId: (workspaceId, userId) =>
      `userdata$${userId}$${workspaceId}$favorite`,
    keyField: 'key',
  },
  user_settings: {
    docId: (workspaceId, userId) =>
      `userdata$${userId}$${workspaceId}$settings`,
    keyField: 'key',
  },
};

export function resolveWorkspaceDataDocId(
  table: WorkspaceDataTable,
  workspaceId: string,
  userId: string
) {
  return TABLES[table].docId(workspaceId, userId);
}

type LoadedDoc = {
  doc: Y.Doc;
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

function assertOperations(operations: unknown[]) {
  if (!operations.length)
    throw new Error('At least one operation is required.');
  if (operations.length > MAX_OPERATIONS) {
    throw new Error(`At most ${MAX_OPERATIONS} operations are allowed.`);
  }
  assertJsonValue(operations, 'operations');
  if (Buffer.byteLength(JSON.stringify(operations)) > MAX_INPUT_BYTES) {
    throw new Error(`Operation input exceeds ${MAX_INPUT_BYTES} bytes.`);
  }
}

function serialize(value: unknown): unknown {
  if (value instanceof Y.Text) {
    return { text: value.toString(), delta: value.toDelta() };
  }
  if (value instanceof Y.Array) return value.toArray().map(serialize);
  if (value instanceof Y.Map) {
    return Object.fromEntries(
      Array.from(value.entries()).map(([key, item]) => [key, serialize(item)])
    );
  }
  if (value instanceof Uint8Array) {
    return { base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serialize(item)])
    );
  }
  return value;
}

function jsonObject(value: unknown): JsonObject {
  const serialized = serialize(value);
  return serialized &&
    typeof serialized === 'object' &&
    !Array.isArray(serialized)
    ? (serialized as JsonObject)
    : {};
}

function tableRecord(type: Y.AbstractType<any>): JsonObject {
  return Y.Map.prototype.toJSON.call(type) as JsonObject;
}

function tableField(type: Y.AbstractType<any>, key: string) {
  return Y.Map.prototype.get.call(type, key) as unknown;
}

function findArrayEntry(array: Y.Array<unknown>, key: string, value: string) {
  return array.toArray().findIndex(item => jsonObject(item)[key] === value);
}

function replaceArrayEntry(
  array: Y.Array<unknown>,
  index: number,
  value: JsonObject
) {
  array.delete(index, 1);
  array.insert(index, [value]);
}

function ensureMap(parent: Y.Map<unknown>, key: string) {
  const existing = parent.get(key);
  if (existing instanceof Y.Map) return existing;
  const map = new Y.Map<unknown>();
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    for (const [entryKey, value] of Object.entries(existing)) {
      map.set(entryKey, value);
    }
  }
  parent.set(key, map);
  return map;
}

function ensureArray(parent: Y.Map<unknown>, key: string) {
  const existing = parent.get(key);
  if (existing instanceof Y.Array) return existing as Y.Array<unknown>;
  const array = new Y.Array<unknown>();
  if (Array.isArray(existing)) array.push(existing);
  parent.set(key, array);
  return array;
}

function rootPages(doc: Y.Doc) {
  return ensureArray(doc.getMap('meta'), 'pages');
}

function rootTagOptions(doc: Y.Doc) {
  const properties = ensureMap(doc.getMap('meta'), 'properties');
  const tags = ensureMap(properties, 'tags');
  return ensureArray(tags, 'options');
}

function rootCollections(doc: Y.Doc) {
  return ensureArray(doc.getMap('setting'), 'collections');
}

function validateTableRecord(
  table: WorkspaceDataTable,
  key: string,
  record: JsonObject
) {
  const string = (field: string, nullable = false) => {
    const value = record[field];
    if (value === undefined || (nullable && value === null)) return;
    if (typeof value !== 'string') {
      throw new Error(`${table}.${key}.${field} must be a string.`);
    }
  };

  switch (table) {
    case 'folders':
      string('parentId', true);
      string('data');
      string('index');
      if (
        record.type !== undefined &&
        !['folder', 'doc', 'tag', 'collection'].includes(String(record.type))
      ) {
        throw new Error(`Unsupported folder node type for ${key}.`);
      }
      break;
    case 'document_properties':
      for (const field of [
        'primaryMode',
        'edgelessColorTheme',
        'journal',
        'pageWidth',
        'integrationType',
        'createdBy',
        'updatedBy',
      ]) {
        string(field, true);
      }
      if (
        record.isTemplate !== undefined &&
        typeof record.isTemplate !== 'boolean'
      ) {
        throw new Error(`${table}.${key}.isTemplate must be boolean.`);
      }
      break;
    case 'workspace_properties':
      string('name', true);
      string('type');
      string('show', true);
      string('index', true);
      string('icon', true);
      if (
        record.isDeleted !== undefined &&
        typeof record.isDeleted !== 'boolean'
      ) {
        throw new Error(`${table}.${key}.isDeleted must be boolean.`);
      }
      break;
    case 'pinned_collections':
      string('index');
      break;
    case 'explorer_icons':
      if (!/^(doc|collection|folder|tag):[^:]+$/.test(key)) {
        throw new Error(`Invalid explorer icon key ${key}.`);
      }
      if (
        record.icon !== undefined &&
        (!record.icon ||
          typeof record.icon !== 'object' ||
          Array.isArray(record.icon))
      ) {
        throw new Error(`${table}.${key}.icon must be an object.`);
      }
      break;
    case 'favorites':
      if (!/^(collection|doc|tag|folder):[^:]+$/.test(key)) {
        throw new Error(`Invalid favorite key ${key}.`);
      }
      string('index');
      break;
    case 'user_settings':
      break;
  }
}

function validateFolderGraph(doc: Y.Doc) {
  const records = new Map<string, JsonObject>();
  for (const [id, type] of doc.share.entries()) {
    if (tableField(type, '$$DELETED') === true) continue;
    const record = tableRecord(type);
    if (record.id === id) records.set(id, record);
  }
  for (const [id, record] of records) {
    if (!record.data || !record.type || !record.index) {
      throw new Error(`Folder node ${id} is missing required fields.`);
    }
    const parentId = record.parentId;
    if (parentId === null || parentId === undefined) {
      if (record.type !== 'folder') {
        throw new Error('Only folders can be root organization nodes.');
      }
      continue;
    }
    const parent = records.get(String(parentId));
    if (!parent || parent.type !== 'folder') {
      throw new Error(`Parent folder ${String(parentId)} was not found.`);
    }
    const visited = new Set([id]);
    let current: JsonObject | undefined = parent;
    while (current?.parentId) {
      const currentId = String(current.parentId);
      if (visited.has(currentId))
        throw new Error('Folder cycles are not allowed.');
      visited.add(currentId);
      current = records.get(currentId);
    }
  }
}

@Injectable()
export class WorkspaceOrganizationService {
  constructor(
    private readonly reader: DocReader,
    private readonly writer: DocWriter
  ) {}

  private async load(
    workspaceId: string,
    docId: string,
    createIfMissing = false
  ): Promise<LoadedDoc> {
    const record = await this.reader.getDoc(workspaceId, docId);
    if (!record?.bin && !createIfMissing) {
      throw new NotFoundException(`Document ${docId} not found`);
    }
    const doc = new Y.Doc({ guid: docId });
    if (record?.bin) Y.applyUpdate(doc, record.bin);
    return { doc, stateVector: Y.encodeStateVector(doc) };
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

  private async readTable(
    workspaceId: string,
    userId: string,
    table: WorkspaceDataTable
  ) {
    const descriptor = TABLES[table];
    const docId = resolveWorkspaceDataDocId(table, workspaceId, userId);
    const loaded = await this.load(workspaceId, docId, true);
    try {
      const records: JsonObject[] = [];
      for (const type of loaded.doc.share.values()) {
        if (tableField(type, '$$DELETED') === true) continue;
        const record = tableRecord(type);
        if (typeof record[descriptor.keyField] === 'string')
          records.push(record);
      }
      return records;
    } finally {
      loaded.doc.destroy();
    }
  }

  async readOrganization(workspaceId: string, userId: string) {
    const root = await this.load(workspaceId, workspaceId);
    try {
      const [
        folders,
        documentProperties,
        workspaceProperties,
        pinnedCollections,
        explorerIcons,
        favorites,
        userSettings,
      ] = await Promise.all([
        this.readTable(workspaceId, userId, 'folders'),
        this.readTable(workspaceId, userId, 'document_properties'),
        this.readTable(workspaceId, userId, 'workspace_properties'),
        this.readTable(workspaceId, userId, 'pinned_collections'),
        this.readTable(workspaceId, userId, 'explorer_icons'),
        this.readTable(workspaceId, userId, 'favorites'),
        this.readTable(workspaceId, userId, 'user_settings'),
      ]);
      const meta = root.doc.getMap('meta');
      return {
        workspace: {
          id: workspaceId,
          name: meta.get('name') ?? null,
          avatar: meta.get('avatar') ?? null,
        },
        documents: serialize(rootPages(root.doc)),
        tags: serialize(rootTagOptions(root.doc)),
        collections: serialize(rootCollections(root.doc)),
        folders,
        documentProperties,
        workspaceProperties,
        pinnedCollections,
        explorerIcons,
        favorites,
        userSettings,
      };
    } finally {
      root.doc.destroy();
    }
  }

  async applyRootOperations(
    workspaceId: string,
    editorId: string,
    operations: WorkspaceRootOperation[]
  ) {
    assertOperations(operations);
    const loaded = await this.load(workspaceId, workspaceId);
    const createdTagIds: string[] = [];
    const createdCollectionIds: string[] = [];
    try {
      loaded.doc.transact(() => {
        for (const operation of operations) {
          const pages = rootPages(loaded.doc);
          const tags = rootTagOptions(loaded.doc);
          const collections = rootCollections(loaded.doc);
          switch (operation.op) {
            case 'set_workspace_profile': {
              const meta = loaded.doc.getMap('meta');
              if (operation.name !== undefined)
                meta.set('name', operation.name);
              if (operation.avatar === null) meta.delete('avatar');
              else if (operation.avatar !== undefined) {
                meta.set('avatar', operation.avatar);
              }
              break;
            }
            case 'set_document_trashed': {
              const index = findArrayEntry(pages, 'id', operation.docId);
              if (index < 0)
                throw new Error(`Document ${operation.docId} was not found.`);
              const page = pages.get(index);
              if (!(page instanceof Y.Map)) {
                const next = jsonObject(page);
                if (operation.trashed) next.trash = true;
                else delete next.trash;
                replaceArrayEntry(pages, index, next);
              } else if (operation.trashed) page.set('trash', true);
              else page.delete('trash');
              break;
            }
            case 'create_tag': {
              const id = operation.id ?? nanoid();
              if (findArrayEntry(tags, 'id', id) >= 0) {
                throw new Error(`Tag ${id} already exists.`);
              }
              tags.push([
                {
                  id,
                  value: operation.value,
                  color: operation.color,
                  createDate: Date.now(),
                  updateDate: Date.now(),
                  ...(operation.parentId
                    ? { parentId: operation.parentId }
                    : {}),
                },
              ]);
              createdTagIds.push(id);
              break;
            }
            case 'update_tag': {
              const index = findArrayEntry(tags, 'id', operation.tagId);
              if (index < 0)
                throw new Error(`Tag ${operation.tagId} was not found.`);
              const next = jsonObject(tags.get(index));
              if (operation.value !== undefined) next.value = operation.value;
              if (operation.color !== undefined) next.color = operation.color;
              if (operation.parentId === null) delete next.parentId;
              else if (operation.parentId !== undefined)
                next.parentId = operation.parentId;
              next.updateDate = Date.now();
              replaceArrayEntry(tags, index, next);
              break;
            }
            case 'delete_tag': {
              const index = findArrayEntry(tags, 'id', operation.tagId);
              if (index < 0)
                throw new Error(`Tag ${operation.tagId} was not found.`);
              tags.delete(index, 1);
              pages.forEach(page => {
                if (!(page instanceof Y.Map)) return;
                const pageTags = page.get('tags');
                if (!(pageTags instanceof Y.Array)) return;
                const next = pageTags
                  .toArray()
                  .filter(tagId => tagId !== operation.tagId);
                pageTags.delete(0, pageTags.length);
                pageTags.push(next);
              });
              break;
            }
            case 'set_document_tags': {
              for (const tagId of operation.tagIds) {
                if (findArrayEntry(tags, 'id', tagId) < 0) {
                  throw new Error(`Tag ${tagId} was not found.`);
                }
              }
              const index = findArrayEntry(pages, 'id', operation.docId);
              if (index < 0)
                throw new Error(`Document ${operation.docId} was not found.`);
              const page = pages.get(index);
              if (page instanceof Y.Map) {
                let pageTags = page.get('tags');
                if (!(pageTags instanceof Y.Array)) {
                  pageTags = new Y.Array<string>();
                  page.set('tags', pageTags);
                }
                pageTags.delete(0, pageTags.length);
                pageTags.push(operation.tagIds);
              } else {
                replaceArrayEntry(pages, index, {
                  ...jsonObject(page),
                  tags: [...operation.tagIds],
                });
              }
              break;
            }
            case 'create_collection': {
              const id = operation.id ?? nanoid();
              if (findArrayEntry(collections, 'id', id) >= 0) {
                throw new Error(`Collection ${id} already exists.`);
              }
              collections.push([
                {
                  id,
                  name: operation.name,
                  rules: operation.rules ?? { filters: [] },
                  allowList: operation.allowList ?? [],
                },
              ]);
              createdCollectionIds.push(id);
              break;
            }
            case 'update_collection': {
              const index = findArrayEntry(
                collections,
                'id',
                operation.collectionId
              );
              if (index < 0) {
                throw new Error(
                  `Collection ${operation.collectionId} was not found.`
                );
              }
              const next = jsonObject(collections.get(index));
              if (operation.name !== undefined) next.name = operation.name;
              if (operation.rules !== undefined) next.rules = operation.rules;
              if (operation.allowList !== undefined)
                next.allowList = operation.allowList;
              replaceArrayEntry(collections, index, next);
              break;
            }
            case 'delete_collection': {
              const index = findArrayEntry(
                collections,
                'id',
                operation.collectionId
              );
              if (index < 0) {
                throw new Error(
                  `Collection ${operation.collectionId} was not found.`
                );
              }
              collections.delete(index, 1);
              break;
            }
          }
        }
      });
      const saved = await this.save(workspaceId, workspaceId, editorId, loaded);
      return { workspaceId, createdTagIds, createdCollectionIds, ...saved };
    } finally {
      loaded.doc.destroy();
    }
  }

  async applyDataOperations(
    workspaceId: string,
    userId: string,
    editorId: string,
    table: WorkspaceDataTable,
    operations: WorkspaceDataOperation[]
  ) {
    assertOperations(operations);
    const descriptor = TABLES[table];
    const docId = resolveWorkspaceDataDocId(table, workspaceId, userId);
    const loaded = await this.load(workspaceId, docId, true);
    try {
      loaded.doc.transact(() => {
        for (const operation of operations) {
          const existed = loaded.doc.share.has(operation.key);
          const record = loaded.doc.getMap<unknown>(operation.key);
          if (operation.op === 'delete') {
            if (!existed || record.get('$$DELETED') === true) {
              throw new Error(
                `${table} record ${operation.key} was not found.`
              );
            }
            for (const key of Array.from(record.keys())) {
              if (key !== descriptor.keyField) record.delete(key);
            }
            record.set(descriptor.keyField, operation.key);
            record.set('$$DELETED', true);
            continue;
          }
          if (
            Object.prototype.hasOwnProperty.call(
              operation.values,
              descriptor.keyField
            )
          ) {
            throw new Error(
              `${descriptor.keyField} is controlled by the operation key.`
            );
          }
          validateTableRecord(table, operation.key, operation.values);
          record.set(descriptor.keyField, operation.key);
          for (const [key, value] of Object.entries(operation.values)) {
            record.set(key, value);
          }
          record.delete('$$DELETED');
        }
      });
      if (table === 'folders') validateFolderGraph(loaded.doc);
      const saved = await this.save(workspaceId, docId, editorId, loaded);
      return { workspaceId, table, storageDocId: docId, ...saved };
    } finally {
      loaded.doc.destroy();
    }
  }
}
