import { z } from 'zod';

export const DECK_LIMITS = {
  minSlides: 3,
  maxSlides: 40,
  blocksPerSlide: 6,
  listItems: 8,
  tableColumns: 6,
  tableRows: 8,
  chartLabels: 12,
  chartSeries: 4,
  timelineEntries: 8,
  maxHtmlBytes: 5 * 1024 * 1024,
} as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      value =>
        Array.from(value).every(char => {
          const code = char.codePointAt(0) ?? 0;
          return code >= 32 || code === 9 || code === 10 || code === 13;
        }),
      'Unsupported control character'
    );

/**
 * What the AI wants a block to express. Templates map each intent to their
 * own motion, so the AI never names concrete animations.
 */
export const DeckIntentSchema = z.enum([
  'hero',
  'sequence',
  'number',
  'grow',
  'progress',
  'none',
]);
export type DeckIntent = z.infer<typeof DeckIntentSchema>;

const intent = DeckIntentSchema.optional();

export const DeckBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: text(600), intent }).strict(),
  z
    .object({
      type: z.literal('list'),
      items: z.array(text(240)).min(1).max(DECK_LIMITS.listItems),
      ordered: z.boolean().optional(),
      intent,
    })
    .strict(),
  z
    .object({
      type: z.literal('metric'),
      label: text(80),
      value: text(40),
      unit: text(16).optional(),
      delta: text(40).optional(),
      trend: z.enum(['up', 'down', 'flat']).optional(),
      intent,
    })
    .strict(),
  z
    .object({
      type: z.literal('chart'),
      chartType: z.enum(['bar', 'line', 'pie', 'donut']),
      title: text(120).optional(),
      labels: z.array(text(40)).min(1).max(DECK_LIMITS.chartLabels),
      series: z
        .array(
          z
            .object({
              label: text(60),
              values: z.array(z.number().finite()),
            })
            .strict()
        )
        .min(1)
        .max(DECK_LIMITS.chartSeries),
      unit: text(16).optional(),
      intent,
    })
    .strict(),
  z
    .object({
      type: z.literal('timeline'),
      entries: z
        .array(
          z
            .object({
              date: text(40),
              title: text(120),
              detail: text(240).optional(),
              status: z.enum(['done', 'active', 'planned', 'risk']).optional(),
            })
            .strict()
        )
        .min(1)
        .max(DECK_LIMITS.timelineEntries),
      intent,
    })
    .strict(),
  z
    .object({
      type: z.literal('table'),
      columns: z.array(text(60)).min(1).max(DECK_LIMITS.tableColumns),
      rows: z
        .array(z.array(text(120)).max(DECK_LIMITS.tableColumns))
        .min(1)
        .max(DECK_LIMITS.tableRows),
      intent,
    })
    .strict(),
  z
    .object({
      type: z.literal('callout'),
      text: text(400),
      tone: z.enum(['info', 'risk', 'decision']),
      intent,
    })
    .strict(),
  z
    .object({
      type: z.literal('quote'),
      text: text(400),
      by: text(80).optional(),
      intent,
    })
    .strict(),
]);
export type DeckBlock = z.infer<typeof DeckBlockSchema>;

export const DeckLayoutSchema = z.enum([
  'cover',
  'section',
  'bullets',
  'metrics',
  'chart',
  'timeline',
  'comparison',
  'table',
  'quote',
  'closing',
]);
export type DeckLayout = z.infer<typeof DeckLayoutSchema>;

export const DeckSlideSchema = z
  .object({
    layout: DeckLayoutSchema,
    title: text(120),
    kicker: text(60).optional(),
    notes: text(1000).optional(),
    blocks: z.array(DeckBlockSchema).max(DECK_LIMITS.blocksPerSlide),
    citations: z.array(text(160)).max(8).optional(),
  })
  .strict();
export type DeckSlide = z.infer<typeof DeckSlideSchema>;

export const DeckSpecSchema = z
  .object({
    // `refine` (not `pipe`) keeps a plain `type: string` in the JSON schema
    // sent to structured-output providers.
    title: text(120).refine(value => value.length > 0, 'Title is required'),
    subtitle: text(200).optional(),
    period: text(60).optional(),
    slides: z
      .array(DeckSlideSchema)
      .min(DECK_LIMITS.minSlides)
      .max(DECK_LIMITS.maxSlides),
  })
  .strict()
  .superRefine((spec, ctx) => {
    spec.slides.forEach((slide, slideIndex) => {
      slide.blocks.forEach((block, blockIndex) => {
        const path = ['slides', slideIndex, 'blocks', blockIndex];
        if (block.type === 'chart') {
          block.series.forEach((series, seriesIndex) => {
            if (series.values.length !== block.labels.length)
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, 'series', seriesIndex, 'values'],
                message: 'Chart series must have one value per label',
              });
          });
          if (
            (block.chartType === 'pie' || block.chartType === 'donut') &&
            (block.series.length !== 1 ||
              block.series[0].values.some(value => value < 0))
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path,
              message: 'Pie charts need exactly one nonnegative series',
            });
        }
        if (block.type === 'table')
          block.rows.forEach((row, rowIndex) => {
            if (row.length !== block.columns.length)
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, 'rows', rowIndex],
                message: 'Table rows must match the column count',
              });
          });
      });
    });
  });
export type DeckSpec = z.infer<typeof DeckSpecSchema>;
