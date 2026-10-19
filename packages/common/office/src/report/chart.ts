import type { PublicReportNode } from './audience';
import { escapeReportXml as xml } from './render-types';
/** Optional hooks used by animated renderers (e.g. report decks). */
export type ChartShapeMeta = {
  className?: string;
  dataIndex?: number;
  dataSeries?: number;
};
export type ChartShapeOptions = {
  /** Donut hole color; defaults to white for the classic exports. */
  background?: string;
};
export type ChartShape = ChartShapeMeta &
  (
    | {
        type: 'rect';
        x: number;
        y: number;
        width: number;
        height: number;
        fill: string;
      }
    | {
        type: 'path';
        d: string;
        fill?: string;
        stroke?: string;
        strokeWidth?: number;
      }
    | {
        type: 'text';
        x: number;
        y: number;
        text: string;
        size: number;
        fill: string;
      }
  );
const colors = [
  '#315f8c',
  '#b45309',
  '#166534',
  '#9d174d',
  '#6d28d9',
  '#0e7490',
  '#57534e',
  '#be123c',
  '#4d7c0f',
  '#1e40af',
  '#a16207',
  '#7e22ce',
];
export function reportChartShapes(
  node: Extract<PublicReportNode, { type: 'chart' }>,
  width: number,
  height: number,
  foreground: string,
  options: ChartShapeOptions = {}
): ChartShape[] {
  const shapes: ChartShape[] = [
    { type: 'text', x: 0, y: 20, text: node.title, size: 18, fill: foreground },
  ];
  const w = width - 80,
    h = height - 110,
    x = 48,
    y = 38;
  if (node.chartType === 'pie' || node.chartType === 'donut') {
    const values = node.series[0].values,
      scale = Math.max(1, ...values.map(value => value ?? 0)),
      total = values.reduce<number>(
        (sum, value) => sum + Math.max(0, (value ?? 0) / scale),
        0
      );
    const radius = Math.min(h / 2, w / 3),
      cx = x + radius,
      cy = y + radius;
    let angle = -Math.PI / 2;
    values.forEach((value, index) => {
      if (value === null || value <= 0 || total <= 0) return;
      const end = angle + (value / scale / total) * Math.PI * 2,
        points: string[] = [
          `M ${cx} ${cy}`,
          `L ${cx + Math.cos(angle) * radius} ${cy + Math.sin(angle) * radius}`,
        ];
      const count = Math.max(2, Math.ceil((end - angle) * 20));
      for (let step = 1; step <= count; step++) {
        const a = angle + ((end - angle) * step) / count;
        points.push(
          `L ${cx + Math.cos(a) * radius} ${cy + Math.sin(a) * radius}`
        );
      }
      shapes.push({
        type: 'path',
        d: `${points.join(' ')} Z`,
        fill: colors[index % colors.length],
        className: 'chart-slice',
        dataIndex: index,
        dataSeries: 0,
      });
      angle = end;
    });
    if (node.chartType === 'donut') {
      const points: string[] = [];
      for (let i = 0; i < 64; i++)
        points.push(
          `${i ? 'L' : 'M'} ${cx + Math.cos((i / 64) * Math.PI * 2) * radius * 0.55} ${cy + Math.sin((i / 64) * Math.PI * 2) * radius * 0.55}`
        );
      shapes.push({
        type: 'path',
        d: `${points.join(' ')} Z`,
        fill: options.background ?? '#ffffff',
        className: 'chart-hole',
      });
    }
    node.labels.slice(0, 10).forEach((label, index) => {
      shapes.push({
        type: 'rect',
        x: x + radius * 2 + 24,
        y: y + index * 20,
        width: 10,
        height: 10,
        fill: colors[index % colors.length],
      });
      shapes.push({
        type: 'text',
        x: x + radius * 2 + 40,
        y: y + index * 20 + 10,
        text: `${label.slice(0, 18)}: ${values[index] ?? '—'}`,
        size: 12,
        fill: foreground,
      });
    });
  } else {
    const values = node.series.flatMap(series =>
      series.values.filter((value): value is number => value !== null)
    );
    // Normalize before subtraction: finite values can still overflow a range
    // spanning opposite extremes, which would otherwise produce NaN geometry.
    const scale = Math.max(1, ...values.map(value => Math.abs(value))),
      min = Math.min(0, ...values) / scale,
      max = Math.max(1, ...values) / scale,
      range = max - min;
    const py = (value: number) => y + h - ((value / scale - min) / range) * h;
    for (let tick = 0; tick <= 4; tick++) {
      const value = (min + (range * tick) / 4) * scale,
        lineY = py(value);
      shapes.push({
        type: 'path',
        d: `M ${x} ${lineY} L ${x + w} ${lineY}`,
        stroke: '#d4d4d8',
        strokeWidth: 0.5,
      });
      shapes.push({
        type: 'text',
        x: 0,
        y: lineY + 4,
        text: Number(value.toPrecision(4)).toString(),
        size: 11,
        fill: foreground,
      });
    }
    const step = w / node.labels.length;
    node.series.forEach((series, seriesIndex) => {
      const color = colors[seriesIndex % colors.length];
      let path = '',
        previous = false;
      series.values.forEach((value, index) => {
        if (value === null) {
          previous = false;
          return;
        }
        const pointX = x + step * (index + 0.5),
          pointY = py(value);
        if (node.chartType === 'line') {
          path += `${previous ? ' L' : ' M'} ${pointX} ${pointY}`;
          previous = true;
        } else {
          const barWidth = Math.max(0.3, (step * 0.8) / node.series.length);
          shapes.push({
            type: 'rect',
            x: x + index * step + step * 0.1 + seriesIndex * barWidth,
            y: Math.min(pointY, py(0)),
            width: barWidth,
            height: Math.max(0.2, Math.abs(py(0) - pointY)),
            fill: color,
            className: 'chart-bar',
            dataIndex: index,
            dataSeries: seriesIndex,
          });
        }
      });
      if (path)
        shapes.push({
          type: 'path',
          d: path,
          stroke: color,
          strokeWidth: 2,
          className: 'chart-line',
          dataSeries: seriesIndex,
        });
      shapes.push({
        type: 'text',
        x: x + ((seriesIndex % 4) * w) / 4,
        y: height - 25 + Math.floor(seriesIndex / 4) * 12,
        text: series.label.slice(0, 18),
        size: 10,
        fill: color,
      });
    });
    const labelEvery = Math.max(1, Math.ceil(node.labels.length / 10));
    node.labels.forEach((label, index) => {
      if (index % labelEvery === 0)
        shapes.push({
          type: 'text',
          x: x + index * step,
          y: y + h + 20,
          text: label.slice(0, 9),
          size: 10,
          fill: foreground,
        });
    });
  }
  return shapes;
}
const shapeMeta = (shape: ChartShapeMeta) =>
  `${shape.className ? ` class="${xml(shape.className)}"` : ''}${shape.dataSeries === undefined ? '' : ` data-series="${shape.dataSeries}"`}${shape.dataIndex === undefined ? '' : ` data-index="${shape.dataIndex}"`}`;
export function reportChartSvg(
  shapes: ChartShape[],
  width: number,
  height: number
) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img">${shapes.map(shape => (shape.type === 'rect' ? `<rect${shapeMeta(shape)} x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.fill}"/>` : shape.type === 'path' ? `<path${shapeMeta(shape)} d="${shape.d}" fill="${shape.fill ?? 'none'}" stroke="${shape.stroke ?? 'none'}" stroke-width="${shape.strokeWidth ?? 0}"/>` : `<text${shapeMeta(shape)} x="${shape.x}" y="${shape.y}" font-size="${shape.size}" fill="${shape.fill}">${xml(shape.text)}</text>`)).join('')}</svg>`;
}
