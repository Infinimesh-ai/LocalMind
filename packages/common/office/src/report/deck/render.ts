import { escapeReportXml as xml } from '../render-types';
import { deckMotionCss, deckMotionTransition } from './motion';
import type { DeckBlock, DeckIntent, DeckSlide, DeckSpec } from './schema';
import {
  DECK_FONT_SANS,
  DECK_FONT_SERIF,
  DECK_STAGE,
  wrapDeckHtml,
} from './shell';
import type { DeckTemplate } from './templates';

export type DeckLanguage = 'zh-CN' | 'en';

export type DeckRenderInput = {
  spec: DeckSpec;
  template: DeckTemplate;
  /** `#rrggbb`; overrides the template accent. */
  accentColor?: string;
  language: DeckLanguage;
  /** Render `slide.citations` as a small footer. */
  citations?: boolean;
};

export type DeckRenderResult = { html: string; slideCount: number };

const LABELS = {
  'zh-CN': {
    slide: (n: number) => `第 ${n} 章`,
    sources: '来源',
    total: '合计',
    unit: '单位',
    info: '提示',
    risk: '风险',
    decision: '决策',
    done: '已完成',
    active: '进行中',
    planned: '计划中',
    statusRisk: '有风险',
    vs: 'VS',
  },
  en: {
    slide: (n: number) => `Chapter ${n}`,
    sources: 'Sources',
    total: 'Total',
    unit: 'Unit',
    info: 'Note',
    risk: 'Risk',
    decision: 'Decision',
    done: 'Done',
    active: 'In progress',
    planned: 'Planned',
    statusRisk: 'At risk',
    vs: 'VS',
  },
} as const;

/* ---------------------------------------------------------------- colors */

