import { isDeepStrictEqual } from 'node:util';

import { nanoid } from 'nanoid';
import * as Y from 'yjs';

import { createDocWithMarkdown, updateDocWithMarkdown } from '../../native';
import { parseDocToMarkdownFromDocSnapshot } from '../utils/blocksuite';
import { RESOURCE_CONTENT_LIMIT, ResourceError } from './resource-types';

const FLAVOURS = new Set([
  'affine:page',
  'affine:surface',
  'affine:note',
  'affine:paragraph',
  'affine:list',
  'affine:code',
  'affine:divider',
]);

const METADATA_FLAVOURS = new Set([
  'affine:paragraph',
  'affine:list',
  'affine:code',
]);
const BLOCK_METADATA = [
  'prop:meta:createdAt',
  'prop:meta:createdBy',
  'prop:meta:updatedAt',
  'prop:meta:updatedBy',
];
// BlockSuite NoteBlockSchema defaults; do not accept custom styles here.
const DEFAULT_NOTE_EDGELESS = {
  style: {
    borderRadius: 8,
    borderSize: 4,
    borderStyle: 'none',
    shadowType: '--affine-note-shadow-box',
  },
};

function equivalentEditorProperty(
  block: Y.Map<unknown>,
  key: string,
  value: unknown
) {
  const flavour = block.get('sys:flavour');
  if (METADATA_FLAVOURS.has(String(flavour)) && BLOCK_METADATA.includes(key)) {
    return key.endsWith('At')
      ? typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      : typeof value === 'string' && value.length > 0;
  }
  if (
    (flavour === 'affine:paragraph' || flavour === 'affine:list') &&
    key === 'prop:collapsed' &&
    value === false
  )
    return true;
  if (flavour === 'affine:list') {
    if (key === 'prop:order' && value === null) return true;
    if (
      key === 'prop:checked' &&
      value === false &&
      ['bulleted', 'numbered'].includes(String(block.get('prop:type')))
    )
      return true;
  }
  if (flavour === 'affine:note') {
    if (key === 'prop:lockedBySelf' && value === false) return true;
    if (key === 'prop:edgeless')
      return isDeepStrictEqual(
        value instanceof Y.AbstractType ? value.toJSON() : value,
        DEFAULT_NOTE_EDGELESS
      );
  }
  return false;
}

// Compare content structure, inline marks and semantic properties, not CRDT IDs.
// Only explicit editor defaults and separately maintained metadata are excluded.
// Other properties that cannot survive the Markdown round trip fail closed.
function semanticBlocks(bin: Uint8Array) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bin);
    if (doc.store.pendingStructs || doc.store.pendingDs)
      throw new ResourceError('unsupported_document_structure');
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const pages = [...blocks.values()].filter(
      block => block.get('sys:flavour') === 'affine:page'
    );
    if (pages.length !== 1)
      throw new ResourceError('unsupported_document_kind');
    const seen = new Set<string>();
    const walk = (block: Y.Map<unknown>): unknown => {
      const id = String(block.get('sys:id'));
      if (seen.has(id) || seen.size > 10000)
        throw new ResourceError('unsupported_document_structure');
      seen.add(id);
      const flavour = String(block.get('sys:flavour'));
      if (!FLAVOURS.has(flavour))
        throw new ResourceError('unsupported_document_structure');
      const fields: Record<string, unknown> = { flavour };
      for (const [key, value] of [...block.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        if (
          ['sys:id', 'sys:children', 'sys:version'].includes(key) ||
          (flavour === 'affine:page' && key === 'prop:title') ||
          equivalentEditorProperty(block, key, value)
        )
          continue;
        // Note geometry and surface bookkeeping are not Markdown body state.
        if (
          flavour === 'affine:note' &&
          [
            'prop:xywh',
            'prop:background',
            'prop:index',
            'prop:displayMode',
          ].includes(key)
        ) {
          if (
            key === 'prop:displayMode' &&
            value !== 'both' &&
            value !== 'doc' &&
            value !== undefined
          )
            throw new ResourceError('unsupported_document_kind');
          continue;
        }
        if (flavour === 'affine:surface') {
          if (key === 'prop:elements') {
            const elements =
              value instanceof Y.AbstractType ? value.toJSON() : value;
            if (
              JSON.stringify(elements) === '{}' ||
              (elements &&
                typeof elements === 'object' &&
                Object.keys(elements).length === 2 &&
                elements.type === '$blocksuite:internal:native$' &&
                JSON.stringify(elements.value) === '{}')
            )
              continue;
          }
          if (key === 'sys:flavour') continue;
          throw new ResourceError('unsupported_document_structure');
        }
        fields[key] =
          value instanceof Y.Text
            ? value.toDelta()
            : value instanceof Y.AbstractType
              ? value.toJSON()
              : value;
      }
      const children = block.get('sys:children');
      fields.children =
        children instanceof Y.Array
          ? children.toArray().map(child => {
              const value = blocks.get(String(child));
              if (!(value instanceof Y.Map))
                throw new ResourceError('unsupported_document_structure');
              return walk(value);
            })
          : [];
      return fields;
    };
    const content = walk(pages[0]);
    if (seen.size !== blocks.size)
      throw new ResourceError('unsupported_document_structure');
    return JSON.stringify(content);
  } finally {
    doc.destroy();
  }
}

