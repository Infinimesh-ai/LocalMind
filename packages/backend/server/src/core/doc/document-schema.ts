import { z } from 'zod';

import { documentDatabaseCommand } from './document-database-schema';
import { isPassiveDocumentMarkup } from './document-markup';
import { documentSurfaceCommand } from './document-surface-schema';

export const DOCUMENT_CONTRACT_VERSION = 'localmind-document-mcp/v2' as const;
export const documentId = z.string().min(1).max(256);
const shortText = z.string().max(8192);
const text = z.string().max(1024 * 1024);
const number = z.number().finite();
const position = number.int().nonnegative();
const boolean = z.boolean();
const align = z.enum(['left', 'center', 'right']);
const color = z.union([
  shortText,
  z.object({ normal: shortText }).strict(),
  z.object({ light: shortText, dark: shortText }).strict(),
]);
const geometry = {
  xywh: z
    .string()
    .max(256)
    .refine(value => {
      try {
        const bounds: unknown = JSON.parse(value);
        return (
          Array.isArray(bounds) &&
          bounds.length === 4 &&
          bounds.every(
            value => typeof value === 'number' && Number.isFinite(value)
          ) &&
          bounds[2] >= 0 &&
          bounds[3] >= 0
        );
      } catch {
        return false;
      }
    }, 'Expected finite [x,y,width,height] bounds'),
  index: shortText,
  lockedBySelf: boolean,
};
const gfx = { ...geometry, rotate: number };
const style = z.enum([
  'vertical',
  'horizontal',
  'list',
  'cube',
  'cubeThick',
  'horizontalThin',
  'video',
  'figma',
  'html',
  'syncedDoc',
  'citation',
  'pdf',
]);
const card = {
  ...gfx,
  style,
  caption: text.nullable(),
  title: shortText.nullable(),
  description: text.nullable(),
};
const url = z
  .string()
  .max(8192)
  .refine(value => {
    if (!value) return true;
    try {
      return ['http:', 'https:', 'mailto:', 'tel:'].includes(
        new URL(value).protocol
      );
    } catch {
      return false;
    }
  }, 'Unsupported URL scheme');
const icon = z.discriminatedUnion('type', [
  z.object({ type: z.literal('emoji'), unicode: shortText }).strict(),
  z
    .object({
      type: z.literal('affine-icon'),
      name: shortText,
      color: shortText.optional(),
    })
    .strict(),
]);

