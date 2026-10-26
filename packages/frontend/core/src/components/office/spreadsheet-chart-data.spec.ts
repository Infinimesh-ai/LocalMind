import type { XlsxSemanticState } from '@affine/core/modules/office';
import { describe, expect, test } from 'vitest';

import {
  type WorkbookChart,
  workbookChartData,
} from './spreadsheet-chart-data';

const sheet = {
  id: '1',
  name: 'Chart source',
  cells: [
    { address: 'A1', value: '甲' },
    { address: 'A2', value: '乙' },
    { address: 'B1', value: 10 },
    { address: 'B2', value: null, formula: '5*5', calculatedValue: 25 },
  ],
} as XlsxSemanticState['sheets'][number];
const state = { sheets: [sheet] } as XlsxSemanticState;
const chart = {
  id: 'chart-1',
  type: 'column',
  series: [
    {
      name: '数量',
      categoryFormula: "'Chart source'!A1:A2",
      valueFormula: "'Chart source'!B1:B2",
    },
  ],
} as WorkbookChart;

describe('workbook chart data', () => {
  test('resolves quoted sheet references and current formula values', () => {
    expect(workbookChartData(state, sheet, chart)).toEqual({
      names: ['数量'],
      rows: [
        { category: '甲', values: [10] },
        { category: '乙', values: [25] },
      ],
    });
    const next = structuredClone(state);
    next.sheets[0].cells[3].calculatedValue = 35;
    expect(
      workbookChartData(next, next.sheets[0], chart)?.rows[1].values
    ).toEqual([35]);
  });
  test('does not silently replace unavailable chart sources or mismatched ranges', () => {
    expect(
      workbookChartData(state, sheet, {
        ...chart,
        series: [{ ...chart.series[0], valueFormula: 'Missing!B1:B2' }],
      })
    ).toBeNull();
    expect(
      workbookChartData(state, sheet, {
        ...chart,
        series: [{ ...chart.series[0], valueFormula: 'B1:B3' }],
      })
    ).toBeNull();
    expect(
      workbookChartData(state, sheet, {
        ...chart,
        series: [{ ...chart.series[0], valueFormula: 'OFFSET(B1,1,0)' }],
      })
    ).toBeNull();
  });
  test('bounds imported chart ranges and rejects unknown chart types', () => {
    expect(
      workbookChartData(state, sheet, { ...chart, type: 'unknown' })
    ).toBeNull();
    expect(
      workbookChartData(state, sheet, {
        ...chart,
        series: [{ categoryFormula: 'A1:A201', valueFormula: 'B1:B201' }],
      })
    ).toBeNull();
  });
  test('retains gaps and rejects negative values for pie charts', () => {
    const next = structuredClone(state);
    next.sheets[0].cells[2].value = null;
    expect(
      workbookChartData(next, next.sheets[0], chart)?.rows[0].values
    ).toEqual([null]);
    next.sheets[0].cells[2].value = -10;
    expect(
      workbookChartData(next, next.sheets[0], { ...chart, type: 'pie' })
    ).toBeNull();
    expect(
      workbookChartData(next, next.sheets[0], chart)?.rows[0].values
    ).toEqual([-10]);
  });
});
