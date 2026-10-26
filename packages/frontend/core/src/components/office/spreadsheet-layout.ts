import type { XlsxSemanticState } from '@affine/core/modules/office';
import {
  columnIndexToName,
  parseCellAddress,
  xlsxValueText,
} from '@localmind/office/xlsx';

type Sheet = XlsxSemanticState['sheets'][number];

export const DEFAULT_ROW_HEIGHT = 22;
export const DEFAULT_COLUMN_WIDTH = 12;

export function worksheetDimensions(sheet: Sheet, row: number, column: number) {
  return {
    row: sheet.rows.find(item => item.row === row),
    column: sheet.columns.find(
      item => item.min <= column && item.max >= column
    ),
  };
}

function mergeBounds(range: string) {
  try {
    const [first, last = first] = range.split(':');
    const start = parseCellAddress(first);
    const end = parseCellAddress(last);
    if (end.row < start.row || end.column < start.column) return;
    return { start, end };
  } catch {
    return;
  }
}

export function mergedCellAddress(sheet: Sheet | undefined, address: string) {
  const cell = parseCellAddress(address);
  for (const range of sheet?.mergedCells ?? []) {
    const bounds = mergeBounds(range);
    if (
      bounds &&
      cell.row >= bounds.start.row &&
      cell.row <= bounds.end.row &&
      cell.column >= bounds.start.column &&
      cell.column <= bounds.end.column
    )
      return bounds.start;
  }
  return cell;
}

export function worksheetLayout(
  sheet: Sheet | undefined,
  bounds: { rows: number; columns: number }
) {
  const filter = sheet?.autoFilter;
  const filterBounds = filter ? mergeBounds(filter.ref) : undefined;
  const cells = new Map(sheet?.cells.map(cell => [cell.address, cell]));
  const rows = Array.from({ length: bounds.rows }, (_, i) => i + 1).filter(
    row => {
      if (sheet?.rows.find(item => item.row === row)?.hidden) return false;
      if (
        !filter ||
        !filterBounds ||
        row <= filterBounds.start.row ||
        row > filterBounds.end.row
      )
        return true;
      return filter.criteria.every(criterion => {
        const column = filterBounds.start.column + criterion.columnIndex;
        const cell = cells.get(`${columnIndexToName(column)}${row}`);
        const text = xlsxValueText(
          cell?.formula ? cell.calculatedValue : cell?.value
        ).toLowerCase();
        return criterion.values.some(value => value.toLowerCase() === text);
      });
    }
  );
  const columns = Array.from(
    { length: bounds.columns },
    (_, i) => i + 1
  ).filter(
    column =>
      !sheet?.columns.find(item => item.min <= column && item.max >= column)
        ?.hidden
  );
  const gridTemplateRows = [
    '28px',
    ...rows.map(
      row =>
        `${((sheet?.rows.find(item => item.row === row)?.heightPt ?? DEFAULT_ROW_HEIGHT) * 4) / 3}px`
    ),
  ].join(' ');
  // OOXML widths use the default font's maximum digit width. The current grid
  // uses a seven-pixel digit metric; custom workbook font metrics are not loaded.
  const gridTemplateColumns = [
    '42px',
    ...columns.map(column => {
      const width =
        sheet?.columns.find(item => item.min <= column && item.max >= column)
          ?.width ?? DEFAULT_COLUMN_WIDTH;
      return `${Math.floor(((256 * width + Math.floor(128 / 7)) / 256) * 7)}px`;
    }),
  ].join(' ');
  const merged = new Map<
    string,
    { address: string; rowSpan: number; columnSpan: number } | null
  >();
  for (const range of sheet?.mergedCells ?? []) {
    const span = mergeBounds(range);
    if (!span) continue;
    const mergeRows = rows.filter(
      row => row >= span.start.row && row <= span.end.row
    );
    const mergeColumns = columns.filter(
      column => column >= span.start.column && column <= span.end.column
    );
    for (const row of mergeRows)
      for (const column of mergeColumns) {
        const address = `${columnIndexToName(column)}${row}`;
        if (merged.has(address)) continue;
        merged.set(
          address,
          row === mergeRows[0] && column === mergeColumns[0]
            ? {
                address: span.start.address,
                rowSpan: mergeRows.length,
                columnSpan: mergeColumns.length,
              }
            : null
        );
      }
  }
  return { rows, columns, merged, gridTemplateRows, gridTemplateColumns };
}
