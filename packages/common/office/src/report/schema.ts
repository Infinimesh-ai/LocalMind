import { z } from 'zod';

export const REPORT_LIMITS = {
  chapters: 60,
  pages: 100,
  nodes: 2000,
  media: 200,
  commandBytes: 2 * 1024 * 1024,
} as const;

const id = z.string().trim().min(1).max(256);
const text = z
  .string()
  .max(16000)
  .refine(
    value =>
      Array.from(value).every(char => {
        const code = char.codePointAt(0) ?? 0;
        return code >= 32 || code === 9 || code === 10 || code === 13;
      }),
    'Unsupported control character'
  );
const shortText = z.string().max(512);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ReportIdentitySchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('member'), actorId: id, label: shortText })
    .strict(),
  z.object({ kind: z.literal('external'), label: shortText.min(1) }).strict(),
]);
export const ReportResponsibilitySchema = z
  .object({
    identity: ReportIdentitySchema,
    origin: z.enum(['manual', 'document', 'creator_fallback']),
    sourceIds: z.array(id).max(100).default([]),
  })
  .strict();

const nodeBase = {
  id,
  sourceIds: z.array(id).max(100).default([]),
  claimKind: z
    .enum(['document', 'business_state', 'calculation', 'inference', 'manual'])
    .default('manual'),
  responsibility: ReportResponsibilitySchema.optional(),
  locked: z.boolean().default(false),
};
const series = z
  .object({
    label: shortText,
    values: z.array(z.number().finite().nullable()).max(200),
  })
  .strict();
const calculation = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ratio'),
      numerator: z.number().finite(),
      denominator: z.number().positive().finite(),
      scale: z.number().finite().default(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('sum'),
      values: z.array(z.number().finite()).min(1).max(200),
    })
    .strict(),
]);

export const ReportNodeSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...nodeBase,
      type: z.literal('heading'),
      text,
      level: z.enum(['1', '2', '3']).default('2'),
    })
    .strict(),
  z.object({ ...nodeBase, type: z.literal('paragraph'), text }).strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('list'),
      items: z.array(text).max(100),
      ordered: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('table'),
      columns: z.array(shortText).min(1).max(20),
      rows: z.array(z.array(text).max(20)).max(200),
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('metric'),
      label: shortText,
      value: z.number().finite().nullable(),
      unit: shortText,
      numerator: z.number().finite().optional(),
      denominator: z.number().positive().finite().optional(),
      calculation: calculation.optional(),
      formula: text,
      exclusions: text.default(''),
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('timeline'),
      entries: z
        .array(
          z
            .object({
              date: shortText,
              title: shortText,
              detail: text,
              status: z.enum([
                'planned',
                'in_progress',
                'completed',
                'blocked',
                'unknown',
              ]),
            })
            .strict()
        )
        .max(100),
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('image'),
      assetId: id,
      alt: shortText,
      caption: text.default(''),
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('chart'),
      chartType: z.enum(['bar', 'line', 'pie', 'donut', 'target']),
      title: shortText,
      labels: z.array(shortText).min(1).max(200),
      series: z.array(series).min(1).max(12),
      unit: shortText,
      methodology: text,
    })
    .strict(),
  z
    .object({
      ...nodeBase,
      type: z.literal('callout'),
      text,
      tone: z.enum(['info', 'risk', 'decision']).default('info'),
    })
    .strict(),
  z.object({ ...nodeBase, type: z.literal('pageBreak') }).strict(),
]);

export const ReportThemeSchema = z
  .object({
    name: shortText.default('LocalMind'),
    background: color.default('#ffffff'),
    foreground: color.default('#202124'),
    accent: color.default('#315f8c'),
    fontFamily: z.enum(['sans', 'serif']).default('sans'),
    aspectRatio: z.enum(['16:9', '4:3']).default('16:9'),
    logoAssetId: id.optional(),
    /** Full-bleed image behind cover slides; falls back to backgroundAssetId. */
    coverAssetId: id.optional(),
    /** Full-bleed image behind content slides. */
    backgroundAssetId: id.optional(),
  })
  .strict();
