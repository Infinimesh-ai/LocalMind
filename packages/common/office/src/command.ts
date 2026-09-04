import { z } from 'zod';

const boundedString = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength);
const hexColor = z.string().regex(/^#[0-9A-F]{6}$/i);
const boundedBase64 = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'invalid base64 payload');

export const OfficeTextPositionSchema = z
  .object({
    blockId: boundedString(512),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export const OfficeTextRangeSchema = z
  .object({
    type: z.literal('text_range'),
    start: OfficeTextPositionSchema,
    end: OfficeTextPositionSchema,
  })
  .strict()
  .superRefine((range, context) => {
    if (
      range.start.blockId === range.end.blockId &&
      range.start.offset > range.end.offset
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'text range start must not follow its end',
      });
    }
    if (
      range.start.blockId === range.end.blockId &&
      range.start.offset === range.end.offset
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'text range must not be empty',
      });
    }
  });

export const OfficeTextEditRangeSchema = z
  .object({
    type: z.literal('text_range'),
    start: OfficeTextPositionSchema,
    end: OfficeTextPositionSchema,
  })
  .strict()
  .superRefine((range, context) => {
    if (
      range.start.blockId === range.end.blockId &&
      range.start.offset > range.end.offset
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'text range start must not follow its end',
      });
    }
  });

export const OfficeDocumentTextFormatSchema = z
  .object({
    fontFamily: boundedString(256).optional(),
    fontSizePt: z
      .number()
      .positive()
      .max(400)
      .refine(value => Number.isInteger(value * 2), {
        message: 'font size must use half-point increments',
      })
      .optional(),
    textColor: hexColor.optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z
      .union([
        z.literal(false),
        z
          .object({
            style: z.enum(['single', 'double', 'dotted', 'dashed', 'wavy']),
            color: hexColor.optional(),
          })
          .strict(),
      ])
      .optional(),
    paragraphStyleId: boundedString(256).optional(),
  })
  .strict()
  .refine(format => Object.keys(format).length > 0, {
    message: 'at least one text format property is required',
  });

export const OfficeDocumentFormatTextCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.text.format'),
    target: OfficeTextRangeSchema,
    format: OfficeDocumentTextFormatSchema,
  })
  .strict();

export const OfficeDocumentReplaceTextCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.text.replace'),
    target: OfficeTextEditRangeSchema,
    text: z.string().max(4 * 1024 * 1024),
  })
  .strict();

export const OfficeDocumentParagraphTargetSchema = z
  .object({
    type: z.literal('paragraph'),
    blockId: boundedString(512),
  })
  .strict();

export const OfficeDocumentParagraphFormatSchema = z
  .object({
    alignment: z
      .enum(['left', 'center', 'right', 'both', 'distribute'])
      .optional(),
    spaceBeforePt: z.number().finite().min(0).max(10_000).optional(),
    spaceAfterPt: z.number().finite().min(0).max(10_000).optional(),
    lineSpacingPt: z.number().finite().positive().max(10_000).optional(),
    leftIndentPt: z.number().finite().min(-10_000).max(10_000).optional(),
    rightIndentPt: z.number().finite().min(-10_000).max(10_000).optional(),
    firstLineIndentPt: z.number().finite().min(-10_000).max(10_000).optional(),
    keepNext: z.boolean().optional(),
    keepLines: z.boolean().optional(),
    pageBreakBefore: z.boolean().optional(),
    outlineLevel: z.number().int().min(0).max(9).nullable().optional(),
    numbering: z
      .union([
        z.literal(false),
        z
          .object({
            id: boundedString(64),
            level: z.number().int().min(0).max(8),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine(format => Object.keys(format).length > 0, {
    message: 'at least one paragraph format property is required',
  });

export const OfficeDocumentFormatParagraphCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.paragraph.format'),
    target: OfficeDocumentParagraphTargetSchema,
    format: OfficeDocumentParagraphFormatSchema,
  })
  .strict();

export const OfficeDocumentInsertBreakCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.break.insert'),
    target: OfficeTextPositionSchema,
    breakType: z.enum(['line', 'page', 'column']),
  })
  .strict();

export const OfficeDocumentInsertSectionCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.section.insert'),
    target: OfficeDocumentParagraphTargetSchema,
    sectionType: z.enum(['nextPage', 'continuous', 'evenPage', 'oddPage']),
    sourceSectionIndex: z.number().int().nonnegative().max(10_000).optional(),
  })
  .strict();

export const OfficeDocumentInsertTableCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.table.insert'),
    afterBlockId: boundedString(512),
    rows: z.number().int().min(1).max(100),
    columns: z.number().int().min(1).max(100),
    cells: z
      .array(z.array(z.string().max(64 * 1024)).max(100))
      .max(100)
      .optional(),
  })
  .strict();

export const OfficeDocumentPageLayoutCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.page.layout.set'),
    sectionIndex: z.number().int().nonnegative().max(10_000),
    layout: z
      .object({
        widthPt: z.number().finite().positive().max(100_000).optional(),
        heightPt: z.number().finite().positive().max(100_000).optional(),
        orientation: z.enum(['portrait', 'landscape']).optional(),
        marginTopPt: z.number().finite().min(0).max(10_000).optional(),
        marginRightPt: z.number().finite().min(0).max(10_000).optional(),
        marginBottomPt: z.number().finite().min(0).max(10_000).optional(),
        marginLeftPt: z.number().finite().min(0).max(10_000).optional(),
        headerPt: z.number().finite().min(0).max(10_000).optional(),
        footerPt: z.number().finite().min(0).max(10_000).optional(),
        gutterPt: z.number().finite().min(0).max(10_000).optional(),
        columns: z.number().int().min(1).max(64).optional(),
        titlePage: z.boolean().optional(),
      })
      .strict()
      .refine(layout => Object.keys(layout).length > 0, {
        message: 'at least one page layout property is required',
      }),
  })
  .strict();

export const OfficeDocumentHeaderFooterTextCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.header_footer.text.set'),
    sectionIndex: z.number().int().nonnegative().max(10_000),
    storyKind: z.enum(['header', 'footer']),
    storyType: z.enum(['default', 'first', 'even']),
    text: z.string().max(4 * 1024 * 1024),
  })
  .strict();

export const OfficeDocumentContentControlTextCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.content_control.text.set'),
    contentControlId: boundedString(512),
    text: z.string().max(4 * 1024 * 1024),
  })
  .strict();

export const OfficeDocumentReviewResolveCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.review.resolve'),
    action: z.enum(['accept', 'reject']),
    changeIds: z.array(boundedString(512)).min(1).max(100_000).optional(),
  })
  .strict();

export const OfficeDocumentMailMergeCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.mail_merge.apply'),
    values: z
      .record(boundedString(256), z.string().max(4 * 1024 * 1024))
      .refine(values => Object.keys(values).length > 0, {
        message: 'mail merge requires at least one value',
      }),
  })
  .strict();

export const OfficeDocumentInsertObjectCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.document.object.insert'),
    target: OfficeTextPositionSchema,
    object: z.union([
      z
        .object({
          type: z.literal('image'),
          mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif']),
          dataBase64: boundedBase64(12 * 1024 * 1024),
          widthPt: z.number().finite().positive().max(100_000),
          heightPt: z.number().finite().positive().max(100_000),
          name: boundedString(512).optional(),
          description: z.string().max(2048).optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal('shape'),
          shape: z.enum(['rectangle', 'roundedRectangle', 'ellipse', 'line']),
          widthPt: z.number().finite().positive().max(100_000),
          heightPt: z.number().finite().positive().max(100_000),
          text: z
            .string()
            .max(64 * 1024)
            .optional(),
          fillColor: hexColor.optional(),
          lineColor: hexColor.optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal('equation'),
          linearText: boundedString(64 * 1024),
        })
        .strict(),
      z
        .object({
          type: z.literal('chart'),
          chartType: z.enum(['column', 'bar', 'line', 'pie']),
          title: z.string().max(1024).optional(),
          categories: z.array(z.string().max(1024)).min(1).max(10_000),
          series: z
            .array(
              z
                .object({
                  name: boundedString(1024),
                  values: z.array(z.number().finite()).min(1).max(10_000),
                })
                .strict()
            )
            .min(1)
            .max(256),
          widthPt: z.number().finite().positive().max(100_000),
          heightPt: z.number().finite().positive().max(100_000),
        })
        .strict()
        .superRefine((chart, context) => {
          if (
            chart.series.some(
              series => series.values.length !== chart.categories.length
            )
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'chart series length must match categories length',
            });
          }
        }),
    ]),
  })
  .strict();

