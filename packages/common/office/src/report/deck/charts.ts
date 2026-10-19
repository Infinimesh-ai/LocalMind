import { z } from 'zod';

import type { ReportDataset } from './evidence';

/**
 * Deterministic chart components for web reports (v4). The model chooses the
 * encoding; values, scales, ticks and labels come from a grounded dataset, so
 * the rendered geometry cannot drift from the evidence. Output is static SVG
 * plus a data table, enhanced by the trusted runtime (reveal / linking).
 */

export const ChartMarkSchema = z.enum([
  'bar',
  'column',
  'line',
  'dot',
  'unit',
  'stack',
]);
export type ChartMark = z.infer<typeof ChartMarkSchema>;

export const ReportChartSpecSchema = z
  .object({
    id: z.string().regex(/^rd-c-[a-z0-9-]{1,90}$/),
    dataset: z.string().regex(/^ds-[a-z0-9-]{1,40}$/),
    mark: ChartMarkSchema,
    highlight: z.array(z.string().trim().min(1).max(60)).max(6),
    sort: z.enum(['none', 'desc', 'asc']),
    valueLabels: z.enum(['all', 'highlight', 'ends', 'none']),
    takeaway: z.string().trim().min(1).max(160),
  })
  .strict();
export type ReportChartSpec = z.infer<typeof ReportChartSpecSchema>;

const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const wide = (ch: string) => /[⺀-￿]/.test(ch);
export const textWidth = (text: string, size: number) =>
  Array.from(text).reduce((w, ch) => w + (wide(ch) ? 1 : 0.58), 0) * size;

const r = (n: number) => Math.round(n * 10) / 10;

function niceStep(range: number, ticks: number) {
  const raw = range / Math.max(1, ticks);
  const power = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * power;
}

function tickText(n: number) {
  const fixed = Number(n.toFixed(6));
  return String(Object.is(fixed, -0) ? 0 : fixed);
}

type Row = ReportDataset['rows'][number] & { index: number; hl: boolean };

function prepare(spec: ReportChartSpec, dataset: ReportDataset) {
  const rows: Row[] = dataset.rows.map((row, index) => ({
    ...row,
    index,
    hl: spec.highlight.includes(row.label),
  }));
  if (dataset.kind !== 'series' && spec.sort !== 'none')
    rows.sort((a, b) =>
      spec.sort === 'desc' ? b.numeric - a.numeric : a.numeric - b.numeric
    );
  return rows;
}

const markClass = (row: Row, anyHighlight: boolean) =>
  anyHighlight
    ? row.hl
      ? 'rd-mark rd-mark-hl'
      : 'rd-mark rd-mark-base'
    : 'rd-mark';

const keyAttr = (row: Row) => `data-rd-key="${esc(row.label)}"`;

function showValue(
  spec: ReportChartSpec,
  row: Row,
  position: number,
  count: number
) {
  switch (spec.valueLabels) {
    case 'none':
      return false;
    case 'highlight':
      return row.hl;
    case 'ends':
      return position === 0 || position === count - 1 || row.hl;
    default:
      return count <= 12 || row.hl || position === 0 || position === count - 1;
  }
}

function svg(
  variant: 'd' | 'm',
  width: number,
  height: number,
  label: string,
  body: string
) {
  return `<svg class="rd-chart-${variant}" data-rd-variant="${variant}" viewBox="0 0 ${width} ${r(height)}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMinYMin meet">${body}</svg>`;
}