// Only user-editable properties belong here. IDs, provenance, ownership,
// references, comment anchors and text have separate domain commands.
export const documentBlockProperties = {
  'affine:page': z.object({}).strict(),
  'affine:surface': z.object({}).strict(),
  'affine:paragraph': z
    .object({
      type: z.enum(['text', 'quote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
      textAlign: align,
      collapsed: boolean,
    })
    .partial()
    .strict(),
  'affine:list': z
    .object({
      type: z.enum(['bulleted', 'numbered', 'todo', 'toggle']),
      textAlign: align,
      checked: boolean,
      collapsed: boolean,
      order: position.nullable(),
    })
    .partial()
    .strict(),
  'affine:code': z
    .object({
      language: shortText.nullable(),
      wrap: boolean,
      caption: text,
      preview: boolean,
      lineNumber: boolean,
      collapsed: boolean,
    })
    .partial()
    .strict(),
  'affine:divider': z.object({}).strict(),
  'affine:note': z
    .object({
      ...geometry,
      background: color,
      hidden: boolean,
      displayMode: z.enum(['both', 'doc', 'edgeless']),
      edgeless: z
        .object({
          style: z
            .object({
              borderRadius: number.nonnegative(),
              borderSize: number.nonnegative(),
              borderStyle: z.enum(['none', 'solid', 'dash']),
              shadowType: shortText,
            })
            .strict(),
          collapse: boolean.optional(),
          collapsedHeight: number.nonnegative().optional(),
          scale: number.positive().optional(),
        })
        .strict(),
    })
    .partial()
    .strict(),
  'affine:callout': z
    .object({ icon, backgroundColorName: shortText })
    .partial()
    .strict(),
  'affine:table': z.object({ textAlign: align }).partial().strict(),
  'affine:database': z.object({}).strict(),
  'affine:data-view': z.object({ title: shortText }).partial().strict(),
  'affine:image': z
    .object({
      ...gfx,
      caption: text,
      width: number.nonnegative(),
      height: number.nonnegative(),
      textAlign: align,
    })
    .partial()
    .strict(),
  'affine:attachment': z
    .object({
      ...gfx,
      name: shortText,
      caption: text,
      embed: boolean,
      style,
      footnoteIdentifier: shortText.nullable(),
    })
    .partial()
    .strict(),
  'affine:bookmark': z
    .object({
      ...card,
      url,
      image: url.nullable(),
      icon: url.nullable(),
      footnoteIdentifier: shortText.nullable(),
    })
    .partial()
    .strict(),
  'affine:latex': z
    .object({ ...gfx, scale: number.positive(), latex: text })
    .partial()
    .strict(),
  'affine:surface-ref': z.object({ caption: text }).partial().strict(),
  'affine:frame': z
    .object({ ...geometry, background: color, presentationIndex: shortText })
    .partial()
    .strict(),
  'affine:edgeless-text': z
    .object({
      ...gfx,
      scale: number.positive(),
      hasMaxWidth: boolean,
      color,
      fontFamily: shortText,
      fontStyle: z.enum(['normal', 'italic']),
      fontWeight: z.enum(['300', '400', '500', '600', '700']),
      textAlign: align,
    })
    .partial()
    .strict(),
  'affine:embed-linked-doc': z
    .object({ ...card, footnoteIdentifier: shortText.nullable() })
    .partial()
    .strict(),
  'affine:embed-synced-doc': z
    .object({
      ...card,
      scale: number.positive(),
      preFoldHeight: number.nonnegative(),
    })
    .partial()
    .strict(),
  'affine:embed-figma': z
    .object({ ...card, url })
    .partial()
    .strict(),
  'affine:embed-loom': z
    .object({
      ...card,
      url,
      image: url.nullable(),
      videoId: shortText.nullable(),
    })
    .partial()
    .strict(),
  'affine:embed-youtube': z
    .object({
      ...card,
      url,
      image: url.nullable(),
      creator: shortText.nullable(),
      creatorUrl: url.nullable(),
      creatorImage: url.nullable(),
      videoId: shortText.nullable(),
    })
    .partial()
    .strict(),
  'affine:embed-github': z
    .object({
      ...card,
      url,
      owner: shortText,
      repo: shortText,
      githubType: z.enum(['issue', 'pull_request']),
      githubId: shortText,
      image: url.nullable(),
      status: shortText.nullable(),
      statusReason: shortText.nullable(),
      createdAt: shortText.nullable(),
      assignees: z.array(shortText).max(100).nullable(),
    })
    .partial()
    .strict(),
  'affine:embed-html': z
    .object({
      ...card,
      html: text.refine(
        isPassiveDocumentMarkup,
        'Active markup requires a different content contract'
      ),
      design: text,
    })
    .partial()
    .strict(),
  'affine:embed-iframe': z
    .object({
      ...geometry,
      url,
      iframeUrl: url,
      width: number.positive(),
      height: number.positive(),
      scale: number.positive(),
      caption: text.nullable(),
      title: shortText.nullable(),
      description: text.nullable(),
    })
    .partial()
    .strict(),
  'affine:embed-ai-chat': z
    .object({ ...geometry, scale: number.positive() })
    .partial()
    .strict(),
  'affine:transcription': z.object({}).strict(),
  'localmind:subpage': z.object({}).strict(),
} as const;

export type DocumentBlockFlavour = keyof typeof documentBlockProperties;
export const documentBlockVersions: Record<DocumentBlockFlavour, number> = {
  'affine:page': 2,
  'affine:surface': 5,
  'affine:paragraph': 1,
  'affine:list': 1,
  'affine:code': 1,
  'affine:divider': 1,
  'affine:note': 1,
  'affine:callout': 1,
  'affine:table': 1,
  'affine:database': 3,
  'affine:data-view': 1,
  'affine:image': 1,
  'affine:attachment': 1,
  'affine:bookmark': 1,
  'affine:latex': 1,
  'affine:surface-ref': 1,
  'affine:frame': 1,
  'affine:edgeless-text': 1,
  'affine:embed-linked-doc': 1,
  'affine:embed-synced-doc': 1,
  'affine:embed-figma': 1,
  'affine:embed-loom': 1,
  'affine:embed-youtube': 1,
  'affine:embed-github': 1,
  'affine:embed-html': 1,
  'affine:embed-iframe': 1,
  'affine:embed-ai-chat': 1,
  'affine:transcription': 1,
  'localmind:subpage': 1,
};

export const documentReference = z
  .object({
    pageId: documentId,
    title: shortText.optional(),
    description: text.optional(),
    params: z
      .object({
        mode: z.enum(['page', 'edgeless']).optional(),
        blockIds: z.array(documentId).max(1000).optional(),
        elementIds: z.array(documentId).max(1000).optional(),
        databaseId: documentId.optional(),
        databaseRowId: documentId.optional(),
        xywh: geometry.xywh.optional(),
        commentId: documentId.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const footnoteReference = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('doc'),
      docId: documentId,
      title: shortText.optional(),
      description: text.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('attachment'),
      blobId: documentId,
      fileName: shortText.optional(),
      fileType: shortText.optional(),
      title: shortText.optional(),
      description: text.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('url'),
      url,
      favicon: url.optional(),
      title: shortText.optional(),
      description: text.optional(),
    })
    .strict(),
]);

export const documentMarks = z
  .object({
    bold: boolean.nullable(),
    italic: boolean.nullable(),
    underline: boolean.nullable(),
    strike: boolean.nullable(),
    code: boolean.nullable(),
    link: url.nullable(),
    color: shortText.nullable(),
    background: shortText.nullable(),
    latex: shortText.nullable(),
    reference: documentReference
      .extend({ type: z.literal('LinkedPage') })
      .nullable(),
    footnote: z
      .object({ label: shortText, reference: footnoteReference })
      .strict()
      .nullable(),
  })
  .partial()
  .strict();
export const documentTextRun = z
  .object({ insert: text, attributes: documentMarks.optional() })
  .strict();
export const documentTextTarget = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('database_cell'),
      rowDocumentId: documentId.optional(),
      blockId: documentId,
      rowId: documentId,
      columnId: documentId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('block_text'),
      blockId: documentId,
      field: z.enum(['text', 'title']).default('text'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('table_cell'),
      blockId: documentId,
      rowId: documentId,
      columnId: documentId,
    })
    .strict(),
  z
    .object({
      kind: z.literal('element_text'),
      surfaceId: documentId,
      elementId: documentId,
      field: z.enum(['text', 'title']).default('text'),
    })
    .strict(),
]);
const op = { opId: documentId };
type BlockPropertiesCommand = {
  [F in DocumentBlockFlavour]: {
    opId: string;
    type: 'block.properties';
    blockId: string;
    flavour: F;
    properties: z.infer<(typeof documentBlockProperties)[F]>;
  };
}[DocumentBlockFlavour];
const blockPropertiesCommand = z.discriminatedUnion(
  'flavour',
  Object.entries(documentBlockProperties).map(([flavour, properties]) =>
    z
      .object({
        ...op,
        type: z.literal('block.properties'),
        blockId: documentId,
        flavour: z.literal(flavour),
        properties,
      })
      .strict()
  ) as unknown as [
    z.ZodDiscriminatedUnionOption<'flavour'>,
    ...z.ZodDiscriminatedUnionOption<'flavour'>[],
  ]
) as unknown as z.ZodType<BlockPropertiesCommand>;
export const documentNativeCommand = z.union([
  z
    .object({
      ...op,
      type: z.literal('markdown.rewrite'),
      parentId: documentId,
      selectedBlockIds: z.array(documentId).max(1000),
      index: position.optional(),
      mode: z.enum(['update_preserve', 'replace_selected']),
      markdown: text,
      marksPolicy: z.enum(['preserve_existing', 'reset_known']),
      mappings: z
        .array(
          z
            .object({
              path: z
                .string()
                .regex(/^\d+(\/\d+)*$/)
                .max(256),
              blockId: documentId,
              rowIds: z.array(documentId.nullable()).max(1000).optional(),
              columnIds: z.array(documentId.nullable()).max(1000).optional(),
            })
            .strict()
        )
        .max(1000),
      assets: z
        .array(
          z.object({ url: z.string().max(8192), blobId: documentId }).strict()
        )
        .max(256)
        .default([]),
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('block.split'),
      blockId: documentId,
      offset: position,
      clientRef: documentId,
      children: z.enum(['keep_left', 'move_right']),
      blockComments: z.enum(['keep_left', 'move_right']),
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('block.merge'),
      firstBlockId: documentId,
      secondBlockId: documentId,
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('table.cells.set'),
      blockId: documentId,
      rowIds: z.array(documentId).min(1).max(1000),
      columnIds: z.array(documentId).min(1).max(1000),
      cells: z
        .array(z.array(z.array(documentTextRun).max(10000)).max(1000))
        .max(1000),
      marksPolicy: z.enum(['explicit', 'preserve_existing']),
    })
    .strict(),
  documentSurfaceCommand,
  documentDatabaseCommand,
  z
    .object({
      ...op,
      type: z.literal('text.splice'),
      target: documentTextTarget,
      offset: position,
      deleteCount: position,
      insert: z.array(documentTextRun).max(10000),
      marksPolicy: z
        .enum([
          'explicit',
          'inherit_replaced_range',
          'inherit_left',
          'inherit_right',
          'preserve_existing',
        ])
        .default('explicit'),
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('text.format'),
      target: documentTextTarget,
      offset: position,
      length: position,
      marks: documentMarks,
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('block.reference.set'),
      blockId: documentId,
      reference: z.discriminatedUnion('kind', [
        z
          .object({ kind: z.literal('document'), value: documentReference })
          .strict(),
        z
          .object({
            kind: z.literal('resource'),
            resourceKind: z.enum(['doc', 'file', 'office', 'folder']),
            resourceId: documentId,
          })
          .strict(),
        z
          .object({
            kind: z.literal('surface'),
            surfaceId: documentId,
            elementId: documentId,
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('block.asset.set'),
      blockId: documentId,
      blobId: documentId,
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('block.convert'),
      blockId: documentId,
      flavour: z.enum([
        'affine:paragraph',
        'affine:list',
        'affine:code',
        'affine:callout',
      ]),
    })
    .strict(),
  blockPropertiesCommand,
  z
    .object({
      ...op,
      type: z.literal('block.create'),
      clientRef: documentId,
      parentId: documentId,
      index: position.optional(),
      flavour: z.enum(
        Object.keys(documentBlockVersions).filter(
          key => key !== 'affine:page'
        ) as [
          Exclude<DocumentBlockFlavour, 'affine:page'>,
          ...Exclude<DocumentBlockFlavour, 'affine:page'>[],
        ]
      ),
      text: z.array(documentTextRun).max(10000).optional(),
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('block.move'),
      blockId: documentId,
      parentId: documentId,
      index: position,
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('block.delete'),
      blockId: documentId,
      includeDescendants: boolean,
      references: z.enum(['reject', 'detach']).default('reject'),
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('table.axis.insert'),
      blockId: documentId,
      axis: z.enum(['row', 'column']),
      clientRef: documentId,
      index: position,
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('table.axis.delete'),
      blockId: documentId,
      axis: z.enum(['row', 'column']),
      id: documentId,
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('table.axis.move'),
      blockId: documentId,
      axis: z.enum(['row', 'column']),
      id: documentId,
      index: position,
    })
    .strict(),
  z
    .object({
      ...op,
      type: z.literal('table.axis.format'),
      blockId: documentId,
      axis: z.enum(['row', 'column']),
      id: documentId,
      backgroundColor: shortText.nullable().optional(),
      width: number.positive().optional(),
    })
    .strict(),
]);
export type DocumentNativeCommand = z.infer<typeof documentNativeCommand>;
export const documentNativeBatch = z
  .array(documentNativeCommand)
  .min(1)
  .max(1000)
  .superRefine((commands, context) => {
    const ids = new Set<string>();
    for (const [index, command] of commands.entries()) {
      if (ids.has(command.opId))
        context.addIssue({
          code: 'custom',
          path: [index, 'opId'],
          message: 'Duplicate opId',
        });
      ids.add(command.opId);
    }
  });
