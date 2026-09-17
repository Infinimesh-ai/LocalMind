import * as Y from 'yjs';

import { createDocWithMarkdown } from '../../native';
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

// Compare content structure, inline marks and semantic properties, not CRDT IDs.
// Any property that cannot survive the native Markdown round trip fails closed.
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
          (flavour === 'affine:page' && key === 'prop:title')
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