/** Horizontal bars: robust for long labels and narrow screens. */
function bars(
  spec: ReportChartSpec,
  rows: Row[],
  width: number,
  size: number,
  lollipop = false
) {
  const any = rows.some(row => row.hl);
  const labelW = Math.min(
    width * 0.42,
    Math.max(...rows.map(row => textWidth(row.label, size))) + size
  );
  const valueW =
    Math.max(...rows.map(row => textWidth(row.value, size))) + size;
  const plotX = labelW;
  const plotW = Math.max(40, width - labelW - valueW);
  const min = Math.min(0, ...rows.map(row => row.numeric));
  const max = Math.max(0, ...rows.map(row => row.numeric));
  const span = max - min || 1;
  const x = (v: number) => plotX + ((v - min) / span) * plotW;
  const band = size * 2.6;
  const thick = lollipop ? 2 : band * 0.62;
  let body = '';
  rows.forEach((row, i) => {
    const y = i * band;
    const x0 = x(0);
    const x1 = x(row.numeric);
    const left = Math.min(x0, x1);
    const neg = row.numeric < 0;
    const cy = y + band / 2;
    body += `<g class="rd-chart-row" ${keyAttr(row)}>`;
    body += `<text class="rd-chart-label" x="${r(labelW - size * 0.6)}" y="${r(cy)}" text-anchor="end" dominant-baseline="middle">${esc(row.label)}</text>`;
    if (lollipop) {
      body += `<line class="rd-chart-stem" x1="${r(x0)}" x2="${r(x1)}" y1="${r(cy)}" y2="${r(cy)}" data-rd-reveal="grow" data-rd-axis="${neg ? 'x-neg' : 'x'}" data-rd-seq="1"/>`;
      body += `<circle class="${markClass(row, any)}" cx="${r(x1)}" cy="${r(cy)}" r="${r(size * 0.42)}" data-rd-reveal="scale" data-rd-seq="5"/>`;
    } else
      body += `<rect class="${markClass(row, any)}" x="${r(left)}" y="${r(cy - thick / 2)}" width="${r(Math.max(1, Math.abs(x1 - x0)))}" height="${r(thick)}" rx="${r(Math.min(3, thick / 4))}" data-rd-reveal="grow" data-rd-axis="${neg ? 'x-neg' : 'x'}" data-rd-seq="1"/>`;
    if (showValue(spec, row, i, rows.length))
      body += `<text class="rd-chart-value${row.hl ? ' rd-chart-value-hl' : ''}" x="${r(neg ? left - size * 0.4 : Math.max(x0, x1) + size * 0.5)}" y="${r(cy)}" text-anchor="${neg ? 'end' : 'start'}" dominant-baseline="middle" data-rd-reveal="fade" data-rd-seq="6">${esc(row.value)}</text>`;
    body += '</g>';
  });
  body += `<line class="rd-chart-baseline" x1="${r(x(0))}" x2="${r(x(0))}" y1="0" y2="${r(rows.length * band)}"/>`;
  return { body, height: rows.length * band + 2 };
}

function columns(
  spec: ReportChartSpec,
  rows: Row[],
  width: number,
  size: number
) {
  const any = rows.some(row => row.hl);
  const top = size * 2;
  const plotH = width * 0.36;
  const slot = width / rows.length;
  const min = Math.min(0, ...rows.map(row => row.numeric));
  const max = Math.max(0, ...rows.map(row => row.numeric));
  const span = max - min || 1;
  const y = (v: number) => top + plotH - ((v - min) / span) * plotH;
  let body = '';
  rows.forEach((row, i) => {
    const cx = slot * i + slot / 2;
    const y0 = y(0);
    const y1 = y(row.numeric);
    const neg = row.numeric < 0;
    const w = slot * 0.6;
    body += `<g class="rd-chart-col" ${keyAttr(row)}>`;
    body += `<rect class="${markClass(row, any)}" x="${r(cx - w / 2)}" y="${r(Math.min(y0, y1))}" width="${r(w)}" height="${r(Math.max(1, Math.abs(y1 - y0)))}" rx="2" data-rd-reveal="grow" data-rd-axis="${neg ? 'y-neg' : 'y'}" data-rd-seq="1"/>`;
    if (showValue(spec, row, i, rows.length))
      body += `<text class="rd-chart-value${row.hl ? ' rd-chart-value-hl' : ''}" x="${r(cx)}" y="${r(neg ? y1 + size * 1.2 : y1 - size * 0.5)}" text-anchor="middle" data-rd-reveal="fade" data-rd-seq="6">${esc(row.value)}</text>`;
    body += `<text class="rd-chart-label" x="${r(cx)}" y="${r(top + plotH + size * 1.5)}" text-anchor="middle">${esc(row.label)}</text>`;
    body += '</g>';
  });
  body += `<line class="rd-chart-baseline" x1="0" x2="${width}" y1="${r(y(0))}" y2="${r(y(0))}"/>`;
  return { body, height: top + plotH + size * 2.2 };
}