const HEX = /^#([0-9a-f]{6})$/i;
type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => {
  const match = HEX.exec(hex.trim());
  const value = match ? parseInt(match[1], 16) : 0x888888;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b]
    .map(c =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
/** Mix `a` into `b`: weight 1 = a, 0 = b. */
export const mixColor = (a: string, b: string, weight: number) => {
  const x = rgb(a),
    y = rgb(b);
  return hex([0, 1, 2].map(i => x[i] * weight + y[i] * (1 - weight)) as Rgb);
};
const luminance = (color: string) => {
  const [r, g, b] = rgb(color).map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const safeColor = (value: string | undefined, fallback: string) =>
  value && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback;

type Palette = {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  line: string;
  series: string[];
};

function palette(template: DeckTemplate, accentColor?: string): Palette {
  const t = template.theme;
  const bg = safeColor(t.background, '#ffffff');
  const fg = safeColor(t.foreground, '#111111');
  const accent = safeColor(accentColor, safeColor(t.accent, '#2f6fed'));
  const accent2 = safeColor(t.accent2, mixColor(accent, fg, 0.5));
  const surface = safeColor(t.surface, mixColor(fg, bg, 0.04));
  const muted = safeColor(t.muted, mixColor(fg, bg, 0.6));
  const series = [
    accent,
    accent2,
    mixColor(accent, bg, 0.55),
    mixColor(accent2, bg, 0.55),
    mixColor(accent, fg, 0.6),
    mixColor(accent2, fg, 0.6),
    mixColor(fg, bg, 0.55),
    mixColor(accent, bg, 0.3),
    mixColor(accent2, bg, 0.3),
    mixColor(accent, accent2, 0.5),
    mixColor(fg, bg, 0.35),
    mixColor(accent, fg, 0.35),
  ];
  return {
    bg,
    surface,
    fg,
    muted,
    accent,
    accent2,
    line: mixColor(fg, bg, 0.13),
    series,
  };
}

/* ---------------------------------------------------------------- numbers */

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : value;
  const fixed = Number(rounded.toFixed(2)).toString();
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec ? `${grouped}.${dec}` : grouped;
}

function niceScale(min: number, max: number, ticks = 4) {
  if (min === max) max = min + 1;
  const raw = (max - min) / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step,
    hi = Math.ceil(max / step) * step;
  return { lo, hi, step };
}

const n2 = (value: number) => Number(value.toFixed(2));

/* ---------------------------------------------------------------- charts */

type ChartBlock = Extract<DeckBlock, { type: 'chart' }>;

function chartSvg(
  block: ChartBlock,
  width: number,
  height: number,
  colors: Palette,
  id: string,
  language: DeckLanguage
): string {
  const label = xml(block.title ?? block.series.map(s => s.label).join(' / '));
  const open = `<svg class="deck-chart chart-${block.chartType}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}">`;
  if (block.chartType === 'pie' || block.chartType === 'donut') {
    const values = block.series[0].values.map(v => Math.max(0, v));
    const total = values.reduce((sum, v) => sum + v, 0);
    const radius = Math.min(width, height) / 2 - 8;
    const cx = width / 2,
      cy = height / 2;
    const donut = block.chartType === 'donut';
    const r = donut ? radius * 0.8 : radius / 2;
    const stroke = donut ? radius * 0.36 : radius;
    let start = 0;
    const slices = values
      .map((value, index) => {
        if (total <= 0 || value <= 0) return '';
        const len = (value / total) * 100;
        const gap = donut && values.filter(v => v > 0).length > 1 ? 0.6 : 0;
        const shown = Math.max(0.01, len - gap);
        const out = `<circle class="deck-slice" data-series="0" data-index="${index}" style="--i:${index}" cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(r)}" fill="none" stroke="${colors.series[index % colors.series.length]}" stroke-width="${n2(stroke)}" pathLength="100" stroke-dasharray="${n2(shown)} ${n2(100 - shown)}" stroke-dashoffset="${n2(-start)}" transform="rotate(-90 ${n2(cx)} ${n2(cy)})"/>`;
        start += len;
        return out;
      })
      .join('');
    const empty =
      total <= 0
        ? `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(r)}" fill="none" stroke="${colors.line}" stroke-width="${n2(stroke)}"/>`
        : '';
    const center = donut
      ? `<text class="deck-value donut-total" x="${n2(cx)}" y="${n2(cy + radius * 0.06)}" text-anchor="middle" font-size="${n2(radius * 0.26)}" font-weight="800" fill="${colors.fg}">${xml(formatNumber(total))}</text><text class="deck-value" x="${n2(cx)}" y="${n2(cy + radius * 0.26)}" text-anchor="middle" font-size="${n2(Math.max(13, radius * 0.1))}" fill="${colors.muted}">${xml(LABELS[language].total)}${block.unit ? ` · ${xml(block.unit)}` : ''}</text>`
      : '';
    return `${open}${empty}${slices}${center}</svg>`;
  }

  const left = 64,
    right = 16,
    top = 34,
    bottom = 44;
  const w = width - left - right,
    h = height - top - bottom;
  const all = block.series.flatMap(s => s.values);
  const { lo, hi, step } = niceScale(Math.min(0, ...all), Math.max(0, ...all));
  const py = (value: number) => top + h - ((value - lo) / (hi - lo)) * h;
  const parts: string[] = [];
  for (let tick = lo; tick <= hi + step / 2; tick += step) {
    const y = n2(py(tick));
    const zero = Math.abs(tick) < step / 1e6;
    parts.push(
      `<line class="deck-grid" x1="${left}" y1="${y}" x2="${left + w}" y2="${y}" stroke="${zero ? mixColor(colors.fg, colors.bg, 0.35) : colors.line}" stroke-width="${zero ? 1.5 : 1}"${zero ? '' : ' stroke-dasharray="4 6"'}/>`,
      `<text x="${left - 14}" y="${n2(y + 5)}" text-anchor="end" font-size="14" fill="${colors.muted}">${xml(formatNumber(zero ? 0 : tick))}</text>`
    );
  }
  const slot = w / block.labels.length;
  const every = Math.max(1, Math.ceil(block.labels.length / 12));
  block.labels.forEach((name, index) => {
    if (index % every) return;
    parts.push(
      `<text x="${n2(left + slot * (index + 0.5))}" y="${n2(top + h + 28)}" text-anchor="middle" font-size="15" fill="${colors.muted}">${xml(Array.from(name).slice(0, 10).join(''))}</text>`
    );
  });
  const seriesCount = block.series.length;
  if (block.chartType === 'bar') {
    const groupWidth = slot * (seriesCount > 1 ? 0.78 : 0.56);
    const barWidth = groupWidth / seriesCount;
    const gap = seriesCount > 1 ? Math.min(6, barWidth * 0.12) : 0;
    const max = Math.max(...all);
    let maxDone = false;
    const showValues = block.labels.length * seriesCount <= 24;
    block.series.forEach((series, s) =>
      series.values.forEach((value, index) => {
        const x = left + slot * index + (slot - groupWidth) / 2 + s * barWidth;
        const y0 = py(0),
          y1 = py(value);
        const bw = Math.max(1, barWidth - gap);
        const isMax = !maxDone && value === max && max > 0;
        if (isMax) maxDone = true;
        const cls = `deck-bar${value < 0 ? ' is-neg' : ''}${isMax ? ' is-max' : ''}`;
        const i = index * seriesCount + s;
        parts.push(
          `<rect class="${cls}" data-series="${s}" data-index="${index}" style="--i:${i}" x="${n2(x)}" y="${n2(Math.min(y0, y1))}" width="${n2(bw)}" height="${n2(Math.max(1, Math.abs(y1 - y0)))}" rx="${n2(Math.min(8, bw / 4))}" fill="${colors.series[s % colors.series.length]}"/>`
        );
        if (showValues)
          parts.push(
            `<text class="deck-value" style="--i:${i}" x="${n2(x + bw / 2)}" y="${n2(value < 0 ? y1 + 20 : y1 - 10)}" text-anchor="middle" font-size="${seriesCount > 2 ? 12 : 15}" font-weight="700" fill="${colors.fg}">${xml(formatNumber(value))}</text>`
          );
      })
    );
  } else {
    block.series.forEach((series, s) => {
      const color = colors.series[s % colors.series.length];
      const points = series.values.map(
        (value, index) =>
          [n2(left + slot * (index + 0.5)), n2(py(value))] as const
      );
      const line = points
        .map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`)
        .join(' ');
      if (s === 0 && points.length > 1) {
        const base = n2(py(Math.max(lo, 0)));
        parts.push(
          `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`,
          `<path class="deck-area" d="${line} L ${points[points.length - 1][0]} ${base} L ${points[0][0]} ${base} Z" fill="url(#${id})"/>`
        );
      }
      parts.push(
        `<path class="deck-line" data-series="${s}" style="--i:${s}" d="${line}" pathLength="1" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
      );
      // One series: label every point. Several: label only the last point,
      // above for the highest series and below for the others.
      const last = points.length - 1;
      const lastValues = block.series.map(other => other.values[last]);
      const isTop = series.values[last] === Math.max(...lastValues);
      points.forEach(([x, y], index) => {
        parts.push(
          `<circle class="deck-dot" data-series="${s}" data-index="${index}" style="--i:${index}" cx="${x}" cy="${y}" r="6" fill="${colors.bg}" stroke="${color}" stroke-width="3.5"/>`
        );
        const label =
          seriesCount === 1
            ? points.length <= 8
            : index === last && (isTop || seriesCount === 2);
        if (label)
          parts.push(
            `<text class="deck-value" style="--i:${index}" x="${x}" y="${n2(seriesCount > 1 && !isTop ? y + 28 : y - 16)}" text-anchor="middle" font-size="14" font-weight="700" fill="${seriesCount > 1 ? color : colors.fg}">${xml(formatNumber(series.values[index]))}</text>`
          );
      });
    });
  }
  return `${open}${parts.join('')}</svg>`;
}

