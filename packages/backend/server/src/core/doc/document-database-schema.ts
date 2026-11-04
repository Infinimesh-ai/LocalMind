import { z } from 'zod';

const id = z.string().min(1).max(256);
const text = z.string().max(8192);
const index = z.number().int().nonnegative();
const empty = z.object({}).strict();
const tags = z
  .object({
    options: z
      .array(z.object({ id, value: text, color: text }).strict())
      .max(10000)
      .refine(
        options =>
          new Set(options.map(option => option.id)).size === options.length,
        'Duplicate option identity'
      ),
  })
  .strict();
const name = { name: text };
export const documentColumn = z.discriminatedUnion('type', [
  z.object({ ...name, type: z.literal('title'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('rich-text'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('text'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('link'), data: empty }).strict(),
  z
    .object({
      ...name,
      type: z.literal('number'),
      data: z
        .object({
          decimal: z.number().int().min(0).max(20).optional(),
          format: z.enum([
            'number',
            'numberWithCommas',
            'percent',
            'currencyYen',
            'currencyINR',
            'currencyCNY',
            'currencyUSD',
            'currencyEUR',
            'currencyGBP',
          ]),
        })
        .strict(),
    })
    .strict(),
  z.object({ ...name, type: z.literal('progress'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('checkbox'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('date'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('created-time'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('select'), data: tags }).strict(),
  z.object({ ...name, type: z.literal('multi-select'), data: tags }).strict(),
  z.object({ ...name, type: z.literal('image'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('attachment'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('member'), data: empty }).strict(),
  z.object({ ...name, type: z.literal('created-by'), data: empty }).strict(),
]);
const primitive = z.union([
  z.string().max(1024 * 1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const literal = z
  .object({
    type: z.literal('literal'),
    value: z.union([primitive, z.array(primitive).max(10000)]),
  })
  .strict();
const ref = z.object({ type: z.literal('ref'), name: id }).strict();
type Filter =
  | {
      type: 'filter';
      left: z.infer<typeof ref>;
      function?: string;
      args: z.infer<typeof literal>[];
    }
  | { type: 'group'; op: 'and' | 'or'; conditions: Filter[] };
const filterAt = (depth: number): z.ZodType<Filter> =>
  z.union([
    z
      .object({
        type: z.literal('filter'),
        left: ref,
        function: text.optional(),
        args: z.array(literal).max(20),
      })
      .strict(),
    z
      .object({
        type: z.literal('group'),
        op: z.enum(['and', 'or']),
        conditions: z.array(depth ? filterAt(depth - 1) : z.never()).max(100),
      })
      .strict(),
  ]);
export const documentFilter = filterAt(12);
const sort = z
  .object({
    sortBy: z.array(z.object({ ref, desc: z.boolean() }).strict()).max(100),
    manuallySort: z.array(id).max(10000),
  })
  .strict();
const groupBy = z
  .object({
    type: z.literal('groupBy'),
    columnId: id,
    name: text,
    hideEmpty: z.boolean().optional(),
    sort: z.object({ desc: z.boolean() }).strict().optional(),
  })
  .strict();
const groupProperties = z
  .array(
    z
      .object({
        key: text,
        hide: z.boolean().optional(),
        manuallyCardSort: z.array(id).max(10000),
      })
      .strict()
  )
  .max(10000);
const commonView = {
  name: text,
  filter: documentFilter,
  sort: sort.optional(),
};
export const documentView = z.discriminatedUnion('mode', [
  z
    .object({
      ...commonView,
      mode: z.literal('table'),
      columns: z
        .array(
          z
            .object({
              id,
              width: z.number().positive(),
              statCalcType: text.optional(),
              hide: z.boolean().optional(),
            })
            .strict()
        )
        .max(1000),
      groupBy: groupBy.optional(),
      groupProperties: groupProperties.optional(),
      header: z
        .object({
          titleColumn: id.optional(),
          iconColumn: id.optional(),
          imageColumn: id.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      ...commonView,
      mode: z.literal('kanban'),
      columns: z
        .array(z.object({ id, hide: z.boolean().optional() }).strict())
        .max(1000),
      groupBy,
      groupProperties,
      header: z
        .object({
          titleColumn: id.optional(),
          iconColumn: id.optional(),
          coverColumn: id.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...commonView,
      mode: z.literal('calendar'),
      date: z
        .object({ startColumnId: id.optional(), endColumnId: id.optional() })
        .strict(),
      card: z
        .object({
          titleColumnId: id.optional(),
          visiblePropertyIds: z.array(id).max(1000),
        })
        .strict(),
      sources: z
        .object({
          workspaceCalendar: z
            .object({
              enabled: z.boolean(),
              subscriptionIds: z.array(id).max(1000).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      ui: z
        .object({ emptyMonthHintDismissed: z.boolean().optional() })
        .strict()
        .optional(),
    })
    .strict(),
]);
const operation = { opId: id, blockId: id };
export const documentDatabaseCommand = z.discriminatedUnion('type', [
  z
    .object({
      ...operation,
      type: z.literal('database.cell.members.set'),
      rowId: id,
      rowDocumentId: id.optional(),
      columnId: id,
      userIds: z.array(id).max(1000),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.cell.files.set'),
      rowId: id,
      rowDocumentId: id.optional(),
      columnId: id,
      files: z.array(z.object({ blobId: id, name: text }).strict()).max(256),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.cell.asset.set'),
      rowId: id,
      rowDocumentId: id.optional(),
      columnId: id,
      blobId: id.nullable(),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.column.move'),
      columnId: id,
      index,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.column.convert'),
      columnId: id,
      column: documentColumn,
      values: z
        .array(
          z
            .object({
              rowId: id,
              rowDocumentId: id.optional(),
              value: z.union([primitive, z.array(id).max(10000)]),
            })
            .strict()
        )
        .max(10000),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.view.convert'),
      viewId: id,
      view: documentView,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.column.create'),
      clientRef: id,
      index: index.optional(),
      column: documentColumn,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.column.update'),
      columnId: id,
      column: documentColumn,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.column.delete'),
      columnId: id,
      deleteValues: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.cell.set'),
      rowDocumentId: id.optional(),
      rowId: id,
      columnId: id,
      value: z.union([primitive, z.array(id).max(10000)]),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.row.create'),
      clientRef: id,
      index: index.optional(),
      title: z.string().max(1024 * 1024),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.row.delete'),
      rowId: id,
      includeDescendants: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.row.move'),
      rowId: id,
      index,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.view.create'),
      clientRef: id,
      index: index.optional(),
      view: documentView,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.view.update'),
      viewId: id,
      view: documentView,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.view.delete'),
      viewId: id,
    })
    .strict(),
  z
    .object({
      ...operation,
      type: z.literal('database.view.move'),
      viewId: id,
      index,
    })
    .strict(),
]);
export type DocumentDatabaseCommand = z.infer<typeof documentDatabaseCommand>;