function line(spec: ReportChartSpec, rows: Row[], width: number, size: number) {
  const values = rows.map(row => row.numeric);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min >= 0 && min < (max - min) * 1.5) min = 0;
  if (max === min) max = min + 1;
  const step = niceStep(max - min, width < 500 ? 3 : 4);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const axisW =
    Math.max(textWidth(tickText(lo), size), textWidth(tickText(hi), size)) +
    size;
  const top = size * 2;
  const plotH = width * (width < 500 ? 0.62 : 0.4);
  const left = axisW;
  const right =
    width - Math.max(size * 2, textWidth(rows.at(-1)?.value ?? '', size));
  const x = (i: number) =>
    left + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * (right - left));
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
  let body = '<g class="rd-chart-axis">';
  for (let t = lo; t <= hi + step / 2; t += step) {
    body += `<line class="rd-chart-grid" x1="${r(left)}" x2="${r(right)}" y1="${r(y(t))}" y2="${r(y(t))}"/>`;
    body += `<text class="rd-chart-tick" x="${r(left - size * 0.5)}" y="${r(y(t))}" text-anchor="end" dominant-baseline="middle">${tickText(t)}</text>`;
  }
  body += '</g>';
  const fit = Math.max(
    1,
    Math.ceil(
      (rows.length * textWidth(rows[0].label, size) * 1.3) / (right - left)
    )
  );
  rows.forEach((row, i) => {
    if (i % fit === 0 || i === rows.length - 1 || row.hl)
      body += `<text class="rd-chart-label" x="${r(x(i))}" y="${r(top + plotH + size * 1.6)}" text-anchor="middle">${esc(row.label)}</text>`;
  });
  const points = rows.map((row, i) => `${r(x(i))},${r(y(row.numeric))}`);
  body += `<polyline class="rd-chart-line" points="${points.join(' ')}" pathLength="1" data-rd-reveal="draw" data-rd-seq="1" data-rd-dur="long"/>`;
  rows.forEach((row, i) => {
    const any = rows.some(item => item.hl);
    body += `<g ${keyAttr(row)}><circle class="${markClass(row, any)} rd-chart-point" cx="${r(x(i))}" cy="${r(y(row.numeric))}" r="${r(row.hl ? size * 0.42 : size * 0.26)}" data-rd-reveal="scale" data-rd-seq="5"/>`;
    if (showValue(spec, row, i, rows.length))
      body += `<text class="rd-chart-value${row.hl ? ' rd-chart-value-hl' : ''}" x="${r(x(i))}" y="${r(y(row.numeric) - size * 0.9)}" text-anchor="middle" data-rd-reveal="fade" data-rd-seq="6">${esc(row.value)}</text>`;
    body += '</g>';
  });
  return { body, height: top + plotH + size * 2.4 };
}

/** Highlighted categories take the accent; others step through ink tones. */
function seriesClass(rows: Row[], row: Row, index: number) {
  if (!rows.some(item => item.hl)) return `rd-s${(index % 6) + 1}`;
  if (row.hl) return 'rd-s1';
  const rank = rows.filter(item => !item.hl).indexOf(row);
  return ['rd-s2', 'rd-s4', 'rd-s6', 'rd-s5', 'rd-s3'][rank % 5];
}

function units(rows: Row[], width: number, size: number) {
  const cell = Math.max(size * 1.1, Math.min(size * 2.2, width / 22));
  const gap = cell * 0.22;
  const perRow = Math.max(5, Math.floor((width + gap) / (cell + gap)));
  let body = '';
  let n = 0;
  rows.forEach((row, series) => {
    body += `<g class="rd-chart-units ${seriesClass(rows, row, series)}" ${keyAttr(row)} data-rd-reveal="fade" data-rd-seq="${series + 1}">`;
    for (let k = 0; k < row.numeric; k++, n++) {
      const cx = (n % perRow) * (cell + gap);
      const cy = Math.floor(n / perRow) * (cell + gap);
      body += `<rect class="rd-unit" x="${r(cx)}" y="${r(cy)}" width="${r(cell)}" height="${r(cell)}" rx="${r(cell * 0.18)}"/>`;
    }
    body += '</g>';
  });
  const height = Math.ceil(n / perRow) * (cell + gap);
  return { body, height };
}

