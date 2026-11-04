import { createHash } from 'node:crypto';

import { DocumentEditError } from './document-edit-error';
export { DocumentEditError } from './document-edit-error';
import { isDeepStrictEqual } from 'node:util';

import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import type { z } from 'zod';

import {
  documentBlockDefaults,
  documentBlockParents,
  documentMetadataFlavours,
} from './document-block-defaults';
import { documentPropertyCapability } from './document-capabilities';
import {
  applyDatabaseCommand,
  assertDatabaseRow,
  databaseCell,
  databaseParts,
  type NativeEditContext,
} from './document-database';
import {
  type DocumentDependencies,
  nativeDependencies,
} from './document-dependencies';
import { compileDocumentMarkdown } from './document-markdown';
import { captureDocumentPreservation } from './document-preservation';
import {
  DOCUMENT_CONTRACT_VERSION,
  type DocumentBlockFlavour,
  documentBlockProperties,
  documentBlockVersions,
  documentMarks,
  documentNativeBatch,
  type documentTextTarget,
} from './document-schema';
import {
  applySurfaceCommand,
  detachDeletedGraphics,
  surfaceElements,
} from './document-surface';
import { reconcileNativeArray } from './native-array';
import {
  isTextBoundary,
  type NativeTextRun,
  normalizeNativeRuns,
  reconcileNativeText,
  reconcileNativeTextRange,
} from './native-text';
import { ResourceError } from './resource-types';

type Block = Y.Map<unknown>;
type TextTarget = z.infer<typeof documentTextTarget>;
type TextMapping = {
  opId: string;
  source: { blockId: string; offset: number; length: number };
  target: { blockId: string; offset: number };
};

function invalid(reason: string, objectId?: string): never {
  throw new DocumentEditError('invalid_input', { reason, objectId });
}
export function loadNativeDocument(bin: Uint8Array) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, bin);
    if (doc.store.pendingStructs || doc.store.pendingDs)
      invalid('incomplete_document_update');
    return doc;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}

export function nativeValue(value: unknown): unknown {
  if (value instanceof Y.Text) return { delta: value.toDelta() };
  if (value instanceof Y.Map)
    return Object.fromEntries(
      [...value].map(([key, value]) => [key, nativeValue(value)])
    );
  if (value instanceof Y.Array) return value.toArray().map(nativeValue);
  if (value instanceof Uint8Array)
    return { base64: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(nativeValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [key, nativeValue(value)])
    );
  return value;
}

/** Update leaves, never replace an existing Yjs container to change one field. */
function setValue(map: Block, key: string, value: unknown) {
  const previous = map.get(key);
  if (isDeepStrictEqual(nativeValue(previous), value)) return;
  if (Array.isArray(value)) {
    let array = previous instanceof Y.Array ? previous : undefined;
    if (!array) {
      array = new Y.Array<unknown>();
      map.set(key, array);
    }
    const identity = (value: unknown) => {
      const plain = nativeValue(value);
      return plain && typeof plain === 'object' && 'id' in plain
        ? `id:${String(plain.id)}`
        : `value:${JSON.stringify(plain)}`;
    };
    reconcileNativeArray(
      array,
      value,
      identity,
      (child, existing) => {
        if (existing instanceof Y.Map) return existing.clone();
        if (child && typeof child === 'object' && !Array.isArray(child))
          return new Y.Map();
        return child;
      },
      (existing, child) => {
        if (existing instanceof Y.Map && child && typeof child === 'object')
          for (const [childKey, field] of Object.entries(child))
            setValue(existing, childKey, field);
      }
    );
  } else if (value && typeof value === 'object') {
    // Ordinary (non-flat) BlockSuite props are nested Y.Maps.
    if (previous instanceof Y.Map) {
      for (const [childKey, child] of Object.entries(value))
        setValue(previous, childKey, child);
    } else {
      const nested = new Y.Map<unknown>();
      map.set(key, nested);
      for (const [childKey, child] of Object.entries(value))
        setValue(nested, childKey, child);
    }
  } else map.set(key, value);
}
function children(block: Block) {
  const value = block.get('sys:children');
  if (!(value instanceof Y.Array))
    invalid('invalid_children', String(block.get('sys:id')));
  return value as Y.Array<string>;
}
function supported(block: Block): DocumentBlockFlavour {
  const flavour = String(block.get('sys:flavour')) as DocumentBlockFlavour;
  if (
    !Object.hasOwn(documentBlockVersions, flavour) ||
    block.get('sys:version') !== documentBlockVersions[flavour]
  )
    throw new DocumentEditError('unsupported_document_structure', {
      objectId: String(block.get('sys:id')),
      reason: 'unsupported_schema_version',
    });
  return flavour;
}

