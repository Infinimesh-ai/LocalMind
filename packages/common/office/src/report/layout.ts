import type { PublicReportNode, ReportProjection } from './audience';
import { REPORT_LIMITS } from './schema';

export type ReportRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ReportElement = ReportRectangle &
  (
    | {
        type: 'text';
        text: string;
        size: number;
        emphasis?: boolean;
        tone?: string;
      }
    | { type: 'table'; columns: string[]; rows: string[][]; size: number }
    | { type: 'image'; assetId: string; alt: string }
    | { type: 'chart'; node: Extract<PublicReportNode, { type: 'chart' }> }
  );
export type ReportSlide = {
  chapterId: string;
  title: string;
  notes: string;
  elements: ReportElement[];
};
export type ReportLayout = {
  width: number;
  height: number;
  slides: ReportSlide[];
};
export type ReportMeasure = (text: string, size: number) => number;
export function formatReportPeriod(
  period: ReportProjection['period'],
  language?: string
) {
  const format = new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeZone: period.timeZone,
  });
  return `${format.format(new Date(period.start))} – ${format.format(new Date(period.end))} (${period.timeZone})`;
}
export const approximateReportTextWidth: ReportMeasure = (text, size) =>
  Array.from(text).reduce(
    (sum, char) => sum + ((char.codePointAt(0) ?? 0) > 255 ? 1 : 0.58) * size,
    0
  );
export function wrapReportText(
  text: string,
  size: number,
  width: number,
  measure: ReportMeasure = approximateReportTextWidth
) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && measure(line + char, size) > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