function stack(rows: Row[], width: number, size: number) {
  const total = rows.reduce((sum, row) => sum + row.numeric, 0) || 1;
  const h = size * 3;
  let x = 0;
  let body = '';
  rows.forEach((row, series) => {
    const w = (row.numeric / total) * width;
    body += `<rect class="rd-chart-seg ${seriesClass(rows, row, series)}" ${keyAttr(row)} x="${r(x)}" y="0" width="${r(Math.max(0.5, w - 2))}" height="${r(h)}" data-rd-reveal="grow" data-rd-axis="x" data-rd-seq="${series + 1}"/>`;
    x += w;
  });
  return { body, height: h + 2 };
}

function legend(rows: Row[], language: string) {
  const items = rows
    .map(
      (row, i) =>
        `<li class="rd-chart-key ${seriesClass(rows, row, i)}" ${keyAttr(row)}><span class="rd-chart-swatch" aria-hidden="true"></span><span class="rd-chart-key-label">${esc(row.label)}</span> <b class="rd-chart-key-value">${esc(row.value)}</b></li>`
    )
    .join('');
  return `<ul class="rd-chart-legend" aria-label="${language === 'en' ? 'Legend' : '图例'}">${items}</ul>`;
}

function table(dataset: ReportDataset, language: string) {
  const zh = language !== 'en';
  const head = `<thead><tr><th>${zh ? '项目' : 'Item'}</th><th>${zh ? '数值' : 'Value'}${dataset.unit ? `（${esc(dataset.unit)}）` : ''}</th></tr></thead>`;
  const body = dataset.rows
    .map(row => `<tr><td>${esc(row.label)}</td><td>${esc(row.value)}</td></tr>`)
    .join('');
  return `<details class="rd-chart-data"><summary>${zh ? '查看数据' : 'View data'}</summary><table><caption>${esc(dataset.title)}</caption>${head}<tbody>${body}</tbody></table></details>`;
}

export type RenderedChart = {
  html: string;
  mark: ChartMark;
  fallback?: string;
};

/** Renders a chart component; marks that do not suit the data fall back. */
export function renderReportChart(
  spec: ReportChartSpec,
  dataset: ReportDataset,
  language: 'zh-CN' | 'en'
): RenderedChart {
  const rows = prepare(spec, dataset);
  let mark = spec.mark;
  let fallback: string | undefined;
  const integral = rows.every(
    row => Number.isInteger(row.numeric) && row.numeric >= 0
  );
  const total = rows.reduce((sum, row) => sum + row.numeric, 0);
  if (mark === 'unit' && (!integral || total > 240 || total < 1)) {
    fallback = 'unit needs non-negative integer counts totalling 1–240';
    mark = 'bar';
  }
  if (mark === 'stack' && (rows.some(row => row.numeric < 0) || total <= 0)) {
    fallback = 'stack needs non-negative parts of a positive whole';
    mark = 'bar';
  }
  if (mark === 'line' && rows.length < 3) {
    fallback = 'line needs at least three points';
    mark = 'column';
  }
  const label = `${dataset.title}${dataset.unit ? `（${dataset.unit}）` : ''}：${spec.takeaway}`;
  const variant = (v: 'd' | 'm', width: number, size: number) => {
    let out: { body: string; height: number };
    if (mark === 'line') out = line(spec, rows, width, size);
    else if (mark === 'column' && v === 'd' && rows.length <= 12)
      out = columns(spec, rows, width, size);
    else if (mark === 'unit') out = units(rows, width, size);
    else if (mark === 'stack') out = stack(rows, width, size);
    else out = bars(spec, rows, width, size, mark === 'dot');
    return svg(v, width, out.height, label, out.body);
  };
  const needsLegend = mark === 'unit' || mark === 'stack';
  const unit = dataset.unit
    ? `<p class="rd-chart-unit">${language === 'en' ? 'Unit' : '单位'}：${esc(dataset.unit)}</p>`
    : '';
  const html = `<div class="rd-chart rd-chart--${mark}" data-rd-generated="chart" data-rd-beat="chart" data-rd-chart-dataset="${esc(dataset.id)}">${unit}<div class="rd-chart-plot">${variant('d', 720, 14)}${variant('m', 360, 13)}</div>${needsLegend ? legend(rows, language) : ''}${table(dataset, language)}</div>`;
  return { html, mark, ...(fallback ? { fallback } : {}) };
}