const THEME_ASSET_FIELDS = [
  'logoAssetId',
  'coverAssetId',
  'backgroundAssetId',
] as const;
export function reportThemeAssetIds(theme: z.infer<typeof ReportThemeSchema>) {
  return THEME_ASSET_FIELDS.flatMap(field => {
    const value = theme[field];
    return value ? [{ field, id: value }] : [];
  });
}
export const ReportChapterSchema = z
  .object({
    id,
    title: shortText.min(1),
    layout: z
      .enum(['content', 'cover', 'comparison', 'timeline', 'gallery'])
      .default('content'),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
    notes: text.default(''),
    nodes: z.array(ReportNodeSchema).max(200),
  })
  .strict();
export const ReportSourceSchema = z
  .object({
    id,
    resourceId: id,
    title: shortText,
    kind: z.enum([
      'page',
      'edgeless',
      'document',
      'workbook',
      'presentation',
      'pdf',
      'file',
      'memory',
      'work_order',
    ]),
    revision: id,
    fingerprint: id,
    capturedAt: z.string().datetime(),
    locator: shortText,
    status: z.enum(['read', 'parsed', 'failed', 'omitted']),
    reason: shortText.optional(),
  })
  .strict();
export const ReportIssueSchema = z
  .object({
    id,
    kind: z.enum([
      'coverage',
      'conflict',
      'time_gap',
      'missing_fact',
      'invalid_reference',
      'missing_asset',
    ]),
    message: text,
    sourceIds: z.array(id).max(100),
    nodeIds: z.array(id).max(100),
    resolution: z
      .object({
        actorId: id,
        note: text.refine(
          value => value.length > 0,
          'Resolution note is required'
        ),
        resolvedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const ReportAssetsSchema = z
  .array(
    z
      .object({
        id,
        blobKey: id,
        mimeType: z.enum([
          'image/png',
          'image/jpeg',
          'image/gif',
          'image/webp',
        ]),
        alt: shortText,
      })
      .strict()
  )
  .max(REPORT_LIMITS.media);

export const ReportDocumentSchema = z
  .object({
    schemaVersion: z.literal('localmind-report/v1'),
    title: shortText.min(1),
    creator: z.object({ actorId: id, label: shortText }).strict(),
    responsibility: ReportResponsibilitySchema,
    period: z
      .object({
        start: z.string().datetime(),
        end: z.string().datetime(),
        timeZone: id,
        weekStartsOn: z.number().int().min(0).max(6).default(1),
      })
      .strict(),
    audience: z.enum(['management', 'customer', 'team']),
    language: z.enum(['zh-Hans', 'zh-Hant', 'en']),
    durationMinutes: z.number().int().min(1).max(120),
    theme: ReportThemeSchema,
    chapters: z.array(ReportChapterSchema).max(REPORT_LIMITS.chapters),
    assets: ReportAssetsSchema,
    sources: z.array(ReportSourceSchema).max(10000),
    issues: z.array(ReportIssueSchema).max(2000),
    cutoffAt: z.string().datetime(),
    coverage: z
      .object({
        discovered: z.number().int().nonnegative(),
        selected: z.number().int().nonnegative(),
        read: z.number().int().nonnegative(),
        parsed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        omitted: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((document, ctx) => {
    if (Date.parse(document.period.start) >= Date.parse(document.period.end))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period'],
        message: 'Report period must have a positive duration',
      });
    try {
      new Intl.DateTimeFormat('en', { timeZone: document.period.timeZone });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period', 'timeZone'],
        message: 'Invalid report time zone',
      });
    }
    const ids = new Set<string>();
    const sources = new Set(document.sources.map(source => source.id));
    const sourceRecords = new Map(
      document.sources.map(source => [source.id, source])
    );
    const assets = new Set(document.assets.map(asset => asset.id));
    const unique = (values: { id: string }[], path: string) => {
      if (new Set(values.map(value => value.id)).size !== values.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: 'Duplicate report identity',
        });
    };
    unique(document.sources, 'sources');
    unique(document.assets, 'assets');
    unique(document.issues, 'issues');
    const validateResponsibility = (
      responsibility: z.infer<typeof ReportResponsibilitySchema> | undefined,
      path: (string | number)[]
    ) => {
      if (!responsibility) return;
      if (responsibility.sourceIds.some(source => !sources.has(source)))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'Unknown responsibility source',
        });
      if (
        responsibility.origin === 'document' &&
        (!responsibility.sourceIds.length ||
          responsibility.sourceIds.some(
            id => sourceRecords.get(id)?.status !== 'parsed'
          ))
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'Document responsibility requires parsed evidence',
        });
      if (
        responsibility.origin === 'creator_fallback' &&
        (responsibility.identity.kind !== 'member' ||
          responsibility.identity.actorId !== document.creator.actorId)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'Default responsibility must belong to the report creator',
        });
    };
    validateResponsibility(document.responsibility, ['responsibility']);
    let nodeCount = 0;
    for (const [chapterIndex, chapter] of document.chapters.entries()) {
      if (ids.has(chapter.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['chapters', chapterIndex, 'id'],
          message: 'Duplicate report identity',
        });
      ids.add(chapter.id);
      for (const [nodeIndex, node] of chapter.nodes.entries()) {
        nodeCount++;
        const path = ['chapters', chapterIndex, 'nodes', nodeIndex];
        if (ids.has(node.id))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Duplicate report identity',
          });
        ids.add(node.id);
        validateResponsibility(node.responsibility, path);
        if (node.sourceIds.some(source => !sources.has(source)))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Unknown report source',
          });
        if (node.type === 'image' && !assets.has(node.assetId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Unknown report asset',
          });
        if (
          node.type === 'table' &&
          node.rows.some(row => row.length !== node.columns.length)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Report table column mismatch',
          });
        if (
          node.type === 'chart' &&
          node.series.some(item => item.values.length !== node.labels.length)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Report chart data mismatch',
          });
        if (
          node.type === 'chart' &&
          ['pie', 'donut'].includes(node.chartType) &&
          (node.series.length !== 1 ||
            node.series.some(series =>
              series.values.some(value => value !== null && value < 0)
            ))
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Circular charts require one nonnegative series',
          });
        if (
          node.type === 'metric' &&
          node.claimKind === 'calculation' &&
          (!node.formula.trim() || !node.sourceIds.length)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Calculated metrics require evidence and a formula',
          });
        if (
          ['document', 'business_state', 'calculation'].includes(
            node.claimKind
          ) &&
          (!node.sourceIds.length ||
            node.sourceIds.some(
              id => sourceRecords.get(id)?.status !== 'parsed'
            ))
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Verified claims require parsed evidence',
          });
        if (
          node.claimKind === 'document' &&
          node.sourceIds.some(id =>
            ['memory', 'work_order'].includes(sourceRecords.get(id)?.kind ?? '')
          )
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Document progress requires document evidence',
          });
        // Work-order status is participant-visible business state, never document
        // text; it must be labelled as such and cannot borrow document evidence.
        if (
          node.claimKind === 'business_state' &&
          node.sourceIds.some(
            id => sourceRecords.get(id)?.kind !== 'work_order'
          )
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path,
            message: 'Business state claims require work-order evidence',
          });
        if (node.type === 'metric' && node.claimKind === 'calculation') {
          const expression = node.calculation;
          const expected =
            expression?.kind === 'ratio'
              ? (expression.numerator / expression.denominator) *
                expression.scale
              : expression?.values.reduce((sum, value) => sum + value, 0);
          if (
            expected === undefined ||
            !Number.isFinite(expected) ||
            node.value === null ||
            (expression?.kind === 'ratio' &&
              ((node.numerator !== undefined &&
                node.numerator !== expression.numerator) ||
                (node.denominator !== undefined &&
                  node.denominator !== expression.denominator))) ||
            Math.abs(node.value - expected) >
              0.000001 * Math.max(1, Math.abs(expected))
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: 'Metric does not match its calculation',
            });
        }
      }
    }
    if (nodeCount > REPORT_LIMITS.nodes)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapters'],
        message: 'Report node budget exceeded',
      });
    for (const { field, id } of reportThemeAssetIds(document.theme))
      if (!assets.has(id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['theme', field],
          message: 'Unknown report theme image',
        });
    for (const [index, issue] of document.issues.entries())
      if (
        issue.sourceIds.some(source => !sources.has(source)) ||
        issue.nodeIds.some(node => !ids.has(node))
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['issues', index],
          message: 'Unknown issue reference',
        });
    const coverage = document.coverage;
    if (
      coverage.discovered < coverage.selected ||
      coverage.selected < coverage.read ||
      coverage.read < coverage.parsed ||
      coverage.parsed + coverage.failed + coverage.omitted > coverage.selected
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coverage'],
        message: 'Inconsistent material coverage',
      });
  });