function chartLegend(block: ChartBlock, colors: Palette) {
  if (block.chartType === 'pie' || block.chartType === 'donut') {
    const values = block.series[0].values.map(v => Math.max(0, v));
    const total = values.reduce((sum, v) => sum + v, 0);
    return `<ul class="deck-legend legend-pie">${block.labels
      .map(
        (name, index) =>
          `<li style="--i:${index}"><span class="sw" style="background:${colors.series[index % colors.series.length]}"></span><span class="lg-name">${xml(name)}</span><span class="lg-val">${xml(total > 0 ? `${Number(((values[index] / total) * 100).toFixed(1))}%` : '—')}</span></li>`
      )
      .join('')}</ul>`;
  }
  if (block.series.length < 2) return '';
  return `<ul class="deck-legend">${block.series
    .map(
      (series, index) =>
        `<li style="--i:${index}"><span class="sw" style="background:${colors.series[index % colors.series.length]}"></span><span class="lg-name">${xml(series.label)}</span></li>`
    )
    .join('')}</ul>`;
}

/* ---------------------------------------------------------------- blocks */

const DEFAULT_INTENT: Record<DeckBlock['type'], DeckIntent> = {
  paragraph: 'hero',
  list: 'sequence',
  metric: 'number',
  chart: 'grow',
  timeline: 'progress',
  table: 'sequence',
  callout: 'hero',
  quote: 'hero',
};

type Ctx = {
  colors: Palette;
  language: DeckLanguage;
  slideIndex: number;
  order: number;
  blockId: number;
};

type Area = 'main' | 'aside' | 'full' | 'cover';

const intentAttr = (block: DeckBlock) =>
  `data-intent="${block.intent ?? DEFAULT_INTENT[block.type]}"`;

function renderMetric(
  block: Extract<DeckBlock, { type: 'metric' }>,
  i: number,
  ctx: Ctx
) {
  const trend = block.trend ?? 'flat';
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '■';
  return `<div class="b-metric trend-${trend}" ${intentAttr(block)} style="--b:${ctx.order};--i:${i}"><div class="metric-label">${xml(block.label)}</div><div class="metric-value"><span class="metric-num" data-count="${xml(block.value)}">${xml(block.value)}</span>${block.unit ? `<span class="metric-unit">${xml(block.unit)}</span>` : ''}</div>${block.delta ? `<div class="metric-delta"><span class="arrow" aria-hidden="true">${arrow}</span>${xml(block.delta)}</div>` : ''}</div>`;
}

function renderTimeline(
  block: Extract<DeckBlock, { type: 'timeline' }>,
  ctx: Ctx,
  area: Area
) {
  const labels = LABELS[ctx.language];
  const vertical = area === 'aside' || block.entries.length > 6;
  const n = block.entries.length;
  let last = -1;
  block.entries.forEach((entry, index) => {
    if (entry.status === 'done' || entry.status === 'active') last = index;
  });
  const progress = last < 0 ? 0 : n2((last + 0.5) / n);
  const statusLabel = {
    done: labels.done,
    active: labels.active,
    planned: labels.planned,
    risk: labels.statusRisk,
  };
  const items = block.entries
    .map(
      (entry, index) =>
        `<li class="tl-item status-${entry.status ?? 'planned'}" style="--i:${index}"><span class="tl-node" style="--i:${index}"></span><span class="tl-date">${xml(entry.date)}</span><strong class="tl-title">${xml(entry.title)}</strong>${entry.detail ? `<span class="tl-detail">${xml(entry.detail)}</span>` : ''}${entry.status ? `<span class="tl-status">${xml(statusLabel[entry.status])}</span>` : ''}</li>`
    )
    .join('');
  return `<div class="b-timeline ${vertical ? 'tl-vertical' : 'tl-horizontal'}" ${intentAttr(block)} style="--b:${ctx.order};--n:${n};--p:${progress}"><div class="tl-rail" aria-hidden="true"><span class="tl-track"></span><span class="tl-fill"></span></div><ol class="tl-list">${items}</ol></div>`;
}

