import type { XlsxSemanticState } from '@affine/core/modules/office';
import {
  expandCellRange,
  parseXlsxFormula,
  xlsxValueText,
} from '@localmind/office/xlsx';

type Sheet = XlsxSemanticState['sheets'][number];
export type WorkbookChart = Sheet['charts'][number];

export function workbookChartData(
  state: XlsxSemanticState,
  sheet: Sheet,
  chart: WorkbookChart
) {
  if (
    chart.type === 'unknown' ||
    !chart.series.length ||
    chart.series.length > 12
  )
    return null;
  const values = (formula: string | undefined) => {
    if (!formula) throw new Error('Missing chart reference');
    const ast = parseXlsxFormula(formula);
    if (ast.type !== 'cell' && ast.type !== 'range')
      throw new Error('Unsupported chart reference');
    const source = ast.sheet
      ? state.sheets.find(
          item => item.name.toLowerCase() === ast.sheet?.toLowerCase()
        )
      : sheet;
    if (!source) throw new Error('Missing chart sheet');
    const addresses =
      ast.type === 'cell'
        ? [ast.address]
        : expandCellRange(ast.start, ast.end, 200);
    const cells = new Map(source.cells.map(cell => [cell.address, cell]));
    return addresses.map(address => {
      const cell = cells.get(address);
      if (cell?.calculationError) throw new Error('Invalid chart value');
      return (cell?.formula ? cell.calculatedValue : cell?.value) ?? null;
    });
  };
  try {
    const labels = values(chart.series[0].categoryFormula).map(xlsxValueText);
    const series = chart.series.map(item => {
      const categories = values(item.categoryFormula).map(xlsxValueText);
      if (
        categories.length !== labels.length ||
        categories.some((label, i) => label !== labels[i])
      )
        throw new Error('Incompatible chart categories');
      const numbers = values(item.valueFormula).map(value =>
        typeof value === 'number' && Number.isFinite(value) ? value : null
      );
      if (numbers.length !== labels.length)
        throw new Error('Incompatible chart values');
      return numbers;
    });
    if (
      chart.type === 'pie' &&
      (series.length !== 1 ||
        series[0].some(value => value !== null && value < 0))
    )
      return null;
    return {
      names: chart.series.map((item, i) => item.name || String(i + 1)),
      rows: labels.map((category, index) => ({
        category,
        values: series.map(items => items[index]),
      })),
    };
  } catch {
    return null;
  }
}