export type ReportDocument = z.infer<typeof ReportDocumentSchema>;
export type ReportChapter = z.infer<typeof ReportChapterSchema>;
export type ReportNode = z.infer<typeof ReportNodeSchema>;
export type ReportSource = z.infer<typeof ReportSourceSchema>;
export type ReportResponsibility = z.infer<typeof ReportResponsibilitySchema>;

export const ReportTemplateSchema = z
  .object({
    name: shortText.min(1),
    audience: z.enum(['management', 'customer', 'team']),
    language: z.enum(['zh-Hans', 'zh-Hant', 'en']).default('zh-Hans'),
    durationMinutes: z.number().int().min(1).max(120).default(5),
    prompt: z.string().max(8000).default(''),
    /** When to pick this template; shown on template cards. */
    description: z.string().max(500).optional(),
    /** Representative image for template cards, e.g. an imported cover. */
    previewAssetId: id.optional(),
    /** Origin and license of the visual design, kept for attribution. */
    source: z
      .object({
        name: shortText.min(1),
        url: z.string().url().max(1000).optional(),
        license: shortText.optional(),
      })
      .strict()
      .optional(),
    theme: ReportThemeSchema,
    assets: ReportAssetsSchema.default([]),
    chapters: z
      .array(
        z
          .object({
            key: id,
            title: shortText.min(1),
            question: text,
            layout: ReportChapterSchema.shape.layout,
          })
          .strict()
      )
      .min(1)
      .max(REPORT_LIMITS.chapters),
  })
  .strict()
  .superRefine((template, ctx) => {
    if (
      new Set(template.chapters.map(chapter => chapter.key)).size !==
      template.chapters.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chapters'],
        message: 'Duplicate template chapter key',
      });
    if (
      new Set(template.assets.map(asset => asset.id)).size !==
      template.assets.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assets'],
        message: 'Duplicate template asset',
      });
    const assets = new Set(template.assets.map(asset => asset.id));
    for (const { field, id } of reportThemeAssetIds(template.theme))
      if (!assets.has(id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['theme', field],
          message: 'Unknown template theme image',
        });
    if (template.previewAssetId && !assets.has(template.previewAssetId))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['previewAssetId'],
        message: 'Unknown template preview',
      });
  });
export type ReportTemplate = z.infer<typeof ReportTemplateSchema>;

export const ReportSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z
    .object({
      kind: z.literal('resources'),
      resourceIds: z.array(id).min(1).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('folders'),
      folderIds: z.array(id).min(1).max(100),
    })
    .strict(),
]);

export const ReportAudienceSchema = z
  .object({
    kind: z.enum(['internal', 'external']),
    chapterIds: z.array(id).max(REPORT_LIMITS.chapters),
    includeNotes: z.boolean().default(false),
    includeSources: z.boolean().default(false),
  })
  .strict();
export type ReportAudience = z.infer<typeof ReportAudienceSchema>;