function renderBlock(block: DeckBlock, ctx: Ctx, area: Area): string {
  const b = `--b:${ctx.order}`;
  const labels = LABELS[ctx.language];
  switch (block.type) {
    case 'paragraph':
      return `<p class="b-para" ${intentAttr(block)} style="${b}">${xml(block.text)}</p>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag} class="b-list${block.ordered ? ' is-ordered' : ''}" ${intentAttr(block)} style="${b}">${block.items
        .map(
          (item, index) =>
            `<li style="--i:${index}">${block.ordered ? `<span class="li-num">${String(index + 1).padStart(2, '0')}</span>` : '<span class="li-dot" aria-hidden="true"></span>'}<span class="li-text">${xml(item)}</span></li>`
        )
        .join('')}</${tag}>`;
    }
    case 'metric':
      return `<div class="metric-grid" style="--n:1">${renderMetric(block, 0, ctx)}</div>`;
    case 'chart': {
      const pie = block.chartType === 'pie' || block.chartType === 'donut';
      const wide = area === 'full' ? 1104 : area === 'main' ? 700 : 400;
      const width = pie ? 340 : wide;
      const height = pie ? 340 : area === 'aside' ? 260 : 360;
      const id = `lmg-${ctx.slideIndex}-${ctx.blockId++}`;
      const caption =
        block.title || block.unit
          ? `<figcaption class="chart-cap">${block.title ? `<span class="chart-title">${xml(block.title)}</span>` : ''}${block.unit ? `<span class="chart-unit">${xml(labels.unit)}：${xml(block.unit)}</span>` : ''}</figcaption>`
          : '';
      return `<figure class="b-chart${pie ? ' is-pie' : ''}" ${intentAttr(block)} style="${b}">${caption}<div class="chart-body">${chartSvg(block, width, height, ctx.colors, id, ctx.language)}${chartLegend(block, ctx.colors)}</div></figure>`;
    }
    case 'timeline':
      return renderTimeline(block, ctx, area);
    case 'table':
      return `<div class="b-table" style="${b}"><table><thead><tr>${block.columns
        .map(col => `<th>${xml(col)}</th>`)
        .join('')}</tr></thead><tbody ${intentAttr(block)}>${block.rows
        .map(
          (row, index) =>
            `<tr style="--i:${index}">${row.map(cell => `<td>${xml(cell)}</td>`).join('')}</tr>`
        )
        .join('')}</tbody></table></div>`;
    case 'callout':
      return `<aside class="b-callout tone-${block.tone}" ${intentAttr(block)} style="${b}"><span class="callout-label">${xml(labels[block.tone])}</span><p>${xml(block.text)}</p></aside>`;
    case 'quote':
      return `<blockquote class="b-quote" ${intentAttr(block)} style="${b}"><p>${xml(block.text)}</p>${block.by ? `<cite>${xml(block.by)}</cite>` : ''}</blockquote>`;
    default:
      return '';
  }
}

/** Renders blocks in order, grouping consecutive metrics into one grid. */
function renderBlocks(blocks: DeckBlock[], ctx: Ctx, area: Area): string {
  const out: string[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type === 'metric') {
      const group: Extract<DeckBlock, { type: 'metric' }>[] = [];
      while (index < blocks.length && blocks[index].type === 'metric') {
        group.push(blocks[index] as Extract<DeckBlock, { type: 'metric' }>);
        index++;
      }
      index--;
      const columns =
        area === 'aside'
          ? 1
          : group.length === 4
            ? 4
            : group.length >= 5
              ? 3
              : group.length;
      const cards = group.map((metric, i) => renderMetric(metric, i, ctx));
      ctx.order++;
      out.push(
        `<div class="metric-grid${area === 'aside' || area === 'cover' ? '' : group.length <= 2 ? ' is-large' : group.length === 3 ? ' is-mid' : ''}" style="--n:${columns}">${cards.join('')}</div>`
      );
      continue;
    }
    out.push(renderBlock(block, ctx, area));
    ctx.order++;
  }
  return out.join('');
}

const isAside = (block: DeckBlock) =>
  block.type === 'callout' || block.type === 'quote' || block.type === 'metric';

function splitBody(main: DeckBlock[], aside: DeckBlock[], ctx: Ctx) {
  if (!aside.length) return renderBlocks(main, ctx, 'full');
  if (!main.length) return renderBlocks(aside, ctx, 'full');
  const left = renderBlocks(main, ctx, 'main');
  const right = renderBlocks(aside, ctx, 'aside');
  return `<div class="split"><div class="split-main">${left}</div><div class="split-aside">${right}</div></div>`;
}

function comparisonBody(blocks: DeckBlock[], ctx: Ctx) {
  // A short paragraph followed by another block becomes that card's heading.
  const cards: { heading?: string; blocks: DeckBlock[] }[] = [];
  const rest: DeckBlock[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type === 'callout' || block.type === 'quote') {
      rest.push(block);
      continue;
    }
    const nextBlock = blocks[index + 1];
    if (
      block.type === 'paragraph' &&
      Array.from(block.text).length <= 32 &&
      nextBlock &&
      nextBlock.type !== 'paragraph' &&
      nextBlock.type !== 'callout' &&
      nextBlock.type !== 'quote'
    ) {
      cards.push({ heading: block.text, blocks: [nextBlock] });
      index++;
    } else cards.push({ blocks: [block] });
  }
  const labels = LABELS[ctx.language];
  const html = cards
    .map(
      (card, index) =>
        `<div class="compare-card${index === cards.length - 1 && cards.length > 1 ? ' is-last' : ''}" data-intent="hero" style="--b:${ctx.order};--i:${index}">${card.heading ? `<h3 class="compare-head">${xml(card.heading)}</h3>` : ''}${renderBlocks(card.blocks, ctx, cards.length > 2 ? 'aside' : 'main')}</div>`
    )
    .join(
      cards.length === 2
        ? `<div class="compare-vs" aria-hidden="true">${labels.vs}</div>`
        : ''
    );
  return `<div class="compare-grid" style="--n:${Math.max(1, cards.length)}">${html}</div>${rest.length ? `<div class="row">${renderBlocks(rest, ctx, 'full')}</div>` : ''}`;
}