export function inspectNativeDocument(bin: Uint8Array) {
  const doc = loadNativeDocument(bin);
  try {
    return [...doc.getMap<Block>('blocks')].map(([id, block]) => {
      const flavour = String(block.get('sys:flavour'));
      const version = block.get('sys:version');
      const known =
        Object.hasOwn(documentBlockVersions, flavour) &&
        documentBlockVersions[flavour as DocumentBlockFlavour] === version;
      return {
        id,
        flavour,
        version,
        children: children(block).toArray(),
        properties: Object.fromEntries(
          [...block]
            .filter(([key]) => key.startsWith('prop:'))
            .map(([key, value]) => [key.slice(5), nativeValue(value)])
        ),
        supported: known,
        capabilities: {
          properties: Object.fromEntries(
            [...block.keys()]
              .filter(key => key.startsWith('prop:'))
              .map(key => [
                key.slice(5),
                known
                  ? documentPropertyCapability(flavour, key.slice(5))
                  : { kind: 'opaque' as const },
              ])
          ),
          unknownFields: 'preserve-without-writes' as const,
        },
        preservation: 'native' as const,
      };
    });
  } finally {
    doc.destroy();
  }
}

const textFlavours = new Set([
  'affine:paragraph',
  'affine:list',
  'affine:code',
  'affine:callout',
]);
const editableMarks = new Set(Object.keys(documentMarks.shape));

