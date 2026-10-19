import { z } from 'zod';

import type { ReportAudience, ReportDocument, ReportNode } from './schema';
import {
  ReportNodeSchema,
  reportThemeAssetIds,
  ReportThemeSchema,
} from './schema';

export type PublicReportResponsibility = { label: string; defaulted: boolean };
type PublicNodeBase = {
  id: string;
  claimKind: ReportNode['claimKind'];
  responsibility?: PublicReportResponsibility;
  sources: string[];
};
type Content<T extends ReportNode> = T extends ReportNode
  ? Omit<T, 'id' | 'sourceIds' | 'responsibility' | 'locked'> & PublicNodeBase
  : never;
export type PublicReportNode = Content<ReportNode>;
export type ReportProjection = {
  schemaVersion: 'localmind-report-public/v1';
  title: string;
  period: ReportDocument['period'];
  language: ReportDocument['language'];
  durationMinutes: number;
  theme: ReportDocument['theme'];
  responsibility: PublicReportResponsibility;
  chapters: {
    id: string;
    title: string;
    layout: ReportDocument['chapters'][number]['layout'];
    notes: string;
    nodes: PublicReportNode[];
  }[];
  assets: {
    id: string;
    mimeType: ReportDocument['assets'][number]['mimeType'];
    alt: string;
  }[];
};

/** Only these bindings may be used to fetch assets after the caller checks Project ACL. */
export function reportAudienceAssetBindings(
  document: ReportDocument,
  audience: ReportAudience
) {
  const selected = new Set(audience.chapterIds);
  if (
    selected.size !== audience.chapterIds.length ||
    audience.chapterIds.some(
      id => !document.chapters.some(chapter => chapter.id === id)
    )
  )
    throw new Error('Invalid report audience chapters');
  const referenced = new Set<string>();
  for (const { id } of reportThemeAssetIds(document.theme)) referenced.add(id);
  for (const chapter of document.chapters)
    if (!chapter.hidden && selected.has(chapter.id))
      for (const node of chapter.nodes)
        if (node.type === 'image') referenced.add(node.assetId);
  return document.assets
    .filter(asset => referenced.has(asset.id))
    .map((asset, index) => ({ publicId: `asset-${index + 1}`, asset }));
}

/** Positive allowlist. Internal IDs, paths, notes and future fields cannot leak by object spread. */
export function projectReportAudience(
  document: ReportDocument,
  audience: ReportAudience
): ReportProjection {
  const selected = new Set(audience.chapterIds);
  const bindings = reportAudienceAssetBindings(document, audience);
  const assets = new Map(
    bindings.map(binding => [binding.asset.id, binding.publicId])
  );
  const theme = document.theme;
  return {
    schemaVersion: 'localmind-report-public/v1',
    title: document.title,
    period: {
      start: document.period.start,
      end: document.period.end,
      timeZone: document.period.timeZone,
      weekStartsOn: document.period.weekStartsOn,
    },
    language: document.language,
    durationMinutes: document.durationMinutes,
    theme: {
      name: theme.name,
      background: theme.background,
      foreground: theme.foreground,
      accent: theme.accent,
      fontFamily: theme.fontFamily,
      aspectRatio: theme.aspectRatio,
      logoAssetId: theme.logoAssetId
        ? assets.get(theme.logoAssetId)
        : undefined,
      coverAssetId: theme.coverAssetId
        ? assets.get(theme.coverAssetId)
        : undefined,
      backgroundAssetId: theme.backgroundAssetId
        ? assets.get(theme.backgroundAssetId)
        : undefined,
    },
    responsibility: {
      label: document.responsibility.identity.label,
      defaulted: document.responsibility.origin === 'creator_fallback',
    },
    assets: bindings.map(({ publicId, asset }) => ({
      id: publicId,
      mimeType: asset.mimeType,
      alt: asset.alt,
    })),
    chapters: document.chapters
      .filter(chapter => !chapter.hidden && selected.has(chapter.id))
      .map((chapter, index) => ({
        id: `chapter-${index + 1}`,
        title: chapter.title,
        layout: chapter.layout,
        notes:
          audience.kind === 'internal' && audience.includeNotes
            ? chapter.notes
            : '',
        nodes: chapter.nodes.map((node, nodeIndex): PublicReportNode => {
          const base: PublicNodeBase = {
            id: `node-${index + 1}-${nodeIndex + 1}`,
            claimKind: node.claimKind,
            sources: audience.includeSources
              ? node.sourceIds.flatMap(id => {
                  const source = document.sources.find(
                    source => source.id === id
                  );
                  return source ? [source.title] : [];
                })
              : [],
            responsibility: node.responsibility
              ? {
                  label: node.responsibility.identity.label,
                  defaulted: node.responsibility.origin === 'creator_fallback',
                }
              : undefined,
          };
          switch (node.type) {
            case 'heading':
              return {
                ...base,
                type: 'heading',
                text: node.text,
                level: node.level,
              };
            case 'paragraph':
              return { ...base, type: 'paragraph', text: node.text };
            case 'callout':
              return {
                ...base,
                type: 'callout',
                text: node.text,
                tone: node.tone,
              };
            case 'list':
              return {
                ...base,
                type: 'list',
                items: [...node.items],
                ordered: node.ordered,
              };
            case 'table':
              return {
                ...base,
                type: 'table',
                columns: [...node.columns],
                rows: node.rows.map(row => [...row]),
              };
            case 'metric':
              return {
                ...base,
                type: 'metric',
                label: node.label,
                value: node.value,
                unit: node.unit,
                numerator: node.numerator,
                denominator: node.denominator,
                calculation:
                  node.calculation?.kind === 'ratio'
                    ? {
                        kind: 'ratio',
                        numerator: node.calculation.numerator,
                        denominator: node.calculation.denominator,
                        scale: node.calculation.scale,
                      }
                    : node.calculation
                      ? { kind: 'sum', values: [...node.calculation.values] }
                      : undefined,
                formula: node.formula,
                exclusions: node.exclusions,
              };
            case 'timeline':
              return {
                ...base,
                type: 'timeline',
                entries: node.entries.map(entry => ({
                  date: entry.date,
                  title: entry.title,
                  detail: entry.detail,
                  status: entry.status,
                })),
              };
            case 'image': {
              const assetId = assets.get(node.assetId);
              if (!assetId) throw new Error('Missing report asset');
              return {
                ...base,
                type: 'image',
                assetId,
                alt: node.alt,
                caption: node.caption,
              };
            }
            case 'chart':
              return {
                ...base,
                type: 'chart',
                title: node.title,
                chartType: node.chartType,
                labels: [...node.labels],
                series: node.series.map(series => ({
                  label: series.label,
                  values: [...series.values],
                })),
                unit: node.unit,
                methodology: node.methodology,
              };
            case 'pageBreak':
              return { ...base, type: 'pageBreak' };
            default:
              throw new Error('Unsupported report node');
          }
        }),
      })),
  };
}