/* ---------------------------------------------------------------- slides */

function renderSlide(
  spec: DeckSpec,
  slide: DeckSlide,
  index: number,
  total: number,
  template: DeckTemplate,
  colors: Palette,
  input: { language: DeckLanguage; citations?: boolean },
  sectionNumber: number
): string {
  const ctx: Ctx = {
    colors,
    language: input.language,
    slideIndex: index,
    order: 1,
    blockId: 0,
  };
  const labels = LABELS[input.language];
  const decor = template.theme.decor
    ? `<div class="decor" aria-hidden="true">${template.theme.decor}</div>`
    : '';
  const kicker = (value?: string) =>
    value ? `<p class="kicker">${xml(value)}</p>` : '';
  const cite =
    input.citations && slide.citations?.length
      ? `<footer class="slide-cite"><span>${xml(labels.sources)}</span>${slide.citations.map(c => `<span class="cite-item">${xml(c)}</span>`).join('')}</footer>`
      : '';
  const running =
    slide.layout === 'cover'
      ? ''
      : `<div class="running" aria-hidden="true"><span>${xml(spec.title)}</span>${spec.period ? `<span>${xml(spec.period)}</span>` : ''}</div>`;
  let inner: string;
  switch (slide.layout) {
    case 'cover': {
      const sub = spec.subtitle
        ? `<p class="cover-sub" data-intent="hero" style="--b:0;--i:2">${xml(spec.subtitle)}</p>`
        : '';
      inner = `${decor}<div class="cover-main">${kicker(slide.kicker ?? spec.period)}<h1 class="cover-title" data-intent="hero" style="--b:0;--i:0">${xml(slide.title)}</h1><span class="hero-rule" aria-hidden="true"></span>${sub}${slide.blocks.length ? `<div class="cover-blocks">${renderBlocks(slide.blocks, ctx, 'cover')}</div>` : ''}</div>${spec.period && slide.kicker ? `<div class="cover-foot">${xml(spec.period)}</div>` : ''}`;
      break;
    }
    case 'section':
      inner = `${decor}<div class="section-main"><span class="section-index" aria-hidden="true">${String(sectionNumber).padStart(2, '0')}</span>${kicker(slide.kicker)}<h2 class="section-title" data-intent="hero" style="--b:0;--i:0">${xml(slide.title)}</h2><span class="hero-rule" aria-hidden="true"></span>${slide.blocks.length ? `<div class="section-blocks">${renderBlocks(slide.blocks, ctx, 'full')}</div>` : ''}</div>`;
      break;
    case 'closing':
      inner = `${decor}<div class="closing-main">${kicker(slide.kicker)}<h2 class="closing-title" data-intent="hero" style="--b:0;--i:0">${xml(slide.title)}</h2><span class="hero-rule" aria-hidden="true"></span>${slide.blocks.length ? `<div class="closing-blocks">${renderBlocks(slide.blocks, ctx, 'full')}</div>` : ''}</div>`;
      break;
    case 'quote': {
      const quotes = slide.blocks.filter(block => block.type === 'quote');
      const others = slide.blocks.filter(block => block.type !== 'quote');
      inner = `<header class="slide-head">${kicker(slide.kicker)}<h2 class="slide-title">${xml(slide.title)}</h2></header><div class="slide-body quote-body">${renderBlocks(quotes, ctx, 'full')}${others.length ? `<div class="row">${renderBlocks(others, ctx, 'full')}</div>` : ''}</div>`;
      break;
    }
    default: {
      let body: string;
      const blocks = slide.blocks;
      if (slide.layout === 'comparison') body = comparisonBody(blocks, ctx);
      else if (slide.layout === 'chart') {
        const charts = blocks.filter(block => block.type === 'chart');
        const others = blocks.filter(block => block.type !== 'chart');
        body = splitBody(charts, others, ctx);
      } else if (slide.layout === 'metrics') {
        const metrics = blocks.filter(block => block.type === 'metric');
        const others = blocks.filter(block => block.type !== 'metric');
        body = `${renderBlocks(metrics, ctx, 'full')}${others.length ? `<div class="row" style="--n:${others.length}">${renderBlocks(others, ctx, others.length > 1 ? 'aside' : 'full')}</div>` : ''}`;
      } else if (slide.layout === 'timeline' || slide.layout === 'table') {
        const kind = slide.layout;
        const mains = blocks.filter(block => block.type === kind);
        const others = blocks.filter(block => block.type !== kind);
        body = `${renderBlocks(mains, ctx, 'full')}${others.length ? `<div class="row" style="--n:${others.length}">${renderBlocks(others, ctx, others.length > 1 ? 'aside' : 'full')}</div>` : ''}`;
      } else {
        const main = blocks.filter(block => !isAside(block));
        const aside = blocks.filter(isAside);
        body = splitBody(main, aside, ctx);
      }
      inner = `<header class="slide-head">${kicker(slide.kicker)}<h2 class="slide-title">${xml(slide.title)}</h2></header><div class="slide-body">${body}</div>`;
    }
  }
  return `<section class="slide layout-${slide.layout}${index === 0 ? ' is-active' : ''}" data-slide data-layout="${slide.layout}" aria-label="${xml(labels.slide(index + 1))} / ${total}"><div class="slide-fit">${inner}${cite}</div>${running}</section>`;
}

