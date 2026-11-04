import { validateFilterContract } from '@blocksuite/data-view/filter-pure';
import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';

import type { DocumentDatabaseCommand } from './document-database-schema';
import type { DocumentDependencies } from './document-dependencies';
import { detachDeletedGraphics } from './document-surface';
import { reconcileNativeArray } from './native-array';
import { reconcileNativeText } from './native-text';

type Map = Y.Map<unknown>;
export type NativeEditContext = {
  blocks: Y.Map<Map>;
  queryRows?: Set<string>;
  assets?: DocumentDependencies['assets'];
  members?: Set<string>;
  blockById(id: string): Map;
  resolve(id: string): string;
  allocate(ref: string): string;
  setValue(map: Map, key: string, value: unknown): void;
  invalid(reason: string, objectId?: string): never;
};
export function databaseParts(context: NativeEditContext, id: string) {
  const block = context.blockById(id);
  if (
    !['affine:database', 'affine:data-view'].includes(
      String(block.get('sys:flavour'))
    )
  )
    context.invalid('expected_database', id);
  if (
    block.get('sys:version') !==
    (block.get('sys:flavour') === 'affine:database' ? 3 : 1)
  )
    context.invalid('unsupported_database_version', id);
  const columns = block.get('prop:columns'),
    cells = block.get('prop:cells'),
    views = block.get('prop:views'),
    rows = block.get('sys:children');
  if (
    !(columns instanceof Y.Array) ||
    !(cells instanceof Y.Map) ||
    !(views instanceof Y.Array) ||
    !(rows instanceof Y.Array)
  )
    context.invalid('invalid_database_storage', id);
  return {
    block,
    query: block.get('sys:flavour') === 'affine:data-view',
    columns: columns as Y.Array<Map>,
    cells: cells as Y.Map<Map>,
    views: views as Y.Array<Map>,
    rows: rows as Y.Array<string>,
  };
}
export function assertDatabaseRow(
  context: NativeEditContext,
  db: ReturnType<typeof databaseParts>,
  rowId: string,
  documentId?: string
) {
  const row = context.resolve(rowId);
  if (db.query) {
    const source = documentId ? undefined : context.blocks.get(row);
    if (
      !(documentId && context.queryRows?.has(`${documentId}:${row}`)) &&
      !(
        source?.get('sys:flavour') === 'affine:list' &&
        source.get('prop:type') === 'todo'
      )
    )
      context.invalid('query_row_not_authorized_or_not_matching', row);
  } else if (documentId || !db.rows.toArray().includes(row))
    context.invalid('database_row_not_found', row);
  return row;
}

export function databaseCell(
  context: NativeEditContext,
  blockId: string,
  rowId: string,
  columnId: string,
  rowDocumentId?: string
) {
  const db = databaseParts(context, blockId);
  const row = context.resolve(rowId),
    column = context.resolve(columnId);
  assertDatabaseRow(context, db, row, rowDocumentId);
  const definition = db.columns
    .toArray()
    .find(value => value.get('id') === column);
  if (!definition) context.invalid('database_column_not_found', column);
  let rowCells = db.cells.get(row);
  if (!rowCells) {
    rowCells = new Y.Map();
    db.cells.set(row, rowCells);
  }
  if (!(rowCells instanceof Y.Map))
    context.invalid('invalid_database_row', row);
  if (db.query) return { cell: rowCells, definition, key: column };
  let cell = rowCells.get(column);
  if (!cell) {
    cell = new Y.Map();
    rowCells.set(column, cell);
    (cell as Map).set('columnId', column);
  }
  if (!(cell instanceof Y.Map))
    context.invalid('invalid_database_cell', column);
  return { cell: cell as Map, definition, key: 'value' };
}