function blockValue(value: unknown): unknown {
  return value instanceof Y.Text
    ? value.toDelta()
    : value instanceof Y.AbstractType
      ? value.toJSON()
      : value;
}

function blockSignature(block: Y.Map<unknown>, includeChildren = true) {
  return JSON.stringify(
    [...block.entries()]
      .filter(
        ([key, value]) =>
          !['sys:id', 'sys:version'].includes(key) &&
          (includeChildren || key !== 'sys:children') &&
          !equivalentEditorProperty(block, key, value)
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, blockValue(value)])
  );
}

function cloneBlockValue(value: unknown) {
  if (
    value instanceof Y.Text ||
    value instanceof Y.Array ||
    value instanceof Y.Map
  )
    return value.clone();
  if (value instanceof Y.AbstractType)
    throw new ResourceError('unsupported_document_structure');
  return value;
}

// Native matching compares parser text runs, whereas Y.Text coalesces adjacent
// runs. Keep exact semantic matches within each sibling list before accepting
// native matches for edited blocks; otherwise an insertion can reuse an
// unchanged block's ID for unrelated text. Apply only actual property changes
// to the original document, preserving unchanged Y.Text objects as well as IDs.
function reconcileResourceBlocks(doc: Y.Doc, targetDoc: Y.Doc) {
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const targetBlocks = targetDoc.getMap<Y.Map<unknown>>('blocks');
  const signatures = new Map(
    [...blocks].map(([id, block]) => [id, blockSignature(block, false)])
  );
  const children = (block: Y.Map<unknown>) => {
    const value = block.get('sys:children');
    return value instanceof Y.Array ? value.toArray().map(String) : [];
  };
  const edits: Array<{
    id: string;
    target: Y.Map<unknown>;
    children: string[];
  }> = [];
  const retained = new Set<string>();
  const align = (oldIds: string[], targetIds: string[]): string[] => {
    const available = new Set(oldIds);
    const targets = targetIds.map(id => {
      const block = targetBlocks.get(id);
      if (!(block instanceof Y.Map))
        throw new ResourceError('unsupported_document_structure');
      return block;
    });
    const matches = targets.map(target => {
      const signature = blockSignature(target, false);
      const nativeId = String(target.get('sys:id'));
      const exact = (id: string) =>
        available.has(id) && signatures.get(id) === signature;
      const id = exact(nativeId) ? nativeId : oldIds.find(exact);
      if (id) available.delete(id);
      return id;
    });
    return targets.map((target, index) => {
      const nativeId = String(target.get('sys:id'));
      const id =
        matches[index] ?? (available.has(nativeId) ? nativeId : nanoid());
      available.delete(id);
      retained.add(id);
      const previous = blocks.get(id);
      const childIds = align(
        previous ? children(previous) : [],
        children(target)
      );
      edits.push({ id, target, children: childIds });
      return id;
    });
  };
  const pageIds = (map: Y.Map<Y.Map<unknown>>) =>
    [...map]
      .filter(([, block]) => block.get('sys:flavour') === 'affine:page')
      .map(([id]) => id);
  align(pageIds(blocks), pageIds(targetBlocks));
  for (const edit of edits) {
    let block = blocks.get(edit.id);
    if (!block) {
      block = new Y.Map();
      blocks.set(edit.id, block);
      block.set('sys:id', edit.id);
      block.set('sys:children', new Y.Array<string>());
    }
    if (blockSignature(block, false) !== blockSignature(edit.target, false)) {
      const skip = (key: string) =>
        ['sys:id', 'sys:children', ...BLOCK_METADATA].includes(key);
      for (const key of block.keys()) {
        if (!skip(key) && !edit.target.has(key)) block.delete(key);
      }
      for (const [key, value] of edit.target) {
        if (
          !skip(key) &&
          !isDeepStrictEqual(blockValue(block.get(key)), blockValue(value))
        )
          block.set(key, cloneBlockValue(value));
      }
    }
    if (!isDeepStrictEqual(children(block), edit.children)) {
      let ids = block.get('sys:children');
      if (!(ids instanceof Y.Array)) {
        ids = new Y.Array<string>();
        block.set('sys:children', ids);
      }
      const array = ids as Y.Array<string>;
      array.delete(0, array.length);
      array.insert(0, edit.children);
    }
  }
  for (const id of blocks.keys()) {
    if (!retained.has(id)) blocks.delete(id);
  }
}