/* ---------------------------------------------------------------- css */

const BASE_CSS = `
.slide{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:22px;line-height:1.5}
.slide-fit{display:flex;flex-direction:column;gap:30px;padding:60px 88px 64px;z-index:1}
.slide h1,.slide h2,.slide h3,.slide p,.slide ul,.slide ol,.slide figure,.slide blockquote{margin:0}
.decor{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.decor svg{position:absolute;inset:0;width:100%;height:100%}
.decor .da{fill:var(--accent)}.decor .da2{fill:var(--accent2)}.decor .dfg{fill:var(--fg)}.decor .dsf{fill:var(--surface)}
.decor .sa{fill:none;stroke:var(--accent)}.decor .sa2{fill:none;stroke:var(--accent2)}.decor .sfg{fill:none;stroke:var(--fg)}
.decor~*{position:relative;z-index:1}
.kicker{font-size:15px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);line-height:1.2}
.slide-head{display:flex;flex-direction:column;gap:12px;max-width:1040px}
.slide-title{font-size:42px;line-height:1.2;font-weight:760;letter-spacing:-.012em;text-wrap:balance}
.slide-body{flex:1 1 auto;display:flex;flex-direction:column;gap:26px;justify-content:center;padding-bottom:12px}
.running{position:absolute;left:88px;right:120px;bottom:22px;display:flex;gap:18px;font-size:12px;letter-spacing:.08em;color:var(--muted);opacity:.75;z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slide-cite{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--muted);margin-top:auto;padding-top:10px;border-top:1px solid var(--line)}
.slide-cite>span:first-child{font-weight:700;color:var(--fg);opacity:.75}
.cite-item::before{content:"·";margin-right:8px;opacity:.6}
.cite-item:first-of-type::before{content:none}
/* text blocks */
.b-para{font-size:23px;line-height:1.65;color:color-mix(in srgb,var(--fg) 82%,var(--bg));max-width:980px;text-wrap:pretty}
.b-list{list-style:none;padding:0;display:flex;flex-direction:column;gap:16px}
.b-list>li{display:flex;gap:18px;align-items:baseline;font-size:24px;line-height:1.5;text-wrap:pretty}
.li-dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--accent);transform:translateY(-3px)}
.li-num{flex:none;min-width:40px;font-size:18px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;letter-spacing:.04em}
.split{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:44px;align-items:start}
.split-main,.split-aside{display:flex;flex-direction:column;gap:22px;min-width:0}
.row{display:grid;grid-template-columns:repeat(var(--n,1),minmax(0,1fr));gap:22px;align-items:start}
/* metrics */
.metric-grid{display:grid;grid-template-columns:repeat(var(--n,3),minmax(0,1fr));gap:20px}
.b-metric{position:relative;display:flex;flex-direction:column;gap:12px;padding:28px 28px 26px;border-radius:22px;background:var(--surface);border:1px solid var(--line);overflow:hidden;min-width:0}
.b-metric::before{content:"";position:absolute;left:0;top:0;right:0;height:4px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.metric-label{font-size:17px;font-weight:600;color:var(--muted);line-height:1.35}
.metric-value{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;line-height:1}
.metric-num{font-size:58px;font-weight:820;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:var(--fg)}
.metric-unit{font-size:22px;font-weight:650;color:var(--muted)}
.metric-grid.is-large .metric-num{font-size:84px}
.metric-grid.is-mid .metric-num{font-size:68px}
.metric-delta{align-self:flex-start;display:inline-flex;gap:6px;align-items:center;padding:5px 12px;border-radius:999px;font-size:15px;font-weight:700;background:color-mix(in srgb,var(--muted) 14%,transparent);color:var(--muted)}
.metric-delta .arrow{font-size:10px}
.trend-up .metric-delta{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.trend-down .metric-delta{background:color-mix(in srgb,#e5484d 16%,transparent);color:#d6343a}
.split-aside .b-metric{padding:20px 22px}
.split-aside .metric-num,.row .metric-num{font-size:44px}
/* charts */
.b-chart{display:flex;flex-direction:column;gap:12px;min-width:0}
.chart-cap{display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.chart-title{font-size:19px;font-weight:700}
.chart-unit{font-size:14px;color:var(--muted)}
.chart-body{display:flex;flex-direction:column;gap:14px}
.deck-chart{display:block;max-width:100%;height:auto;overflow:visible;font-family:var(--font)}
.b-chart.is-pie .chart-body{flex-direction:row;align-items:center;gap:44px}
.deck-legend{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:10px 22px;font-size:16px;color:var(--muted)}
.deck-legend li{display:flex;align-items:center;gap:8px}
.deck-legend .sw{width:12px;height:12px;border-radius:4px;flex:none}
.legend-pie{flex-direction:column;gap:14px;font-size:19px;color:var(--fg);min-width:220px}
.legend-pie .lg-val{margin-left:auto;padding-left:24px;font-weight:800;font-variant-numeric:tabular-nums}
.legend-pie .sw{width:14px;height:14px}
/* timeline */
.b-timeline{position:relative}
.tl-list{list-style:none;padding:0;margin:0}
.tl-horizontal .tl-list{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:22px}
.tl-horizontal .tl-rail{position:absolute;left:0;right:0;top:9px;height:4px}
.tl-track,.tl-fill{position:absolute;inset:0;border-radius:4px}
.tl-track{background:var(--line)}
.tl-fill{background:linear-gradient(90deg,var(--accent),var(--accent2));transform:scaleX(var(--p))}
.tl-item{position:relative;display:flex;flex-direction:column;gap:8px;min-width:0}
.tl-node{width:22px;height:22px;border-radius:50%;background:var(--bg);border:4px solid var(--line);margin-bottom:14px;position:relative;z-index:1}
.status-done .tl-node{background:var(--accent);border-color:var(--accent)}
.status-active .tl-node{border-color:var(--accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 22%,transparent)}
.status-risk .tl-node{border-color:#e5484d;box-shadow:0 0 0 6px color-mix(in srgb,#e5484d 20%,transparent)}
.tl-date{font-size:15px;font-weight:700;letter-spacing:.06em;color:var(--accent);font-variant-numeric:tabular-nums}
.tl-title{font-size:21px;line-height:1.35;font-weight:700}
.tl-detail{font-size:16px;line-height:1.5;color:var(--muted)}
.tl-status{align-self:flex-start;font-size:13px;font-weight:700;padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--muted) 14%,transparent);color:var(--muted)}
.status-done .tl-status,.status-active .tl-status{background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent)}
.status-risk .tl-status{background:color-mix(in srgb,#e5484d 15%,transparent);color:#d6343a}
.tl-vertical{padding-left:38px}
.tl-vertical .tl-rail{position:absolute;left:9px;top:8px;bottom:8px;width:4px}
.tl-vertical .tl-fill{background:linear-gradient(180deg,var(--accent),var(--accent2));transform:scaleY(var(--p))}
.tl-vertical .tl-list{display:flex;flex-direction:column;gap:14px}
.tl-vertical .tl-item{display:grid;grid-template-columns:150px minmax(0,1fr) auto;column-gap:18px;align-items:baseline}
.tl-vertical .tl-node{position:absolute;left:-38px;top:4px;margin:0}
.tl-vertical .tl-detail{grid-column:2/3}
.tl-vertical .tl-status{grid-row:1;grid-column:3}
/* table */
.b-table{border-radius:18px;overflow:hidden;border:1px solid var(--line);background:var(--surface)}
.b-table table{width:100%;border-collapse:collapse;font-size:18px;line-height:1.45}
.b-table th{text-align:left;font-size:15px;font-weight:700;letter-spacing:.04em;color:var(--muted);padding:16px 22px;background:color-mix(in srgb,var(--accent) 9%,var(--surface));border-bottom:1px solid var(--line)}
.b-table td{padding:15px 22px;border-bottom:1px solid var(--line);vertical-align:top}
.b-table tr:last-child td{border-bottom:0}
.b-table td:first-child{font-weight:700}
/* callout & quote */
.b-callout{display:flex;flex-direction:column;gap:8px;padding:22px 26px;border-radius:18px;background:color-mix(in srgb,var(--accent) 10%,var(--surface));border-left:5px solid var(--accent)}
.b-callout p{font-size:20px;line-height:1.55}
.callout-label{font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}
.tone-risk{background:color-mix(in srgb,#e5484d 9%,var(--surface));border-left-color:#e5484d}
.tone-risk .callout-label{color:#d6343a}
.tone-decision{background:color-mix(in srgb,var(--accent2) 12%,var(--surface));border-left-color:var(--accent2)}
.tone-decision .callout-label{color:var(--accent2)}
.b-quote{position:relative;padding:8px 0 0 64px}
.b-quote::before{content:"\\201C";position:absolute;left:-6px;top:-34px;font-size:150px;line-height:1;font-weight:800;color:var(--accent);opacity:.9;font-family:Georgia,serif}
.b-quote p{font-size:28px;line-height:1.55;font-weight:600;text-wrap:pretty}
.b-quote cite{display:block;margin-top:16px;font-style:normal;font-size:17px;color:var(--muted);font-weight:600}
.b-quote cite::before{content:"— "}
.quote-body{justify-content:center}
.quote-body>.b-quote{padding-left:84px}
.quote-body>.b-quote p{font-size:38px;line-height:1.45;max-width:1000px}
/* comparison */
.compare-grid{display:flex;gap:22px;align-items:stretch}
.compare-card{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:18px;padding:30px 32px;border-radius:24px;background:var(--surface);border:1px solid var(--line)}
.compare-card.is-last{background:color-mix(in srgb,var(--accent) 9%,var(--surface));border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
.compare-head{font-size:24px;font-weight:780;letter-spacing:-.01em}
.compare-card.is-last .compare-head{color:var(--accent)}
.compare-card .b-list>li{font-size:20px}
.compare-vs{align-self:center;flex:none;width:58px;height:58px;margin:0 -40px;z-index:2;display:grid;place-items:center;border-radius:50%;background:var(--fg);color:var(--bg);font-size:15px;font-weight:800;letter-spacing:.06em}
/* cover */
.layout-cover .slide-fit{justify-content:center;padding:80px 96px}
.cover-main{display:flex;flex-direction:column;gap:22px;max-width:var(--hero-max,860px)}
.cover-title{font-size:74px;line-height:1.1;font-weight:820;letter-spacing:-.025em;text-wrap:balance}
.hero-rule{display:block;width:96px;height:6px;border-radius:6px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.cover-sub{font-size:26px;line-height:1.5;color:var(--muted);max-width:760px;text-wrap:pretty}
.cover-blocks{display:flex;flex-direction:column;gap:18px;margin-top:14px}
.cover-blocks .b-metric{padding:18px 22px}
.cover-blocks .metric-num{font-size:40px}
.cover-foot{position:absolute;left:96px;bottom:54px;font-size:15px;letter-spacing:.12em;color:var(--muted)}
/* section */
.layout-section .slide-fit{justify-content:center;padding:80px 96px}
.section-main{display:flex;flex-direction:column;gap:20px;max-width:var(--hero-max,900px)}
.section-index{font-size:120px;line-height:.9;font-weight:850;letter-spacing:-.04em;color:var(--accent);opacity:.9;font-variant-numeric:tabular-nums}
.section-title{font-size:62px;line-height:1.12;font-weight:800;letter-spacing:-.02em;text-wrap:balance}
.section-blocks{margin-top:8px;display:flex;flex-direction:column;gap:16px}
/* closing */
.layout-closing .slide-fit{justify-content:center;padding:80px 96px}
.closing-main{display:flex;flex-direction:column;gap:22px;max-width:var(--hero-max,860px)}
.closing-title{font-size:68px;line-height:1.1;font-weight:820;letter-spacing:-.025em;text-wrap:balance}
.closing-blocks{display:flex;flex-direction:column;gap:20px;margin-top:10px}
.closing-blocks .b-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.closing-blocks .b-list>li{flex-direction:column;gap:10px;padding:20px 22px;border-radius:18px;background:var(--surface);border:1px solid var(--line);font-size:19px}
.closing-blocks .li-dot{transform:none}
`;