export function applyDatabaseCommand(
  context: NativeEditContext,
  command: DocumentDatabaseCommand
) {
  const invalid: NativeEditContext['invalid'] = context.invalid;
  const { setValue, resolve } = context;
  const db = databaseParts(context, command.blockId);
  const columnById = (id: string) =>
    db.columns.toArray().find(column => column.get('id') === resolve(id)) ??
    invalid('database_column_not_found', id);
  const viewById = (id: string) =>
    db.views.toArray().find(view => view.get('id') === resolve(id)) ??
    invalid('database_view_not_found', id);
  const rowById = (id: string) => {
    const rowId = resolve(id);
    if (!db.rows.toArray().includes(rowId))
      invalid('database_row_not_found', id);
    return rowId;
  };
  const createMap = (value: object) => {
    const map = new Y.Map<unknown>();
    // A detached Y.Map is write-only until integrated. Values are constructed
    // recursively here; leaf reconciliation happens only on integrated maps.
    const convert = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        const array = new Y.Array();
        array.push(value.map(convert));
        return array;
      }
      if (value && typeof value === 'object') {
        const nested = new Y.Map();
        for (const [key, child] of Object.entries(value))
          nested.set(key, convert(child));
        return nested;
      }
      return value;
    };
    for (const [key, child] of Object.entries(value))
      map.set(key, convert(child));
    return map;
  };
  const insertionIndex = (requested: number | undefined, length: number) => {
    const index = requested ?? length;
    if (index > length) invalid('invalid_database_index');
    return index;
  };
  const checkView = (
    view: Extract<
      DocumentDatabaseCommand,
      { type: 'database.view.create' }
    >['view']
  ) => {
    view = structuredClone(view);
    const known = new Set(
      db.columns.toArray().map(column => String(column.get('id')))
    );
    const check = (id: string | undefined) => {
      if (id !== undefined && id !== 'type' && !known.has(id))
        invalid('view_column_not_found', id);
    };
    const filter = (value: typeof view.filter, depth = 0) => {
      if (depth > 12) invalid('filter_depth_exceeded');
      if (value.type === 'filter') {
        value.left.name = resolve(value.left.name);
        check(value.left.name);
        if (value.function) {
          const definition = columnById(value.left.name),
            type = definition.get('type');
          if (
            !validateFilterContract(
              value.function,
              String(type),
              value.args.map(argument => argument.value)
            )
          )
            invalid('invalid_filter_function_or_arguments');
        } else if (value.args.length)
          invalid('filter_arguments_require_function');
      } else value.conditions.forEach(child => filter(child, depth + 1));
    };
    filter(view.filter);
    view.sort?.sortBy.forEach(sort => {
      sort.ref.name = resolve(sort.ref.name);
      check(sort.ref.name);
    });
    if (view.sort) view.sort.manuallySort = view.sort.manuallySort.map(resolve);
    if (view.mode === 'calendar') {
      if (view.date.startColumnId)
        view.date.startColumnId = resolve(view.date.startColumnId);
      if (view.date.endColumnId)
        view.date.endColumnId = resolve(view.date.endColumnId);
      if (view.card.titleColumnId)
        view.card.titleColumnId = resolve(view.card.titleColumnId);
      view.card.visiblePropertyIds = view.card.visiblePropertyIds.map(resolve);
      check(view.date.startColumnId);
      check(view.date.endColumnId);
      check(view.card.titleColumnId);
      view.card.visiblePropertyIds.forEach(check);
    } else {
      view.columns.forEach(column => {
        column.id = resolve(column.id);
      });
      if (view.groupBy) view.groupBy.columnId = resolve(view.groupBy.columnId);
      if (view.header)
        for (const key of Object.keys(
          view.header
        ) as (keyof typeof view.header)[]) {
          const id = view.header[key];
          if (id) view.header[key] = resolve(id);
        }
      const ids = view.columns.map(column => column.id);
      if (new Set(ids).size !== ids.length) invalid('duplicate_view_column');
      ids.forEach(check);
      check(view.groupBy?.columnId);
      Object.values(view.header ?? {}).forEach(check);
    }
    return view;
  };
  if (db.query && command.type.startsWith('database.row.'))
    invalid('query_rows_belong_to_source_documents');
  if (
    db.query &&
    'column' in command &&
    ![
      'date',
      'number',
      'progress',
      'select',
      'multi-select',
      'checkbox',
      'rich-text',
    ].includes(command.column.type)
  )
    invalid('unsupported_query_column_type');
  switch (command.type) {
    case 'database.cell.members.set': {
      if (columnById(command.columnId).get('type') !== 'member')
        invalid('expected_member_column');
      return applyDatabaseCommand(context, {
        ...command,
        type: 'database.cell.set',
        value: command.userIds,
      });
    }
    case 'database.cell.files.set': {
      if (columnById(command.columnId).get('type') !== 'attachment')
        invalid('expected_attachment_column');
      const rowId = assertDatabaseRow(
        context,
        db,
        command.rowId,
        command.rowDocumentId
      );
      if (
        new Set(command.files.map(file => file.blobId)).size !==
        command.files.length
      )
        invalid('duplicate_attachment_identity');
      for (const file of command.files)
        if (!context.assets?.[file.blobId]) invalid('asset_not_authorized');
      const storedCell = db.cells.get(rowId)?.get(resolve(command.columnId));
      const previous = db.query
        ? storedCell
        : storedCell instanceof Y.Map
          ? storedCell.get('value')
          : undefined;
      if (
        !command.files.length &&
        (previous === undefined || previous === null)
      )
        break;
      const { cell, key } = databaseCell(
        context,
        command.blockId,
        command.rowId,
        command.columnId,
        command.rowDocumentId
      );
      let value = cell.get(key);
      if (value === undefined || value === null) {
        value = new Y.Map();
        cell.set(key, value);
      }
      if (!(value instanceof Y.Map)) invalid('invalid_attachment_storage');
      const retained = new Set(command.files.map(file => file.blobId));
      for (const id of value.keys()) if (!retained.has(id)) value.delete(id);
      let previousOrder: string | null = null;
      for (const file of command.files) {
        let item = value.get(file.blobId);
        if (item === undefined) {
          item = new Y.Map();
          value.set(file.blobId, item);
        }
        if (!(item instanceof Y.Map)) invalid('invalid_attachment_storage');
        const order = item.get('order');
        const nextOrder: string =
          typeof order === 'string' && (!previousOrder || order > previousOrder)
            ? order
            : generateKeyBetween(previousOrder, null);
        setValue(item, 'id', file.blobId);
        setValue(item, 'name', file.name);
        if (item.get('mime') === undefined)
          setValue(
            item,
            'mime',
            context.assets?.[file.blobId]?.mimeType ??
              invalid('asset_not_authorized')
          );
        setValue(item, 'order', nextOrder);
        previousOrder = nextOrder;
      }
      break;
    }
    case 'database.cell.asset.set': {
      const definition = columnById(command.columnId);
      if (definition.get('type') !== 'image') invalid('expected_image_column');
      const rowId = assertDatabaseRow(
        context,
        db,
        command.rowId,
        command.rowDocumentId
      );
      const asset = command.blobId
        ? context.assets?.[command.blobId]
        : undefined;
      if (
        command.blobId &&
        (!asset?.url || !asset.mimeType.startsWith('image/'))
      )
        invalid('image_asset_not_authorized');
      if (
        !command.blobId &&
        !db.cells.get(rowId)?.has(resolve(command.columnId))
      )
        break;
      const { cell, key } = databaseCell(
        context,
        command.blockId,
        rowId,
        command.columnId,
        command.rowDocumentId
      );
      setValue(cell, key, asset?.url ?? null);
      break;
    }
    case 'database.column.move': {
      const column = columnById(command.columnId),
        desired = db.columns.toArray().filter(value => value !== column);
      desired.splice(insertionIndex(command.index, desired.length), 0, column);
      reconcileNativeArray(
        db.columns,
        desired,
        value => String((value as Map).get('id')),
        value => value.clone(),
        () => {}
      );
      break;
    }
    case 'database.column.convert': {
      const column = columnById(command.columnId),
        id = String(column.get('id')),
        original = String(column.get('type'));
      if (
        original === 'title' ||
        command.column.type === 'title' ||
        command.column.type === 'created-time' ||
        command.column.type === 'created-by'
      )
        invalid('derived_column_conversion_not_supported');
      const values = new Map(
        command.values.map(value => [resolve(value.rowId), value])
      );
      if (values.size !== command.values.length)
        invalid('duplicate_conversion_row');
      const required = ['created-time', 'created-by'].includes(original)
        ? db.rows.toArray()
        : [...db.cells]
            .filter(([, row]) => {
              const cell = row.get(id),
                value = db.query
                  ? cell
                  : cell instanceof Y.Map
                    ? cell.get('value')
                    : undefined;
              return value !== undefined && value !== null;
            })
            .map(([id]) => id);
      if (required.some(row => !values.has(row)))
        invalid('column_conversion_requires_every_stored_value');
      setValue(column, 'type', command.column.type);
      setValue(column, 'name', command.column.name);
      setValue(column, 'data', command.column.data);
      for (const [rowId, value] of values) {
        assertDatabaseRow(context, db, rowId, value.rowDocumentId);
        if (command.column.type === 'rich-text') {
          if (value.value !== null && typeof value.value !== 'string')
            invalid('rich_text_conversion_requires_text');
          const { cell, key } = databaseCell(
            context,
            command.blockId,
            rowId,
            id,
            value.rowDocumentId
          );
          const previous = cell.get(key);
          if (previous instanceof Y.Text) {
            const scratch = new Y.Doc();
            try {
              const desired = scratch.getText('value');
              desired.insert(0, value.value ?? '');
              reconcileNativeText(previous, desired, () => true);
            } finally {
              scratch.destroy();
            }
          } else cell.set(key, new Y.Text(value.value ?? ''));
        } else
          applyDatabaseCommand(context, {
            ...command,
            type: 'database.cell.set',
            rowId,
            rowDocumentId: value.rowDocumentId,
            value: value.value,
          });
      }
      break;
    }
    case 'database.column.create': {
      if (
        command.column.type === 'title' &&
        db.columns.toArray().some(column => column.get('type') === 'title')
      )
        invalid('duplicate_title_column');
      const id = context.allocate(command.clientRef);
      db.columns.insert(insertionIndex(command.index, db.columns.length), [
        createMap({ id, ...command.column }),
      ]);
      break;
    }
    case 'database.column.update': {
      const column = columnById(command.columnId);
      if (column.get('type') !== command.column.type)
        invalid('column_conversion_requires_explicit_values');
      if (
        command.column.type === 'select' ||
        command.column.type === 'multi-select'
      ) {
        const options = new Set(
          command.column.data.options.map(option => option.id)
        );
        for (const row of db.cells.values()) {
          const cell = row.get(String(column.get('id')));
          const raw = db.query
            ? cell
            : cell instanceof Y.Map
              ? cell.get('value')
              : undefined;
          const values =
            raw instanceof Y.Array
              ? raw.toArray()
              : Array.isArray(raw)
                ? raw
                : raw == null
                  ? []
                  : [raw];
          if (
            values.some(
              value => typeof value !== 'string' || !options.has(value)
            )
          )
            invalid('column_has_value_dependencies');
        }
      }
      setValue(column, 'name', command.column.name);
      setValue(column, 'data', command.column.data);
      break;
    }
    case 'database.column.delete': {
      const column = columnById(command.columnId),
        id = String(column.get('id'));
      if (column.get('type') === 'title') invalid('title_column_is_required');
      // Removing a definition must not silently change filters, groups or
      // formulas. Require the caller to edit dependent views in this batch.
      for (const view of db.views) {
        const data = view.toJSON() as Record<string, unknown>;
        const find = (value: unknown): boolean =>
          value === id ||
          (Array.isArray(value)
            ? value.some(find)
            : value !== null &&
              typeof value === 'object' &&
              Object.values(value).some(find));
        if (find(data)) invalid('column_has_view_dependencies', id);
      }
      for (const row of db.cells.values()) row.delete(id);
      db.columns.delete(db.columns.toArray().indexOf(column), 1);
      break;
    }
    case 'database.cell.set': {
      const rowId = assertDatabaseRow(
        context,
        db,
        command.rowId,
        command.rowDocumentId
      );
      const definition = columnById(command.columnId);
      const type = definition.get('type'),
        value = command.value;
      if (['title', 'rich-text'].includes(String(type)))
        invalid('use_native_text_command');
      if (type === 'created-time' || type === 'created-by')
        invalid('creation_evidence_is_read_only');
      if (type === 'attachment' && value !== null)
        invalid('use_attachment_cell_command');
      if (
        type === 'member' &&
        value !== null &&
        (!Array.isArray(value) ||
          new Set(value).size !== value.length ||
          value.some(id => !context.members?.has(id)))
      )
        invalid('member_not_authorized');
      if (value !== null) {
        if (
          ['number', 'date', 'progress'].includes(String(type)) &&
          typeof value !== 'number'
        )
          invalid('invalid_numeric_cell');
        if (
          type === 'progress' &&
          (typeof value !== 'number' || value < 0 || value > 100)
        )
          invalid('invalid_progress_cell');
        if (type === 'checkbox' && typeof value !== 'boolean')
          invalid('invalid_checkbox_cell');
        if (
          ['text', 'link', 'image', 'select'].includes(String(type)) &&
          typeof value !== 'string'
        )
          invalid('invalid_text_cell');
        if (type === 'image' || type === 'link') {
          try {
            if (
              ![
                'http:',
                'https:',
                ...(type === 'link' ? ['mailto:', 'tel:'] : []),
              ].includes(new URL(String(value)).protocol)
            )
              invalid('invalid_cell_url');
          } catch {
            invalid('invalid_cell_url');
          }
        }
        if (type === 'multi-select' && !Array.isArray(value))
          invalid('invalid_selection_cell');
        if (type === 'select' || type === 'multi-select') {
          const data = definition.get('data');
          const options =
            data instanceof Y.Map ? data.get('options') : undefined;
          if (!(options instanceof Y.Array))
            invalid('invalid_selection_options');
          const ids = new Set(
            options
              .toArray()
              .map(option =>
                option instanceof Y.Map ? option.get('id') : undefined
              )
          );
          if ((Array.isArray(value) ? value : [value]).some(id => !ids.has(id)))
            invalid('selection_option_not_found');
        }
      }
      if (
        ![
          'number',
          'date',
          'progress',
          'checkbox',
          'text',
          'link',
          'image',
          'select',
          'multi-select',
          'member',
          'attachment',
        ].includes(String(type))
      )
        invalid('unsupported_column_type');
      const existing = db.cells.get(rowId)?.get(resolve(command.columnId));
      if (value === null && existing === undefined) break;
      const { cell, key } = databaseCell(
        context,
        command.blockId,
        rowId,
        command.columnId,
        command.rowDocumentId
      );
      setValue(cell, key, value);
      break;
    }
    case 'database.row.create': {
      const id = context.allocate(command.clientRef);
      const row = createMap({
        'sys:id': id,
        'sys:flavour': 'affine:paragraph',
        'sys:version': 1,
        'sys:children': [],
        'prop:type': 'text',
        'prop:collapsed': false,
      });
      context.blocks.set(id, row);
      row.set('prop:text', new Y.Text(command.title));
      db.rows.insert(insertionIndex(command.index, db.rows.length), [id]);
      break;
    }
    case 'database.row.delete': {
      const id = rowById(command.rowId),
        deleted = new Set<string>();
      const visit = (id: string) => {
        if (deleted.has(id)) invalid('cyclic_database_row');
        deleted.add(id);
        const children = context.blockById(id).get('sys:children');
        if (!(children instanceof Y.Array)) invalid('invalid_database_row');
        if (children.length && !command.includeDescendants)
          invalid('descendant_deletion_not_requested');
        for (const child of children) visit(String(child));
      };
      visit(id);
      detachDeletedGraphics(context, deleted, 'reject');
      db.rows.delete(db.rows.toArray().indexOf(id), 1);
      db.cells.delete(id);
      for (const child of deleted) context.blocks.delete(child);
      break;
    }
    case 'database.row.move': {
      const id = rowById(command.rowId),
        index = db.rows.toArray().indexOf(id);
      insertionIndex(command.index, db.rows.length - 1);
      if (index !== command.index) {
        db.rows.delete(index, 1);
        db.rows.insert(command.index, [id]);
      }
      break;
    }
    case 'database.view.create': {
      const view = checkView(command.view);
      const id = context.allocate(command.clientRef);
      db.views.insert(insertionIndex(command.index, db.views.length), [
        createMap({ id, ...view }),
      ]);
      break;
    }
    case 'database.view.convert':
    case 'database.view.update': {
      const view = viewById(command.viewId);
      if (
        command.type === 'database.view.update' &&
        view.get('mode') !== command.view.mode
      )
        invalid('view_conversion_requires_explicit_intent');
      const checked = checkView(command.view);
      for (const [key, value] of Object.entries(checked))
        setValue(view, key, value);
      break;
    }
    case 'database.view.delete': {
      if (db.views.length === 1) invalid('database_requires_one_view');
      db.views.delete(db.views.toArray().indexOf(viewById(command.viewId)), 1);
      break;
    }
    case 'database.view.move': {
      const view = viewById(command.viewId),
        index = db.views.toArray().indexOf(view);
      insertionIndex(command.index, db.views.length - 1);
      if (index !== command.index) {
        const copy = view.clone();
        db.views.delete(index, 1);
        db.views.insert(command.index, [copy]);
      }
      break;
    }
  }
}