const publicResponsibility = z
  .object({ label: z.string().max(512), defaulted: z.boolean() })
  .strict();
const publicBase = {
  id: z.string().regex(/^node-\d+-\d+$/),
  claimKind: z.enum([
    'document',
    'business_state',
    'calculation',
    'inference',
    'manual',
  ]),
  responsibility: publicResponsibility.optional(),
  sources: z.array(z.string().max(512)).max(100),
};
const options = ReportNodeSchema.options;
/** Strict transport validation, kept separate from the internal document schema. */
export const ReportProjectionSchema = z
  .object({
    schemaVersion: z.literal('localmind-report-public/v1'),
    title: z.string().min(1).max(512),
    period: z
      .object({
        start: z.string().datetime(),
        end: z.string().datetime(),
        timeZone: z.string().max(256),
        weekStartsOn: z.number().int().min(0).max(6),
      })
      .strict(),
    language: z.enum(['zh-Hans', 'zh-Hant', 'en']),
    durationMinutes: z.number().int().min(1).max(120),
    theme: ReportThemeSchema,
    responsibility: publicResponsibility,
    chapters: z
      .array(
        z
          .object({
            id: z.string().regex(/^chapter-\d+$/),
            title: z.string().max(512),
            layout: z.enum([
              'content',
              'cover',
              'comparison',
              'timeline',
              'gallery',
            ]),
            notes: z.string().max(16000),
            nodes: z
              .array(
                z.discriminatedUnion('type', [
                  options[0]
                    .pick({ type: true, text: true, level: true })
                    .extend(publicBase),
                  options[1]
                    .pick({ type: true, text: true })
                    .extend(publicBase),
                  options[2]
                    .pick({ type: true, items: true, ordered: true })
                    .extend(publicBase),
                  options[3]
                    .pick({ type: true, columns: true, rows: true })
                    .extend(publicBase),
                  options[4]
                    .pick({
                      type: true,
                      label: true,
                      value: true,
                      unit: true,
                      numerator: true,
                      denominator: true,
                      calculation: true,
                      formula: true,
                      exclusions: true,
                    })
                    .extend(publicBase),
                  options[5]
                    .pick({ type: true, entries: true })
                    .extend(publicBase),
                  options[6]
                    .pick({
                      type: true,
                      assetId: true,
                      alt: true,
                      caption: true,
                    })
                    .extend(publicBase),
                  options[7]
                    .pick({
                      type: true,
                      chartType: true,
                      title: true,
                      labels: true,
                      series: true,
                      unit: true,
                      methodology: true,
                    })
                    .extend(publicBase),
                  options[8]
                    .pick({ type: true, text: true, tone: true })
                    .extend(publicBase),
                  options[9].pick({ type: true }).extend(publicBase),
                ])
              )
              .max(200),
          })
          .strict()
      )
      .max(60),
    assets: z
      .array(
        z
          .object({
            id: z.string().regex(/^asset-\d+$/),
            mimeType: z.enum([
              'image/png',
              'image/jpeg',
              'image/gif',
              'image/webp',
            ]),
            alt: z.string().max(512),
          })
          .strict()
      )
      .max(200),
  })
  .strict()
  .superRefine((projection, ctx) => {
    const ids = new Set<string>();
    const assets = new Set(projection.assets.map(asset => asset.id));
    if (assets.size !== projection.assets.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assets'],
        message: 'Duplicate public asset',
      });
    for (const { field, id } of reportThemeAssetIds(projection.theme))
      if (!assets.has(id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['theme', field],
          message: 'Invalid public theme image',
        });
    for (const chapter of projection.chapters) {
      if (ids.has(chapter.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate public chapter',
        });
      ids.add(chapter.id);
      for (const node of chapter.nodes) {
        if (ids.has(node.id))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Duplicate public node',
          });
        ids.add(node.id);
        if (node.type === 'image' && !assets.has(node.assetId))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid public image',
          });
        if (
          node.type === 'table' &&
          node.rows.some(row => row.length !== node.columns.length)
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid public table',
          });
        if (
          node.type === 'chart' &&
          (node.series.some(
            series => series.values.length !== node.labels.length
          ) ||
            (['pie', 'donut'].includes(node.chartType) &&
              (node.series.length !== 1 ||
                node.series[0].values.some(
                  value => value !== null && value < 0
                ))))
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid public chart',
          });
      }
    }
    if (ids.size - projection.chapters.length > 2000)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Public node budget exceeded',
      });
  });