function themeVars(template: DeckTemplate, colors: Palette) {
  const font =
    template.theme.fontStyle === 'serif' ? DECK_FONT_SERIF : DECK_FONT_SANS;
  const onAccent = luminance(colors.accent) > 0.45 ? '#111111' : '#ffffff';
  return `:root{--bg:${colors.bg};--surface:${colors.surface};--fg:${colors.fg};--muted:${colors.muted};--accent:${colors.accent};--accent2:${colors.accent2};--line:${colors.line};--on-accent:${onAccent};--font:${font};--deck-font:${font}}`;
}

/** Full deck CSS for a template: theme variables, layouts, template overrides, motion. */
export function renderDeckCss(template: DeckTemplate, accentColor?: string) {
  const colors = palette(template, accentColor);
  return `${themeVars(template, colors)}${BASE_CSS}${template.css ?? ''}${deckMotionCss(template.motion)}`;
}

export type DeckFragment = {
  slidesHtml: string;
  css: string;
  slideCount: number;
};

export function renderDeckSlidesFragment(input: DeckRenderInput): DeckFragment {
  const colors = palette(input.template, input.accentColor);
  let section = 0;
  const total = input.spec.slides.length;
  const slidesHtml = input.spec.slides
    .map((slide, index) => {
      if (slide.layout === 'section') section++;
      return renderSlide(
        input.spec,
        slide,
        index,
        total,
        input.template,
        colors,
        input,
        section
      );
    })
    .join('\n');
  return {
    slidesHtml,
    css: renderDeckCss(input.template, input.accentColor),
    slideCount: total,
  };
}