export const OfficeWorkbookCellTargetSchema = z
  .object({
    type: z.literal('cell'),
    sheetId: boundedString(256),
    address: z
      .string()
      .trim()
      .regex(/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i)
      .max(16),
  })
  .strict();

export const OfficeWorkbookCellInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('blank') }).strict(),
  z
    .object({
      type: z.literal('string'),
      value: z.string().max(4 * 1024 * 1024),
    })
    .strict(),
  z.object({ type: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('boolean'), value: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('formula'),
      formula: z.string().trim().min(1).max(32_768),
    })
    .strict(),
]);

export const OfficeWorkbookSetCellCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.cell.set'),
    target: OfficeWorkbookCellTargetSchema,
    input: OfficeWorkbookCellInputSchema,
    styleIndex: z.number().int().nonnegative().max(100_000).optional(),
  })
  .strict();

const cellRange = z
  .string()
  .trim()
  .regex(/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}:\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i)
  .max(40);

export const OfficeWorkbookRangeTargetSchema = z
  .object({
    type: z.literal('cell_range'),
    sheetId: boundedString(256),
    range: cellRange,
  })
  .strict();

export const OfficeWorkbookFormatRangeCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.range.format'),
    target: OfficeWorkbookRangeTargetSchema,
    format: z
      .object({
        fontFamily: boundedString(256).optional(),
        fontSizePt: z.number().finite().positive().max(400).optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
        textColor: hexColor.optional(),
        fillColor: hexColor.optional(),
        numberFormatId: z
          .number()
          .int()
          .nonnegative()
          .max(1_000_000)
          .optional(),
        horizontalAlignment: z
          .enum(['general', 'left', 'center', 'right', 'fill', 'justify'])
          .optional(),
        verticalAlignment: z.enum(['top', 'center', 'bottom']).optional(),
        wrapText: z.boolean().optional(),
      })
      .strict()
      .refine(format => Object.keys(format).length > 0, {
        message: 'at least one range format property is required',
      }),
  })
  .strict();

export const OfficeWorkbookMergeCellsCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.cells.merge.set'),
    target: OfficeWorkbookRangeTargetSchema,
    merged: z.boolean(),
  })
  .strict();

export const OfficeWorkbookRowPropertiesCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.row.properties.set'),
    sheetId: boundedString(256),
    row: z.number().int().min(1).max(1_048_576),
    heightPt: z.number().finite().positive().max(409).nullable().optional(),
    hidden: z.boolean().optional(),
  })
  .strict()
  .refine(
    command => command.heightPt !== undefined || command.hidden !== undefined,
    { message: 'at least one row property is required' }
  );

export const OfficeWorkbookColumnPropertiesCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.column.properties.set'),
    sheetId: boundedString(256),
    startColumn: z.number().int().min(1).max(16_384),
    endColumn: z.number().int().min(1).max(16_384),
    width: z.number().finite().positive().max(255).nullable().optional(),
    hidden: z.boolean().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.startColumn > command.endColumn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'column range start must not follow its end',
      });
    }
    if (command.width === undefined && command.hidden === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one column property is required',
      });
    }
  });

export const OfficeWorkbookFilterCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.filter.set'),
    target: OfficeWorkbookRangeTargetSchema,
    criteria: z
      .array(
        z
          .object({
            columnIndex: z.number().int().nonnegative().max(16_383),
            values: z
              .array(z.string().max(64 * 1024))
              .min(1)
              .max(10_000),
          })
          .strict()
      )
      .max(16_384),
  })
  .strict();

export const OfficeWorkbookValidationCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.validation.set'),
    target: OfficeWorkbookRangeTargetSchema,
    validation: z.union([
      z.literal(false),
      z
        .object({
          type: z.enum([
            'list',
            'whole',
            'decimal',
            'date',
            'time',
            'textLength',
            'custom',
          ]),
          operator: z
            .enum([
              'between',
              'notBetween',
              'equal',
              'notEqual',
              'lessThan',
              'lessThanOrEqual',
              'greaterThan',
              'greaterThanOrEqual',
            ])
            .optional(),
          formula1: boundedString(32_768),
          formula2: z.string().max(32_768).optional(),
          allowBlank: z.boolean().optional(),
          promptTitle: z.string().max(255).optional(),
          prompt: z.string().max(255).optional(),
          errorTitle: z.string().max(255).optional(),
          error: z.string().max(255).optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const OfficeWorkbookSheetAddCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.sheet.add'),
    name: boundedString(31).refine(value => !/[\\/*?:[\]]/.test(value), {
      message: 'worksheet name contains an invalid character',
    }),
    afterSheetId: boundedString(256).optional(),
  })
  .strict();

export const OfficeWorkbookSheetDeleteCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.sheet.delete'),
    sheetId: boundedString(256),
  })
  .strict();

export const OfficeWorkbookSheetRenameCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.sheet.rename'),
    sheetId: boundedString(256),
    name: boundedString(31).refine(value => !/[\\/*?:[\]]/.test(value), {
      message: 'worksheet name contains an invalid character',
    }),
  })
  .strict();

export const OfficeWorkbookSheetReorderCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.sheets.reorder'),
    sheetIds: z.array(boundedString(256)).min(1).max(1024),
  })
  .strict();

export const OfficeWorkbookDimensionChangeCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.dimension.change'),
    sheetId: boundedString(256),
    axis: z.enum(['row', 'column']),
    action: z.enum(['insert', 'delete']),
    index: z.number().int().min(1).max(1_048_576),
    count: z.number().int().min(1).max(10_000),
  })
  .strict();

export const OfficeWorkbookSetTableCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.table.set'),
    target: OfficeWorkbookRangeTargetSchema,
    table: z.union([
      z.literal(false),
      z
        .object({
          name: boundedString(255).regex(/^[A-Za-z_][A-Za-z0-9_.]*$/),
          displayName: boundedString(255)
            .regex(/^[A-Za-z_][A-Za-z0-9_.]*$/)
            .optional(),
          styleName: boundedString(255).optional(),
          totalsRow: z.boolean().optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const OfficeWorkbookAddChartCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.chart.add'),
    sheetId: boundedString(256),
    chartType: z.enum(['column', 'bar', 'line', 'pie']),
    title: z.string().max(1024).optional(),
    categoryRange: boundedString(1024),
    series: z
      .array(
        z
          .object({
            name: boundedString(1024),
            valueRange: boundedString(1024),
          })
          .strict()
      )
      .min(1)
      .max(256),
    anchor: z
      .object({
        fromCell: z
          .string()
          .trim()
          .regex(/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i),
        toCell: z
          .string()
          .trim()
          .regex(/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i),
      })
      .strict(),
  })
  .strict();

export const OfficeWorkbookDeleteChartCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.workbook.chart.delete'),
    sheetId: boundedString(256),
    chartId: boundedString(512),
  })
  .strict();

export const OfficePresentationShapeTargetSchema = z
  .object({
    type: z.literal('shape'),
    slideId: boundedString(256),
    shapeId: boundedString(256),
  })
  .strict();

export const OfficePresentationSetShapeTextCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.shape.text.set'),
    target: OfficePresentationShapeTargetSchema,
    text: z.string().max(4 * 1024 * 1024),
  })
  .strict();

const pointCoordinate = z.number().finite().min(-10_000_000).max(10_000_000);

export const OfficePresentationSetShapeGeometryCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.shape.geometry.set'),
    target: OfficePresentationShapeTargetSchema,
    geometry: z
      .object({
        xPt: pointCoordinate,
        yPt: pointCoordinate,
        widthPt: z.number().finite().positive().max(10_000_000),
        heightPt: z.number().finite().positive().max(10_000_000),
        rotationDeg: z.number().finite().min(-360_000).max(360_000).optional(),
      })
      .strict(),
  })
  .strict();

const presentationGeometry = z
  .object({
    xPt: pointCoordinate,
    yPt: pointCoordinate,
    widthPt: z.number().finite().positive().max(10_000_000),
    heightPt: z.number().finite().positive().max(10_000_000),
    rotationDeg: z.number().finite().min(-360_000).max(360_000).optional(),
  })
  .strict();

export const OfficePresentationAddShapeCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.shape.add'),
    slideId: boundedString(256),
    shape: z.enum(['rectangle', 'roundedRectangle', 'ellipse', 'line']),
    geometry: presentationGeometry,
    text: z
      .string()
      .max(4 * 1024 * 1024)
      .optional(),
    fillColor: hexColor.optional(),
    lineColor: hexColor.optional(),
  })
  .strict();

export const OfficePresentationDeleteShapeCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.shape.delete'),
    target: OfficePresentationShapeTargetSchema,
  })
  .strict();

export const OfficePresentationAddImageCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.image.add'),
    slideId: boundedString(256),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif']),
    dataBase64: boundedBase64(12 * 1024 * 1024),
    geometry: presentationGeometry,
    name: boundedString(512).optional(),
    description: z.string().max(2048).optional(),
  })
  .strict();

export const OfficePresentationAddSlideCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.slide.add'),
    afterSlideId: boundedString(256).optional(),
    title: z.string().max(4096).optional(),
  })
  .strict();

export const OfficePresentationDuplicateSlideCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.slide.duplicate'),
    slideId: boundedString(256),
  })
  .strict();

export const OfficePresentationDeleteSlideCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.slide.delete'),
    slideId: boundedString(256),
  })
  .strict();

export const OfficePresentationReorderSlidesCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.slides.reorder'),
    slideIds: z.array(boundedString(256)).min(1).max(10_000),
  })
  .strict();

export const OfficePresentationSetNotesCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.notes.text.set'),
    slideId: boundedString(256),
    text: z.string().max(4 * 1024 * 1024),
  })
  .strict();

export const OfficePresentationSetThemeColorCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.presentation.theme.color.set'),
    masterId: boundedString(256),
    slot: z.enum([
      'dk1',
      'lt1',
      'dk2',
      'lt2',
      'accent1',
      'accent2',
      'accent3',
      'accent4',
      'accent5',
      'accent6',
      'hlink',
      'folHlink',
    ]),
    color: hexColor,
  })
  .strict();

export const OfficePdfPageTargetSchema = z
  .object({
    type: z.literal('page'),
    pageIndex: z.number().int().nonnegative().max(100_000),
  })
  .strict();

export const OfficePdfAddAnnotationCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.annotation.add'),
    target: OfficePdfPageTargetSchema,
    annotation: z
      .object({
        subtype: z.enum([
          'text',
          'highlight',
          'underline',
          'strikeout',
          'square',
        ]),
        rect: z
          .object({
            xPt: pointCoordinate,
            yPt: pointCoordinate,
            widthPt: z.number().finite().positive().max(10_000_000),
            heightPt: z.number().finite().positive().max(10_000_000),
          })
          .strict(),
        contents: z.string().max(64 * 1024),
        color: hexColor.optional(),
      })
      .strict(),
  })
  .strict();

export const OfficePdfSetFormFieldCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.form.set'),
    fieldName: boundedString(2048),
    value: z.union([
      z.string().max(4 * 1024 * 1024),
      z.boolean(),
      z.array(z.string().max(64 * 1024)).max(10_000),
    ]),
  })
  .strict();

export const OfficePdfRotatePageCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.page.rotate'),
    target: OfficePdfPageTargetSchema,
    rotationDeg: z.union([
      z.literal(0),
      z.literal(90),
      z.literal(180),
      z.literal(270),
    ]),
  })
  .strict();

export const OfficePdfDeletePageCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.page.delete'),
    target: OfficePdfPageTargetSchema,
  })
  .strict();

export const OfficePdfReorderPagesCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.pages.reorder'),
    order: z
      .array(z.number().int().nonnegative().max(100_000))
      .min(1)
      .max(100_000),
  })
  .strict();

export const OfficePdfUpdateAnnotationCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.annotation.update'),
    annotationId: boundedString(2048),
    contents: z
      .string()
      .max(64 * 1024)
      .optional(),
    color: hexColor.optional(),
    rect: z
      .object({
        xPt: pointCoordinate,
        yPt: pointCoordinate,
        widthPt: z.number().finite().positive().max(10_000_000),
        heightPt: z.number().finite().positive().max(10_000_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    command =>
      command.contents !== undefined ||
      command.color !== undefined ||
      command.rect !== undefined,
    { message: 'at least one annotation property is required' }
  );

export const OfficePdfDeleteAnnotationCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.annotation.delete'),
    annotationId: boundedString(2048),
  })
  .strict();

export const OfficePdfAddSignatureAppearanceCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.signature.appearance.add'),
    target: OfficePdfPageTargetSchema,
    rect: z
      .object({
        xPt: pointCoordinate,
        yPt: pointCoordinate,
        widthPt: z.number().finite().positive().max(10_000_000),
        heightPt: z.number().finite().positive().max(10_000_000),
      })
      .strict(),
    signerName: boundedString(1024),
    reason: z.string().max(2048).optional(),
    imagePngBase64: boundedBase64(12 * 1024 * 1024).optional(),
  })
  .strict();

export const OfficePdfApplyRedactionCommandSchema = z
  .object({
    version: z.literal('localmind-office-command/v1'),
    commandId: boundedString(256),
    idempotencyKey: boundedString(256),
    artifactId: boundedString(512),
    expectedRevisionId: boundedString(512),
    source: z.enum(['user', 'ai', 'system']),
    operation: z.literal('office.pdf.redaction.apply'),
    target: OfficePdfPageTargetSchema,
    flattenedPagePngBase64: boundedBase64(24 * 1024 * 1024),
    rects: z
      .array(
        z
          .object({
            xPt: pointCoordinate,
            yPt: pointCoordinate,
            widthPt: z.number().finite().positive().max(10_000_000),
            heightPt: z.number().finite().positive().max(10_000_000),
          })
          .strict()
      )
      .min(1)
      .max(10_000),
  })
  .strict();

export const OfficeCommandSchema = z.union([
  OfficeDocumentFormatTextCommandSchema,
  OfficeDocumentReplaceTextCommandSchema,
  OfficeDocumentFormatParagraphCommandSchema,
  OfficeDocumentInsertBreakCommandSchema,
  OfficeDocumentInsertSectionCommandSchema,
  OfficeDocumentInsertTableCommandSchema,
  OfficeDocumentPageLayoutCommandSchema,
  OfficeDocumentHeaderFooterTextCommandSchema,
  OfficeDocumentContentControlTextCommandSchema,
  OfficeDocumentReviewResolveCommandSchema,
  OfficeDocumentMailMergeCommandSchema,
  OfficeDocumentInsertObjectCommandSchema,
  OfficeWorkbookSetCellCommandSchema,
  OfficeWorkbookFormatRangeCommandSchema,
  OfficeWorkbookMergeCellsCommandSchema,
  OfficeWorkbookRowPropertiesCommandSchema,
  OfficeWorkbookColumnPropertiesCommandSchema,
  OfficeWorkbookFilterCommandSchema,
  OfficeWorkbookValidationCommandSchema,
  OfficeWorkbookSheetAddCommandSchema,
  OfficeWorkbookSheetDeleteCommandSchema,
  OfficeWorkbookSheetRenameCommandSchema,
  OfficeWorkbookSheetReorderCommandSchema,
  OfficeWorkbookDimensionChangeCommandSchema,
  OfficeWorkbookSetTableCommandSchema,
  OfficeWorkbookAddChartCommandSchema,
  OfficeWorkbookDeleteChartCommandSchema,
  OfficePresentationSetShapeTextCommandSchema,
  OfficePresentationSetShapeGeometryCommandSchema,
  OfficePresentationAddShapeCommandSchema,
  OfficePresentationDeleteShapeCommandSchema,
  OfficePresentationAddImageCommandSchema,
  OfficePresentationAddSlideCommandSchema,
  OfficePresentationDuplicateSlideCommandSchema,
  OfficePresentationDeleteSlideCommandSchema,
  OfficePresentationReorderSlidesCommandSchema,
  OfficePresentationSetNotesCommandSchema,
  OfficePresentationSetThemeColorCommandSchema,
  OfficePdfAddAnnotationCommandSchema,
  OfficePdfUpdateAnnotationCommandSchema,
  OfficePdfDeleteAnnotationCommandSchema,
  OfficePdfSetFormFieldCommandSchema,
  OfficePdfRotatePageCommandSchema,
  OfficePdfDeletePageCommandSchema,
  OfficePdfReorderPagesCommandSchema,
  OfficePdfAddSignatureAppearanceCommandSchema,
  OfficePdfApplyRedactionCommandSchema,
]);

export type OfficeDocumentFormatTextCommand = z.infer<
  typeof OfficeDocumentFormatTextCommandSchema
>;
export type OfficeDocumentReplaceTextCommand = z.infer<
  typeof OfficeDocumentReplaceTextCommandSchema
>;
export type OfficeDocumentFormatParagraphCommand = z.infer<
  typeof OfficeDocumentFormatParagraphCommandSchema
>;
export type OfficeDocumentInsertBreakCommand = z.infer<
  typeof OfficeDocumentInsertBreakCommandSchema
>;
export type OfficeDocumentInsertSectionCommand = z.infer<
  typeof OfficeDocumentInsertSectionCommandSchema
>;
export type OfficeDocumentInsertTableCommand = z.infer<
  typeof OfficeDocumentInsertTableCommandSchema
>;
export type OfficeDocumentPageLayoutCommand = z.infer<
  typeof OfficeDocumentPageLayoutCommandSchema
>;
export type OfficeDocumentHeaderFooterTextCommand = z.infer<
  typeof OfficeDocumentHeaderFooterTextCommandSchema
>;
export type OfficeDocumentContentControlTextCommand = z.infer<
  typeof OfficeDocumentContentControlTextCommandSchema
>;
export type OfficeDocumentReviewResolveCommand = z.infer<
  typeof OfficeDocumentReviewResolveCommandSchema
>;
export type OfficeDocumentMailMergeCommand = z.infer<
  typeof OfficeDocumentMailMergeCommandSchema
>;
export type OfficeDocumentInsertObjectCommand = z.infer<
  typeof OfficeDocumentInsertObjectCommandSchema
>;
export type OfficeWorkbookSetCellCommand = z.infer<
  typeof OfficeWorkbookSetCellCommandSchema
>;
export type OfficeWorkbookFormatRangeCommand = z.infer<
  typeof OfficeWorkbookFormatRangeCommandSchema
>;
export type OfficeWorkbookMergeCellsCommand = z.infer<
  typeof OfficeWorkbookMergeCellsCommandSchema
>;
export type OfficeWorkbookRowPropertiesCommand = z.infer<
  typeof OfficeWorkbookRowPropertiesCommandSchema
>;
export type OfficeWorkbookColumnPropertiesCommand = z.infer<
  typeof OfficeWorkbookColumnPropertiesCommandSchema
>;
export type OfficeWorkbookFilterCommand = z.infer<
  typeof OfficeWorkbookFilterCommandSchema
>;
export type OfficeWorkbookValidationCommand = z.infer<
  typeof OfficeWorkbookValidationCommandSchema
>;
export type OfficeWorkbookSheetAddCommand = z.infer<
  typeof OfficeWorkbookSheetAddCommandSchema
>;
export type OfficeWorkbookSheetDeleteCommand = z.infer<
  typeof OfficeWorkbookSheetDeleteCommandSchema
>;
export type OfficeWorkbookSheetRenameCommand = z.infer<
  typeof OfficeWorkbookSheetRenameCommandSchema
>;
export type OfficeWorkbookSheetReorderCommand = z.infer<
  typeof OfficeWorkbookSheetReorderCommandSchema
>;
export type OfficeWorkbookDimensionChangeCommand = z.infer<
  typeof OfficeWorkbookDimensionChangeCommandSchema
>;
export type OfficeWorkbookSetTableCommand = z.infer<
  typeof OfficeWorkbookSetTableCommandSchema
>;
export type OfficeWorkbookAddChartCommand = z.infer<
  typeof OfficeWorkbookAddChartCommandSchema
>;
export type OfficeWorkbookDeleteChartCommand = z.infer<
  typeof OfficeWorkbookDeleteChartCommandSchema
>;
export type OfficePresentationSetShapeTextCommand = z.infer<
  typeof OfficePresentationSetShapeTextCommandSchema
>;
export type OfficePresentationSetShapeGeometryCommand = z.infer<
  typeof OfficePresentationSetShapeGeometryCommandSchema
>;
export type OfficePresentationAddShapeCommand = z.infer<
  typeof OfficePresentationAddShapeCommandSchema
>;
export type OfficePresentationDeleteShapeCommand = z.infer<
  typeof OfficePresentationDeleteShapeCommandSchema
>;
export type OfficePresentationAddImageCommand = z.infer<
  typeof OfficePresentationAddImageCommandSchema
>;
export type OfficePresentationAddSlideCommand = z.infer<
  typeof OfficePresentationAddSlideCommandSchema
>;
export type OfficePresentationDuplicateSlideCommand = z.infer<
  typeof OfficePresentationDuplicateSlideCommandSchema
>;
export type OfficePresentationDeleteSlideCommand = z.infer<
  typeof OfficePresentationDeleteSlideCommandSchema
>;
export type OfficePresentationReorderSlidesCommand = z.infer<
  typeof OfficePresentationReorderSlidesCommandSchema
>;
export type OfficePresentationSetNotesCommand = z.infer<
  typeof OfficePresentationSetNotesCommandSchema
>;
export type OfficePresentationSetThemeColorCommand = z.infer<
  typeof OfficePresentationSetThemeColorCommandSchema
>;
export type OfficePdfAddAnnotationCommand = z.infer<
  typeof OfficePdfAddAnnotationCommandSchema
>;
export type OfficePdfSetFormFieldCommand = z.infer<
  typeof OfficePdfSetFormFieldCommandSchema
>;
export type OfficePdfRotatePageCommand = z.infer<
  typeof OfficePdfRotatePageCommandSchema
>;
export type OfficePdfDeletePageCommand = z.infer<
  typeof OfficePdfDeletePageCommandSchema
>;
export type OfficePdfReorderPagesCommand = z.infer<
  typeof OfficePdfReorderPagesCommandSchema
>;
export type OfficePdfUpdateAnnotationCommand = z.infer<
  typeof OfficePdfUpdateAnnotationCommandSchema
>;
export type OfficePdfDeleteAnnotationCommand = z.infer<
  typeof OfficePdfDeleteAnnotationCommandSchema
>;
export type OfficePdfAddSignatureAppearanceCommand = z.infer<
  typeof OfficePdfAddSignatureAppearanceCommandSchema
>;
export type OfficePdfApplyRedactionCommand = z.infer<
  typeof OfficePdfApplyRedactionCommandSchema
>;

export type OfficeCommand =
  | OfficeDocumentFormatTextCommand
  | OfficeDocumentReplaceTextCommand
  | OfficeDocumentFormatParagraphCommand
  | OfficeDocumentInsertBreakCommand
  | OfficeDocumentInsertSectionCommand
  | OfficeDocumentInsertTableCommand
  | OfficeDocumentPageLayoutCommand
  | OfficeDocumentHeaderFooterTextCommand
  | OfficeDocumentContentControlTextCommand
  | OfficeDocumentReviewResolveCommand
  | OfficeDocumentMailMergeCommand
  | OfficeDocumentInsertObjectCommand
  | OfficeWorkbookSetCellCommand
  | OfficeWorkbookFormatRangeCommand
  | OfficeWorkbookMergeCellsCommand
  | OfficeWorkbookRowPropertiesCommand
  | OfficeWorkbookColumnPropertiesCommand
  | OfficeWorkbookFilterCommand
  | OfficeWorkbookValidationCommand
  | OfficeWorkbookSheetAddCommand
  | OfficeWorkbookSheetDeleteCommand
  | OfficeWorkbookSheetRenameCommand
  | OfficeWorkbookSheetReorderCommand
  | OfficeWorkbookDimensionChangeCommand
  | OfficeWorkbookSetTableCommand
  | OfficeWorkbookAddChartCommand
  | OfficeWorkbookDeleteChartCommand
  | OfficePresentationSetShapeTextCommand
  | OfficePresentationSetShapeGeometryCommand
  | OfficePresentationAddShapeCommand
  | OfficePresentationDeleteShapeCommand
  | OfficePresentationAddImageCommand
  | OfficePresentationAddSlideCommand
  | OfficePresentationDuplicateSlideCommand
  | OfficePresentationDeleteSlideCommand
  | OfficePresentationReorderSlidesCommand
  | OfficePresentationSetNotesCommand
  | OfficePresentationSetThemeColorCommand
  | OfficePdfAddAnnotationCommand
  | OfficePdfUpdateAnnotationCommand
  | OfficePdfDeleteAnnotationCommand
  | OfficePdfSetFormFieldCommand
  | OfficePdfRotatePageCommand
  | OfficePdfDeletePageCommand
  | OfficePdfReorderPagesCommand
  | OfficePdfAddSignatureAppearanceCommand
  | OfficePdfApplyRedactionCommand;

export function parseOfficeCommand(input: unknown): OfficeCommand {
  return OfficeCommandSchema.parse(input);
}
