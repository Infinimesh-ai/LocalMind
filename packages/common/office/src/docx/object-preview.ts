import { type ChartShape, reportChartShapes } from '../report/chart';
import type { DocxEditableObject } from './object-data';

/** A bounded basic preview, shared by the editor and PDF export. */
export function docxObjectPreview(object: DocxEditableObject) {
  const width =
    object.type === 'equation'
      ? Math.max(
          480,
          [...object.linearText].reduce(
            (sum, character) => sum + (character.charCodeAt(0) > 255 ? 16 : 10),
            8
          )
        )
      : Math.max(2, object.widthPt);
  const height = object.type === 'equation' ? 32 : Math.max(2, object.heightPt);
  const shapes: ChartShape[] = [];
  if (object.type === 'equation') {
    shapes.push({
      type: 'text',
      x: 0,
      y: 22,
      size: 16,
      fill: '#111827',
      text: object.linearText,
    });
  } else if (object.type === 'shape') {
    const w = width - 1,
      h = height - 1;
    const radius = Math.min(12, w / 4, h / 4);
    const d =
      object.shape === 'line'
        ? `M 0.5 0.5 L ${w} ${h}`
        : object.shape === 'ellipse'
          ? `M ${width / 2} 0.5 A ${w / 2} ${h / 2} 0 1 1 ${width / 2} ${height - 0.5} A ${w / 2} ${h / 2} 0 1 1 ${width / 2} 0.5 Z`
          : object.shape === 'roundedRectangle'
            ? `M ${radius} 0.5 H ${w - radius} Q ${w} 0.5 ${w} ${radius} V ${h - radius} Q ${w} ${h} ${w - radius} ${h} H ${radius} Q 0.5 ${h} 0.5 ${h - radius} V ${radius} Q 0.5 0.5 ${radius} 0.5 Z`
            : `M 0.5 0.5 H ${w} V ${h} H 0.5 Z`;
    shapes.push({
      type: 'path',
      d,
      fill:
        object.shape === 'line' ? undefined : (object.fillColor ?? '#ffffff'),
      stroke: object.lineColor ?? '#000000',
      strokeWidth: 1,
    });
    if (object.text)
      shapes.push({
        type: 'text',
        x: object.shape === 'ellipse' ? width * 0.2 : 8,
        y:
          object.shape === 'ellipse'
            ? height / 2 + 4
            : Math.min(22, height / 2 + 5),
        size: 12,
        fill: '#111827',
        text: object.text,
      });
  } else if (object.chartType !== 'bar') {
    // Render at a readable internal size, then scale as one graphic.
    const chartWidth = Math.max(480, width),
      chartHeight = Math.max(300, height);
    return {
      width: chartWidth,
      height: chartHeight,
      shapes: reportChartShapes(
        {
          title: object.title ?? '',
          chartType: object.chartType === 'column' ? 'bar' : object.chartType,
          labels: object.categories,
          series: object.series.map(series => ({
            label: series.name,
            values: series.values,
          })),
        },
        chartWidth,
        chartHeight,
        '#111827'
      ),
    };
  } else {
    const chartWidth = Math.max(480, width),
      chartHeight = Math.max(300, height);
    const values = object.series.flatMap(series => series.values);
    const scale = Math.max(1, ...values.map(value => Math.abs(value)));
    const min = Math.min(0, ...values) / scale,
      max = Math.max(1, ...values) / scale;
    const x = (value: number) =>
      100 + ((value / scale - min) / (max - min)) * (chartWidth - 130);
    const step = (chartHeight - 100) / object.categories.length;
    const colors = [
      '#315f8c',
      '#b45309',
      '#166534',
      '#9d174d',
      '#6d28d9',
      '#0e7490',
    ];
    shapes.push({
      type: 'text',
      x: 0,
      y: 20,
      text: object.title ?? '',
      size: 18,
      fill: '#111827',
    });
    shapes.push({
      type: 'path',
      d: `M ${x(0)} 38 V ${chartHeight - 62}`,
      stroke: '#71717a',
      strokeWidth: 1,
    });
    for (let tick = 0; tick <= 4; tick++) {
      const value = (min + ((max - min) * tick) / 4) * scale;
      shapes.push({
        type: 'path',
        d: `M ${x(value)} 38 V ${chartHeight - 62}`,
        stroke: '#d4d4d8',
        strokeWidth: 0.5,
      });
      shapes.push({
        type: 'text',
        x: x(value),
        y: chartHeight - 45,
        text: Number(value.toPrecision(4)).toString(),
        size: 10,
        fill: '#111827',
      });
    }
    object.categories.forEach((category, index) => {
      shapes.push({
        type: 'text',
        x: 0,
        y: 40 + (index + 0.5) * step,
        text: category,
        size: 10,
        fill: '#111827',
      });
      object.series.forEach((series, seriesIndex) => {
        const value = series.values[index],
          barHeight = (step * 0.8) / object.series.length;
        shapes.push({
          type: 'rect',
          x: Math.min(x(0), x(value)),
          y: 38 + index * step + seriesIndex * barHeight,
          width: Math.abs(x(value) - x(0)),
          height: barHeight,
          fill: colors[seriesIndex % colors.length],
        });
      });
    });
    object.series.forEach((series, index) =>
      shapes.push({
        type: 'text',
        x: ((index % 4) * chartWidth) / 4,
        y: chartHeight - 30 + Math.floor(index / 4) * 12,
        text: series.name,
        size: 10,
        fill: colors[index % colors.length],
      })
    );
    return { width: chartWidth, height: chartHeight, shapes };
  }
  return { width, height, shapes };
}