export function renderDeckHtml(input: DeckRenderInput): DeckRenderResult {
  const fragment = renderDeckSlidesFragment(input);
  return {
    html: wrapDeckHtml({
      title: input.spec.title,
      lang: input.language,
      css: fragment.css,
      slidesHtml: fragment.slidesHtml,
      transition: deckTransitionFor(input.template),
    }),
    slideCount: fragment.slideCount,
  };
}

const deckTransitionFor = (template: DeckTemplate) =>
  deckMotionTransition(template.motion);

/**
 * A static, chrome-less document containing only the cover slide, for
 * template-gallery thumbnails. Scale the iframe (1280×720) to fit.
 */
export function renderDeckCover(
  spec: DeckSpec,
  template: DeckTemplate,
  options: { accentColor?: string; language?: DeckLanguage } = {}
): string {
  const cover =
    spec.slides.find(slide => slide.layout === 'cover') ?? spec.slides[0];
  const language = options.language ?? 'zh-CN';
  const colors = palette(template, options.accentColor);
  const slidesHtml = renderSlide(
    spec,
    cover,
    0,
    1,
    template,
    colors,
    { language },
    1
  );
  return wrapDeckHtml({
    title: spec.title,
    lang: language,
    css: renderDeckCss(template, options.accentColor),
    slidesHtml,
    transition: 'none',
    chrome: false,
    static: true,
  });
}

export { DECK_STAGE };