/** Apply the native structural edit and maintain BlockSuite block provenance. */
export function updateResourceMarkdown(
  bin: Buffer,
  markdown: string,
  documentId: string,
  editorId: string,
  now = Date.now()
) {
  const doc = new Y.Doc();
  const target = new Y.Doc();
  try {
    Y.applyUpdate(doc, bin);
    const vector = Y.encodeStateVector(doc);
    const blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const before = new Map(
      [...blocks].map(([id, block]) => [
        id,
        {
          signature: blockSignature(block),
          metadata: new Map(
            BLOCK_METADATA.filter(key => block.has(key)).map(key => [
              key,
              block.get(key),
            ])
          ),
        },
      ])
    );
    Y.applyUpdate(target, bin);
    Y.applyUpdate(target, updateDocWithMarkdown(bin, markdown, documentId));
    reconcileResourceBlocks(doc, target);
    for (const [id, block] of blocks) {
      if (!METADATA_FLAVOURS.has(String(block.get('sys:flavour')))) continue;
      const previous = before.get(id);
      // Do not rewrite existing creation history, including legacy missing data.
      for (const key of BLOCK_METADATA) {
        if (previous?.metadata.has(key)) {
          const value = previous.metadata.get(key);
          if (block.get(key) !== value) block.set(key, value);
        }
      }
      if (!previous) {
        block.set('prop:meta:createdAt', now);
        block.set('prop:meta:createdBy', editorId);
      }
      if (!previous || previous.signature !== blockSignature(block)) {
        block.set('prop:meta:updatedAt', now);
        block.set('prop:meta:updatedBy', editorId);
      }
    }
    return Y.encodeStateAsUpdate(doc, vector);
  } finally {
    doc.destroy();
    target.destroy();
  }
}

export function readResourceMarkdown(
  workspaceId: string,
  documentId: string,
  bin: Uint8Array
) {
  let parsed;
  try {
    parsed = parseDocToMarkdownFromDocSnapshot(
      workspaceId,
      documentId,
      bin,
      false
    );
  } catch {
    throw new ResourceError('unsupported_document_kind');
  }
  if (parsed.unknownBlocks.length)
    throw new ResourceError('unsupported_document_structure');
  if (Buffer.byteLength(parsed.markdown, 'utf8') > RESOURCE_CONTENT_LIMIT)
    throw new ResourceError('content_too_large');
  let writable = false;
  try {
    const recreated = createDocWithMarkdown(
      parsed.title,
      parsed.markdown,
      documentId
    );
    writable =
      !parsed.knownUnsupportedBlocks.some(
        block => !/:affine:(surface|note)$/.test(block)
      ) &&
      !parsed.unknownBlocks.length &&
      semanticBlocks(bin) === semanticBlocks(recreated);
  } catch {
    /* Readable unsupported structures remain read-only. */
  }
  return {
    title: parsed.title,
    content: { format: 'markdown' as const, text: parsed.markdown },
    contentWritable: writable,
    ...(writable
      ? {}
      : { contentWriteReason: 'unsupported_document_structure' as const }),
  };
}

export function validateResourceMarkdown(
  title: string,
  text: string,
  documentId: string
) {
  if (Buffer.byteLength(text, 'utf8') > RESOURCE_CONTENT_LIMIT)
    throw new ResourceError('content_too_large');
  const bin = createDocWithMarkdown(title, text, documentId);
  const result = readResourceMarkdown('', documentId, bin);
  if (!result.contentWritable)
    throw new ResourceError('unsupported_document_structure');
  // Native parsers must not silently drop images, HTML or embedded resources.
  if (/!\[|<\/?[a-zA-Z][^>]*>|^\s*\|.*\|/m.test(text))
    throw new ResourceError('unsupported_document_structure');
  return result;
}