export function editNativeDocument(input: {
  bin: Uint8Array;
  commands: unknown;
  actorId: string;
  operationId: string;
  now: number;
  dependencies?: DocumentDependencies;
  initialReferences?: Record<string, string>;
}) {
  const parsed = documentNativeBatch.safeParse(input.commands);
  if (!parsed.success)
    throw new DocumentEditError('invalid_input', {
      reason: 'invalid_command_schema',
      field: parsed.error.issues[0]?.path.join('.'),
    });
  if (Buffer.byteLength(JSON.stringify(parsed.data)) > 4 * 1024 * 1024)
    throw new ResourceError('content_too_large');
  const commands = parsed.data;
  const dependencies = nativeDependencies(commands);
  for (const id of dependencies.assets)
    if (!input.dependencies?.assets[id]) invalid('asset_not_authorized', id);
  for (const key of dependencies.resources.keys())
    if (!input.dependencies?.resources.has(key))
      invalid('reference_not_authorized', key);
  const doc = loadNativeDocument(input.bin);
  const scratch = new Y.Doc();
  let scratchId = 0;
  try {
    const vector = Y.encodeStateVector(doc);
    const blocks = doc.getMap<Block>('blocks');
    const verifyPreservation = captureDocumentPreservation(doc);
    const before = new Map(
      [...blocks].map(([id, block]) => [id, nativeValue(block)])
    );
    const refs = new Map<string, string>(
      Object.entries(input.initialReferences ?? {})
    );
    const resolve = (id: string) =>
      id.startsWith('$')
        ? (refs.get(id.slice(1)) ?? invalid('unresolved_client_reference', id))
        : id;
    const blockById = (id: string) => {
      const resolved = resolve(id);
      const block = blocks.get(resolved);
      if (!(block instanceof Y.Map)) invalid('block_not_found', resolved);
      return block;
    };
    const allocate = (ref: string) => {
      if (refs.has(ref) || ref.startsWith('$'))
        invalid('duplicate_client_reference', ref);
      const id = createHash('sha256')
        .update(
          JSON.stringify([DOCUMENT_CONTRACT_VERSION, input.operationId, ref])
        )
        .digest('base64url')
        .slice(0, 21);
      if (blocks.has(id)) invalid('identity_collision');
      refs.set(ref, id);
      return id;
    };
    const textMappings: TextMapping[] = [];
    const context: NativeEditContext = {
      blocks,
      queryRows: input.dependencies?.queryRows,
      assets: input.dependencies?.assets,
      members: input.dependencies?.members,
      blockById,
      resolve,
      allocate,
      setValue,
      invalid,
    };
    const parentOf = (id: string) => {
      const matches = [...blocks.values()].filter(block =>
        children(block).toArray().includes(id)
      );
      if (matches.length !== 1) invalid('ambiguous_parent', id);
      return matches[0];
    };
    const descendants = (id: string, seen = new Set<string>()): Set<string> => {
      if (seen.has(id)) invalid('cyclic_document', id);
      seen.add(id);
      for (const child of children(blockById(id))) descendants(child, seen);
      return seen;
    };
    const assertPlacement = (block: Block, parent: Block) => {
      const flavour = supported(block);
      const allowed = documentBlockParents[flavour];
      if (!allowed || !allowed.includes(supported(parent)))
        invalid('invalid_parent', String(parent.get('sys:id')));
    };
    const table = (id: string) => {
      const block = blockById(id);
      if (supported(block) !== 'affine:table') invalid('expected_table', id);
      return block;
    };
    const axes = (block: Block, axis: 'row' | 'column') =>
      [...block]
        .filter(
          ([key]) =>
            key.startsWith(`prop:${axis}s.`) && key.endsWith(`.${axis}Id`)
        )
        .map(([, value]) => String(value))
        .sort((a, b) => {
          const left = String(block.get(`prop:${axis}s.${a}.order`));
          const right = String(block.get(`prop:${axis}s.${b}.order`));
          return left < right ? -1 : left > right ? 1 : a < b ? -1 : 1;
        });
    const requireAxis = (block: Block, axis: 'row' | 'column', id: string) => {
      if (!axes(block, axis).includes(id)) invalid('table_axis_not_found', id);
    };
    const textAt = (target: TextTarget) => {
      let container: Block;
      let key: string;
      let createContainer: (() => Block) | undefined;
      if (target.kind === 'element_text') {
        const elements = surfaceElements(context, target.surfaceId);
        const element = elements.get(resolve(target.elementId));
        if (!(element instanceof Y.Map))
          invalid('element_not_found', target.elementId);
        if (
          !(target.field === 'title'
            ? element.get('type') === 'group'
            : ['shape', 'text', 'connector'].includes(
                String(element.get('type'))
              ))
        )
          invalid('unsupported_element_text_field');
        container = element;
        key = target.field;
      } else if (target.kind === 'database_cell') {
        const db = databaseParts(context, target.blockId);
        const column = db.columns
          .toArray()
          .find(column => column.get('id') === resolve(target.columnId));
        if (!column) invalid('database_column_not_found', target.columnId);
        if (column.get('type') === 'title') {
          if (!db.rows.toArray().includes(resolve(target.rowId)))
            invalid('database_row_not_found', target.rowId);
          container = blockById(target.rowId);
          key = 'prop:text';
        } else {
          if (column.get('type') !== 'rich-text')
            invalid('expected_rich_text_cell');
          const rowId = resolve(target.rowId),
            columnId = resolve(target.columnId);
          assertDatabaseRow(context, db, rowId, target.rowDocumentId);
          const rowCells = db.cells.get(rowId);
          if (rowCells !== undefined && !(rowCells instanceof Y.Map))
            invalid('invalid_database_row', rowId);
          const cell = db.query ? rowCells : rowCells?.get(columnId);
          if (cell !== undefined && !(cell instanceof Y.Map))
            invalid('invalid_database_cell', columnId);
          container =
            cell instanceof Y.Map
              ? cell
              : scratch.getMap(`cell:${scratchId++}`);
          if (!cell)
            createContainer = () =>
              databaseCell(
                context,
                target.blockId,
                rowId,
                columnId,
                target.rowDocumentId
              ).cell;
          key = db.query ? columnId : 'value';
        }
      } else if (target.kind === 'table_cell') {
        container = table(target.blockId);
        const row = resolve(target.rowId),
          column = resolve(target.columnId);
        requireAxis(container, 'row', row);
        requireAxis(container, 'column', column);
        key = `prop:cells.${row}:${column}.text`;
      } else {
        container = blockById(target.blockId);
        const flavour = supported(container);
        if (
          !(target.field === 'text'
            ? textFlavours.has(flavour)
            : ['affine:database', 'affine:frame'].includes(flavour))
        )
          invalid('unsupported_text_field', target.blockId);
        key = `prop:${target.field}`;
      }
      const value = container.get(key);
      if (value instanceof Y.Text)
        return { text: value, writable: () => value };
      // Read missing/legacy cells without materializing them on a no-op.
      if (
        !['table_cell', 'database_cell', 'element_text'].includes(
          target.kind
        ) ||
        (value !== undefined && typeof value !== 'string')
      )
        invalid('invalid_text_storage');
      const temporary = scratch.getText(`text:${scratchId++}`);
      if (typeof value === 'string') temporary.insert(0, value);
      return {
        text: temporary,
        writable: () => {
          const rich = new Y.Text(typeof value === 'string' ? value : '');
          (createContainer?.() ?? container).set(key, rich);
          return rich;
        },
      };
    };
    const bounds = (text: Y.Text, offset: number, length: number) => {
      const value = text.toString();
      if (
        !isTextBoundary(value, offset) ||
        !isTextBoundary(value, offset + length)
      )
        invalid('invalid_grapheme_boundary');
    };
    doc.transact(() => {
      const queue = [...commands];
      for (let commandIndex = 0; commandIndex < queue.length; commandIndex++) {
        const command = queue[commandIndex];
        if (command.type === 'markdown.rewrite') {
          let compiled;
          try {
            compiled = compileDocumentMarkdown(context, command);
          } catch (error) {
            if (error instanceof DocumentEditError)
              error.detail.opId ??= command.opId;
            throw error;
          }
          queue.splice(commandIndex, 1, ...compiled);
          if (queue.length > 10000)
            throw new ResourceError('content_too_large');
          commandIndex--;
          continue;
        }
        try {
          switch (command.type) {
            case 'block.split': {
              const source = blockById(command.blockId),
                flavour = supported(source);
              if (!textFlavours.has(flavour)) invalid('expected_text_block');
              const text = source.get('prop:text');
              if (!(text instanceof Y.Text)) invalid('invalid_text_storage');
              bounds(text, command.offset, 0);
              const id = allocate(command.clientRef),
                right = source.clone();
              blocks.set(id, right);
              right.set('sys:id', id);
              const rightText = right.get('prop:text') as Y.Text;
              textMappings.push({
                opId: command.opId,
                source: {
                  blockId: resolve(command.blockId),
                  offset: command.offset,
                  length: text.length - command.offset,
                },
                target: { blockId: id, offset: 0 },
              });
              if (command.offset) rightText.delete(0, command.offset);
              text.delete(command.offset, text.length - command.offset);
              if (command.children === 'move_right')
                children(source).delete(0, children(source).length);
              else children(right).delete(0, children(right).length);
              if (command.blockComments === 'move_right')
                source.delete('prop:comments');
              else right.delete('prop:comments');
              const siblings = children(parentOf(resolve(command.blockId)));
              siblings.insert(
                siblings.toArray().indexOf(resolve(command.blockId)) + 1,
                [id]
              );
              break;
            }
            case 'block.merge': {
              const firstId = resolve(command.firstBlockId),
                secondId = resolve(command.secondBlockId);
              const first = blockById(firstId),
                second = blockById(secondId);
              if (
                firstId === secondId ||
                !textFlavours.has(supported(first)) ||
                supported(first) !== supported(second)
              )
                invalid('incompatible_text_blocks');
              const parent = parentOf(firstId),
                siblings = children(parent);
              if (
                parentOf(secondId) !== parent ||
                siblings.toArray().indexOf(secondId) !==
                  siblings.toArray().indexOf(firstId) + 1
              )
                invalid('merge_requires_adjacent_siblings');
              const excluded = new Set([
                'sys:id',
                'sys:children',
                'prop:text',
                'prop:comments',
                'prop:meta:createdAt',
                'prop:meta:createdBy',
                'prop:meta:updatedAt',
                'prop:meta:updatedBy',
              ]);
              for (const key of new Set([...first.keys(), ...second.keys()]))
                if (
                  !excluded.has(key) &&
                  !isDeepStrictEqual(
                    nativeValue(first.get(key)),
                    nativeValue(second.get(key))
                  )
                )
                  invalid('merge_has_conflicting_properties', key);
              detachDeletedGraphics(context, new Set([secondId]), 'reject');
              const left = first.get('prop:text'),
                right = second.get('prop:text');
              if (!(left instanceof Y.Text) || !(right instanceof Y.Text))
                invalid('invalid_text_storage');
              textMappings.push({
                opId: command.opId,
                source: { blockId: secondId, offset: 0, length: right.length },
                target: { blockId: firstId, offset: left.length },
              });
              let offset = left.length;
              for (const run of right.toDelta()) {
                if (typeof run.insert !== 'string')
                  invalid('unsupported_text_embed');
                left.insert(offset, run.insert, run.attributes);
                offset += run.insert.length;
              }
              const comments = second.get('prop:comments');
              if (comments instanceof Y.Map) {
                let merged = first.get('prop:comments');
                if (merged === undefined) {
                  merged = new Y.Map();
                  first.set('prop:comments', merged);
                }
                if (!(merged instanceof Y.Map))
                  invalid('invalid_comment_storage');
                for (const [id, state] of comments) {
                  if (merged.has(id) && merged.get(id) !== state)
                    invalid('merge_has_conflicting_comment_state', id);
                  if (!merged.has(id)) merged.set(id, state);
                }
              } else if (comments !== undefined)
                invalid('invalid_comment_storage');
              for (const child of children(second))
                assertPlacement(blockById(child), first);
              children(first).push(children(second).toArray());
              siblings.delete(siblings.toArray().indexOf(secondId), 1);
              blocks.delete(secondId);
              break;
            }
            case 'table.cells.set': {
              const block = table(command.blockId),
                rows = command.rowIds.map(resolve),
                columns = command.columnIds.map(resolve);
              if (
                new Set(rows).size !== rows.length ||
                new Set(columns).size !== columns.length ||
                command.cells.length !== rows.length ||
                command.cells.some(row => row.length !== columns.length)
              )
                invalid('invalid_table_rectangle');
              for (const row of rows) requireAxis(block, 'row', row);
              for (const column of columns)
                requireAxis(block, 'column', column);
              for (const [r, row] of rows.entries())
                for (const [c, column] of columns.entries()) {
                  const target = scratch.getText(`rectangle:${scratchId++}`);
                  target.applyDelta(command.cells[r][c]);
                  const addressed = textAt({
                    kind: 'table_cell',
                    blockId: command.blockId,
                    rowId: row,
                    columnId: column,
                  });
                  if (
                    isDeepStrictEqual(
                      addressed.text.toDelta(),
                      target.toDelta()
                    )
                  )
                    continue;
                  reconcileNativeText(
                    addressed.writable(),
                    target,
                    key =>
                      key.startsWith('comment-') ||
                      !editableMarks.has(key) ||
                      command.marksPolicy === 'preserve_existing'
                  );
                }
              break;
            }
            case 'element.create':
            case 'frame.members.set':
            case 'mindmap.layout':
            case 'element.update':
            case 'element.delete':
            case 'element.members.set':
            case 'element.stroke.set_points':
              applySurfaceCommand(context, command);
              break;
            case 'database.column.create':
            case 'database.column.convert':
            case 'database.column.move':
            case 'database.column.update':
            case 'database.column.delete':
            case 'database.cell.set':
            case 'database.cell.asset.set':
            case 'database.cell.files.set':
            case 'database.cell.members.set':
            case 'database.row.create':
            case 'database.row.delete':
            case 'database.row.move':
            case 'database.view.create':
            case 'database.view.convert':
            case 'database.view.update':
            case 'database.view.delete':
            case 'database.view.move':
              applyDatabaseCommand(context, command);
              break;
            case 'text.splice': {
              const addressed = textAt(command.target);
              let text = addressed.text;
              bounds(text, command.offset, command.deleteCount);
              let inherited: Record<string, unknown> = {};
              if (
                command.marksPolicy === 'inherit_left' ||
                command.marksPolicy === 'inherit_right'
              ) {
                const index =
                  command.marksPolicy === 'inherit_left'
                    ? command.offset - 1
                    : command.offset + command.deleteCount;
                let offset = 0;
                for (const run of text.toDelta() as NativeTextRun[]) {
                  if (offset <= index && index < offset + run.insert.length)
                    inherited = run.attributes ?? {};
                  offset += run.insert.length;
                }
              }
              if (command.marksPolicy === 'inherit_replaced_range') {
                if (!command.deleteCount)
                  invalid('inherit_requires_replaced_range');
                let offset = 0;
                let found = false;
                for (const run of text.toDelta() as NativeTextRun[]) {
                  if (
                    offset < command.offset + command.deleteCount &&
                    offset + run.insert.length > command.offset
                  ) {
                    if (
                      found &&
                      !isDeepStrictEqual(inherited, run.attributes ?? {})
                    )
                      invalid('ambiguous_inherited_marks');
                    inherited = run.attributes ?? {};
                    found = true;
                  }
                  offset += run.insert.length;
                }
              }
              const replacement = command.insert.map(run => ({
                insert: run.insert,
                attributes: { ...inherited, ...run.attributes },
              }));
              // A literal read/edit replay is a true no-op, including metadata.
              const current = text.toDelta() as NativeTextRun[];
              let offset = 0;
              const selected = current.flatMap(run => {
                const start = Math.max(0, command.offset - offset);
                const end = Math.min(
                  run.insert.length,
                  command.offset + command.deleteCount - offset
                );
                offset += run.insert.length;
                return end > start
                  ? [
                      {
                        insert: run.insert.slice(start, end),
                        attributes: run.attributes ?? {},
                      },
                    ]
                  : [];
              });
              if (
                isDeepStrictEqual(
                  normalizeNativeRuns(selected),
                  normalizeNativeRuns(replacement)
                )
              )
                break;
              text = addressed.writable();
              reconcileNativeTextRange(
                text,
                command.offset,
                command.deleteCount,
                replacement,
                key =>
                  command.marksPolicy === 'preserve_existing' ||
                  !editableMarks.has(key)
              );
              break;
            }
            case 'text.format': {
              const addressed = textAt(command.target);
              bounds(addressed.text, command.offset, command.length);
              if (command.length && Object.keys(command.marks).length)
                addressed
                  .writable()
                  .format(command.offset, command.length, command.marks);
              break;
            }
            case 'block.asset.set': {
              const block = blockById(command.blockId),
                flavour = supported(block);
              if (!['affine:image', 'affine:attachment'].includes(flavour))
                invalid('unsupported_asset_target');
              const asset = input.dependencies?.assets[command.blobId];
              if (!asset) invalid('asset_not_authorized');
              if (
                flavour === 'affine:image' &&
                !asset.mimeType.startsWith('image/')
              )
                invalid('expected_image_asset');
              setValue(block, 'prop:sourceId', command.blobId);
              setValue(block, 'prop:size', asset.size);
              if (flavour === 'affine:attachment')
                setValue(block, 'prop:type', asset.mimeType);
              break;
            }
            case 'block.reference.set': {
              const block = blockById(command.blockId),
                flavour = supported(block),
                reference = command.reference;
              if (reference.kind === 'document') {
                if (
                  ![
                    'affine:embed-linked-doc',
                    'affine:embed-synced-doc',
                  ].includes(flavour)
                )
                  invalid('expected_document_reference');
                for (const [key, value] of Object.entries(reference.value))
                  setValue(block, `prop:${key}`, value);
              } else if (reference.kind === 'resource') {
                if (flavour !== 'localmind:subpage')
                  invalid('expected_resource_reference');
                setValue(block, 'prop:kind', reference.resourceKind);
                setValue(block, 'prop:resourceId', reference.resourceId);
              } else {
                if (flavour !== 'affine:surface-ref')
                  invalid('expected_surface_reference');
                const id = resolve(reference.elementId);
                const element = surfaceElements(
                  context,
                  reference.surfaceId
                ).get(id);
                const target = element ?? blocks.get(id);
                if (!target) invalid('reference_target_not_found', id);
                setValue(block, 'prop:reference', id);
                setValue(
                  block,
                  'prop:refFlavour',
                  element
                    ? String(element.get('type'))
                    : String(target.get('sys:flavour'))
                );
              }
              break;
            }
            case 'block.convert': {
              const block = blockById(command.blockId),
                flavour = supported(block);
              if (!textFlavours.has(flavour))
                invalid('unsupported_block_conversion');
              if (flavour === command.flavour) break;
              if (command.flavour === 'affine:code' && children(block).length)
                invalid('code_cannot_contain_children');
              if (
                children(block)
                  .toArray()
                  .some(
                    id =>
                      !documentBlockParents[supported(blockById(id))]?.includes(
                        command.flavour
                      )
                  )
              )
                invalid('invalid_converted_child');
              // Preserve text, provenance and all properties not redefined by the target.
              setValue(block, 'sys:flavour', command.flavour);
              setValue(
                block,
                'sys:version',
                documentBlockVersions[command.flavour]
              );
              if (command.flavour === 'affine:paragraph')
                setValue(block, 'prop:type', 'text');
              if (command.flavour === 'affine:list') {
                setValue(block, 'prop:type', 'bulleted');
                if (!block.has('prop:checked'))
                  setValue(block, 'prop:checked', false);
                if (!block.has('prop:order'))
                  setValue(block, 'prop:order', null);
              }
              if (command.flavour === 'affine:code') {
                if (!block.has('prop:language'))
                  setValue(block, 'prop:language', null);
                if (!block.has('prop:wrap'))
                  setValue(block, 'prop:wrap', false);
                if (!block.has('prop:caption'))
                  setValue(block, 'prop:caption', '');
              }
              if (command.flavour === 'affine:callout') {
                if (!block.has('prop:icon'))
                  setValue(block, 'prop:icon', {
                    type: 'emoji',
                    unicode: '💡',
                  });
                if (!block.has('prop:backgroundColorName'))
                  setValue(block, 'prop:backgroundColorName', 'grey');
              }
              assertPlacement(block, parentOf(resolve(command.blockId)));
              break;
            }
            case 'block.properties': {
              const block = blockById(command.blockId);
              if (supported(block) !== command.flavour)
                invalid('block_flavour_mismatch', command.blockId);
              const properties = documentBlockProperties[command.flavour].parse(
                command.properties
              );
              for (const [key, value] of Object.entries(properties))
                setValue(block, `prop:${key}`, value);
              break;
            }
            case 'block.create': {
              const parent = blockById(command.parentId);
              const array = children(parent);
              const index = command.index ?? array.length;
              if (index > array.length) invalid('invalid_child_index');
              const id = allocate(command.clientRef);
              if (
                command.flavour === 'affine:surface' &&
                [...blocks.values()].some(
                  block => block.get('sys:flavour') === 'affine:surface'
                )
              )
                invalid('document_already_has_surface');
              const block = new Y.Map<unknown>();
              blocks.set(id, block);
              block.set('sys:id', id);
              block.set('sys:flavour', command.flavour);
              block.set('sys:version', documentBlockVersions[command.flavour]);
              block.set('sys:children', new Y.Array<string>());
              assertPlacement(block, parent);
              for (const [key, value] of Object.entries(
                documentBlockDefaults[command.flavour] ?? {}
              ))
                setValue(block, `prop:${key}`, value);
              if (command.flavour === 'affine:frame')
                block.set('prop:title', new Y.Text());
              if (command.flavour === 'affine:surface') {
                const boxed = new Y.Map<unknown>();
                block.set('prop:elements', boxed);
                boxed.set('type', '$blocksuite:internal:native$');
                boxed.set('value', new Y.Map());
              }
              if (textFlavours.has(command.flavour)) {
                const text = new Y.Text();
                block.set('prop:text', text);
                text.applyDelta(command.text ?? []);
              } else if (command.text?.length) invalid('block_has_no_text');
              if (command.flavour === 'affine:paragraph') {
                block.set('prop:type', 'text');
                block.set('prop:collapsed', false);
              }
              if (command.flavour === 'affine:list') {
                block.set('prop:type', 'bulleted');
                block.set('prop:checked', false);
                block.set('prop:collapsed', false);
                block.set('prop:order', null);
              }
              if (command.flavour === 'affine:code') {
                block.set('prop:language', null);
                block.set('prop:wrap', false);
                block.set('prop:caption', '');
              }
              if (command.flavour === 'affine:callout') {
                setValue(block, 'prop:icon', { type: 'emoji', unicode: '💡' });
                block.set('prop:backgroundColorName', 'grey');
              }
              if (command.flavour === 'affine:note') {
                block.set('prop:xywh', '[0,0,498,92]');
                setValue(block, 'prop:background', {
                  light: '#ffffff',
                  dark: '#252525',
                });
                block.set('prop:index', 'a0');
                block.set('prop:lockedBySelf', false);
                block.set('prop:hidden', false);
                block.set('prop:displayMode', 'both');
                setValue(block, 'prop:edgeless', {
                  style: {
                    borderRadius: 8,
                    borderSize: 4,
                    borderStyle: 'none',
                    shadowType: '--affine-note-shadow-box',
                  },
                });
              }
              if (command.flavour === 'affine:latex') {
                block.set('prop:latex', '');
                block.set('prop:xywh', '[0,0,16,16]');
                block.set('prop:index', 'a0');
                block.set('prop:lockedBySelf', false);
                block.set('prop:scale', 1);
                block.set('prop:rotate', 0);
              }
              if (
                command.flavour === 'affine:database' ||
                command.flavour === 'affine:data-view'
              ) {
                block.set(
                  'prop:title',
                  command.flavour === 'affine:database' ? new Y.Text() : ''
                );
                block.set('prop:columns', new Y.Array());
                block.set('prop:views', new Y.Array());
                block.set('prop:cells', new Y.Map());
                const titleRef = `${command.clientRef}:title`;
                applyDatabaseCommand(context, {
                  type: 'database.column.create',
                  opId: command.opId,
                  blockId: id,
                  clientRef: titleRef,
                  column: {
                    name: 'Title',
                    type:
                      command.flavour === 'affine:data-view'
                        ? 'rich-text'
                        : 'title',
                    data: {},
                  },
                });
                applyDatabaseCommand(context, {
                  type: 'database.view.create',
                  opId: command.opId,
                  blockId: id,
                  clientRef: `${command.clientRef}:view`,
                  view: {
                    mode: 'table',
                    name: 'Table',
                    columns: [{ id: resolve(`$${titleRef}`), width: 260 }],
                    filter: { type: 'group', op: 'and', conditions: [] },
                    header: {
                      titleColumn: resolve(`$${titleRef}`),
                      iconColumn: 'type',
                    },
                  },
                });
              }
              array.insert(index, [id]);
              break;
            }
            case 'block.move': {
              const id = resolve(command.blockId),
                parentId = resolve(command.parentId);
              const block = blockById(id),
                parent = blockById(parentId);
              assertPlacement(block, parent);
              if (descendants(id).has(parentId)) invalid('cyclic_move');
              const previous = parentOf(id),
                source = children(previous),
                target = children(parent);
              const oldIndex = source.toArray().indexOf(id);
              if (command.index > target.length - (source === target ? 1 : 0))
                invalid('invalid_child_index');
              if (source !== target || oldIndex !== command.index) {
                source.delete(oldIndex, 1);
                target.insert(command.index, [id]);
              }
              break;
            }
            case 'block.delete': {
              const id = resolve(command.blockId),
                block = blockById(id);
              if (['affine:page', 'affine:surface'].includes(supported(block)))
                invalid('cannot_delete_root');
              const ids = descendants(id);
              if (!command.includeDescendants && ids.size > 1)
                invalid('descendant_deletion_not_requested');
              detachDeletedGraphics(context, ids, command.references);
              const source = children(parentOf(id));
              source.delete(source.toArray().indexOf(id), 1);
              for (const child of ids) blocks.delete(child);
              break;
            }
            case 'table.axis.insert':
            case 'table.axis.move': {
              const block = table(command.blockId);
              const id =
                command.type === 'table.axis.insert'
                  ? allocate(command.clientRef)
                  : resolve(command.id);
              if (command.type === 'table.axis.move')
                requireAxis(block, command.axis, id);
              const order = axes(block, command.axis).filter(
                value => value !== id
              );
              if (command.index > order.length) invalid('invalid_axis_index');
              const key = `prop:${command.axis}s.${id}`;
              if (
                command.type === 'table.axis.move' &&
                axes(block, command.axis).indexOf(id) === command.index
              )
                break;
              const before = command.index
                ? String(
                    block.get(
                      `prop:${command.axis}s.${order[command.index - 1]}.order`
                    )
                  )
                : null;
              const after =
                command.index < order.length
                  ? String(
                      block.get(
                        `prop:${command.axis}s.${order[command.index]}.order`
                      )
                    )
                  : null;
              block.set(`${key}.${command.axis}Id`, id);
              block.set(`${key}.order`, generateKeyBetween(before, after));
              break;
            }
            case 'table.axis.delete': {
              const block = table(command.blockId),
                id = resolve(command.id);
              requireAxis(block, command.axis, id);
              for (const key of block.keys()) {
                if (
                  key.startsWith(`prop:${command.axis}s.${id}.`) ||
                  (key.startsWith('prop:cells.') &&
                    (command.axis === 'row'
                      ? key.startsWith(`prop:cells.${id}:`)
                      : key.slice(11).split('.')[0].endsWith(`:${id}`)))
                )
                  block.delete(key);
              }
              break;
            }
            case 'table.axis.format': {
              const block = table(command.blockId),
                id = resolve(command.id);
              requireAxis(block, command.axis, id);
              const key = `prop:${command.axis}s.${id}`;
              if (command.width !== undefined) {
                if (command.axis !== 'column') invalid('row_has_no_width');
                setValue(block, `${key}.width`, command.width);
              }
              if (command.backgroundColor === null)
                block.delete(`${key}.backgroundColor`);
              else if (command.backgroundColor !== undefined)
                setValue(
                  block,
                  `${key}.backgroundColor`,
                  command.backgroundColor
                );
              break;
            }
          }
        } catch (error) {
          if (error instanceof DocumentEditError) {
            error.detail.opId = command.opId;
            throw error;
          }
          if (error instanceof ResourceError) throw error;
          throw new DocumentEditError('invalid_input', {
            opId: command.opId,
            reason: 'invalid_native_operation',
          });
        }
      }
      for (const [id, block] of blocks) {
        if (isDeepStrictEqual(before.get(id), nativeValue(block))) continue;
        const flavour = String(block.get('sys:flavour'));
        if (!documentMetadataFlavours.has(flavour)) continue;
        if (!before.has(id)) {
          block.set('prop:meta:createdAt', input.now);
          block.set('prop:meta:createdBy', input.actorId);
        }
        block.set('prop:meta:updatedAt', input.now);
        block.set('prop:meta:updatedBy', input.actorId);
      }
    });
    const update = Y.encodeStateAsUpdate(doc, vector);
    const changedIds = [
      ...new Set([...before.keys(), ...blocks.keys()]),
    ].filter(
      id => !isDeepStrictEqual(before.get(id), nativeValue(blocks.get(id)))
    );
    return {
      update,
      ...verifyPreservation(),
      changed: changedIds.length > 0,
      changedIds,
      identities: Object.fromEntries(refs),
      textMappings,
      digest: createHash('sha256')
        .update(JSON.stringify([DOCUMENT_CONTRACT_VERSION, commands]))
        .digest('hex'),
    };
  } finally {
    scratch.destroy();
    doc.destroy();
  }
}