/** Chapter ID of the generated title slide that opens every exported deck. */
export const REPORT_COVER_CHAPTER_ID = 'report-cover';
/** Layout of each slide's chapter, including the generated title slide. */
export function reportChapterLayouts(projection: ReportProjection) {
  return new Map<string, string>([
    [REPORT_COVER_CHAPTER_ID, 'cover'],
    ...projection.chapters.map(
      chapter => [chapter.id, chapter.layout] as [string, string]
    ),
  ]);
}
/** Shared semantic pagination. Never shrink below 14 pt to conceal an overflow. */
export function layoutReport(
  projection: ReportProjection,
  measure: ReportMeasure = approximateReportTextWidth
): ReportLayout {
  const width = projection.theme.aspectRatio === '4:3' ? 720 : 960,
    height = 540;
  const left = 48,
    available = width - 96,
    bottom = height - 44;
  const slides: ReportSlide[] = [];
  const coverTitle =
    projection.language === 'en' ? 'Project report' : '项目汇报';
  const cover: ReportProjection['chapters'][number] = {
    id: REPORT_COVER_CHAPTER_ID,
    title: coverTitle,
    layout: 'cover',
    notes: '',
    nodes: [
      {
        id: 'report-title',
        type: 'heading',
        text: projection.title,
        level: '1',
        claimKind: 'manual',
        sources: [],
      },
      {
        id: 'report-period',
        type: 'paragraph',
        text: formatReportPeriod(projection.period, projection.language),
        claimKind: 'manual',
        sources: [],
      },
      {
        id: 'report-owner',
        type: 'paragraph',
        text: `${projection.language === 'en' ? 'Responsible' : '负责人'}: ${projection.responsibility.label}${projection.responsibility.defaulted ? (projection.language === 'en' ? ' (default)' : '（默认）') : ''}`,
        claimKind: 'manual',
        sources: [],
      },
    ],
  };
  for (const chapter of [cover, ...projection.chapters]) {
    let slide!: ReportSlide;
    let y = 0;
    const next = () => {
      if (slides.length >= REPORT_LIMITS.pages)
        throw new Error('REPORT_PAGE_LIMIT_EXCEEDED');
      slide = {
        chapterId: chapter.id,
        title:
          wrapReportText(chapter.title, 26, width - 144, measure)[0] +
          (measure(chapter.title, 26) > width - 144 ? '…' : ''),
        notes: chapter.notes,
        elements: [],
      };
      slides.push(slide);
      y = 92;
    };
    const ensure = (height: number) => {
      if (y + height > bottom) next();
    };
    const text = (
      value: string,
      size = 20,
      emphasis = false,
      tone?: string
    ) => {
      const lines = wrapReportText(value, size, available, measure),
        lineHeight = size * 1.45;
      while (lines.length) {
        ensure(lineHeight);
        const count = Math.max(1, Math.floor((bottom - y) / lineHeight));
        const taken = lines.splice(0, count);
        slide.elements.push({
          type: 'text',
          text: taken.join('\n'),
          size,
          emphasis,
          tone,
          x: left,
          y,
          width: available,
          height: taken.length * lineHeight,
        });
        y += taken.length * lineHeight + 10;
      }
    };
    next();
    if (measure(chapter.title, 26) > width - 144) text(chapter.title, 26, true);
    const nodes = chapter.nodes.flatMap((node): PublicReportNode[] => {
      if (
        node.type !== 'chart' ||
        (node.labels.length <= 10 &&
          node.labels.every(label => label.length <= 9) &&
          node.series.length <= 4 &&
          node.series.every(series => series.label.length <= 18))
      )
        return [node];
      return [
        node,
        {
          type: 'table',
          id: `${node.id}-data`,
          claimKind: node.claimKind,
          sources: [],
          columns: ['', ...node.series.map(series => series.label)],
          rows: node.labels.map((label, index) => [
            label,
            ...node.series.map(series =>
              series.values[index] === null ? '—' : String(series.values[index])
            ),
          ]),
        },
      ];
    });
    for (const node of nodes) {
      switch (node.type) {
        case 'heading':
          text(
            node.text,
            node.level === '1' ? 28 : node.level === '2' ? 24 : 22,
            true
          );
          break;
        case 'paragraph':
          text(node.text);
          break;
        case 'callout':
          text(node.text, 20, true, node.tone);
          break;
        case 'list':
          node.items.forEach((item, index) =>
            text(`${node.ordered ? `${index + 1}.` : '•'} ${item}`)
          );
          break;
        case 'metric':
          text(`${node.label}  ${node.value ?? '—'} ${node.unit}`, 28, true);
          if (node.formula) text(node.formula, 14);
          if (node.exclusions) text(node.exclusions, 14);
          break;
        case 'timeline':
          node.entries.forEach(entry => {
            text(`${entry.date} · ${entry.title} [${entry.status}]`, 20, true);
            if (entry.detail) text(entry.detail, 18);
          });
          break;
        case 'table': {
          // Wide tables are split into column bands; repeat the first identifying column.
          const bands: number[][] = [];
          if (node.columns.length <= 6)
            bands.push(node.columns.map((_, index) => index));
          else
            for (let index = 1; index < node.columns.length; index += 5)
              bands.push([
                0,
                ...Array.from(
                  { length: Math.min(5, node.columns.length - index) },
                  (_, offset) => index + offset
                ),
              ]);
          for (const band of bands) {
            const columns = band.map(index => node.columns[index]);
            const columnWidth = available / columns.length;
            const header = columns.map((cell, index) => {
              const lines = wrapReportText(cell, 14, columnWidth - 16, measure);
              if (lines.length > 2) text(`${index + 1}. ${cell}`, 14);
              return (
                lines.slice(0, 2).join('\n') + (lines.length > 2 ? '…' : '')
              );
            });
            const headerHeight =
              Math.max(...header.map(cell => cell.split('\n').length)) * 20 +
              14;
            let table: Extract<ReportElement, { type: 'table' }> | undefined;
            for (const sourceRow of node.rows.length
              ? node.rows
              : [node.columns.map(() => '')]) {
              const cells = band.map(index =>
                wrapReportText(sourceRow[index], 14, columnWidth - 16, measure)
              );
              // Long cells continue with their row on a new page; headers repeat per page.
              while (cells.some(lines => lines.length)) {
                if (y + (table ? 0 : headerHeight) + 34 > bottom) {
                  next();
                  table = undefined;
                }
                const lineCount = Math.max(
                  1,
                  Math.floor(
                    (bottom - y - (table ? 0 : headerHeight) - 14) / 20
                  )
                );
                const row = cells.map(lines =>
                  lines.splice(0, lineCount).join('\n')
                );
                const rowHeight =
                  Math.max(...row.map(cell => cell.split('\n').length)) * 20 +
                  14;
                if (!table) {
                  table = {
                    type: 'table',
                    columns: header,
                    rows: [],
                    size: 14,
                    x: left,
                    y,
                    width: available,
                    height: headerHeight,
                  };
                  slide.elements.push(table);
                  y += headerHeight;
                }
                table.rows.push(row);
                table.height += rowHeight;
                y += rowHeight;
              }
            }
            y += 10;
          }
          break;
        }
        case 'image':
          ensure(300);
          slide.elements.push({
            type: 'image',
            assetId: node.assetId,
            alt: node.alt,
            x: left,
            y,
            width: available,
            height: 300,
          });
          y += 310;
          if (node.caption) text(node.caption, 16);
          break;
        case 'chart':
          text(node.title, 20, true);
          ensure(330);
          slide.elements.push({
            type: 'chart',
            node: { ...node, title: '' },
            x: left,
            y,
            width: available,
            height: 320,
          });
          y += 330;
          if (node.methodology) text(`${node.unit} · ${node.methodology}`, 14);
          break;
        case 'pageBreak':
          if (slide.elements.length) next();
          break;
      }
      if (node.responsibility)
        text(
          `${projection.language === 'en' ? 'Responsible' : '负责人'}: ${node.responsibility.label}${node.responsibility.defaulted ? (projection.language === 'en' ? ' (default)' : '（默认）') : ''}`,
          14
        );
      if (node.claimKind === 'inference')
        text(
          projection.language === 'en'
            ? 'AI suggestion — verify before action'
            : 'AI 推断 · 建议关注',
          14
        );
      if (node.sources.length)
        text(
          `${projection.language === 'en' ? 'Sources' : '来源'}: ${node.sources.join(' · ')}`,
          14
        );
    }
  }
  if (!projection.chapters.length) throw new Error('REPORT_EMPTY_PROJECTION');
  return { width, height, slides };
}

/** Cover slides prefer the cover image; every other slide uses the background image. */
export function reportSlideBackgroundAssetId(
  theme: Pick<ReportProjection['theme'], 'coverAssetId' | 'backgroundAssetId'>,
  layout: string | undefined
) {
  return layout === 'cover'
    ? (theme.coverAssetId ?? theme.backgroundAssetId)
    : theme.backgroundAssetId;
}
