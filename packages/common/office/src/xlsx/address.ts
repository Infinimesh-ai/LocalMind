import { OoxmlPackageError } from '../ooxml';

const CELL_ADDRESS = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/i;

export type XlsxCellAddress = {
  column: number;
  row: number;
  address: string;
};

export function columnNameToIndex(name: string) {
  let index = 0;
  for (const character of name.toUpperCase()) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }
  return index;
}

export function columnIndexToName(index: number) {
  if (!Number.isSafeInteger(index) || index < 1 || index > 16_384) {
    throw new OoxmlPackageError(`XLSX column index is invalid: ${index}`);
  }
  let value = index;
  let name = '';
  while (value > 0) {
    value--;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

export function parseCellAddress(input: string): XlsxCellAddress {
  const match = CELL_ADDRESS.exec(input.trim());
  if (!match) {
    throw new OoxmlPackageError(`XLSX cell address is invalid: ${input}`);
  }
  const column = columnNameToIndex(match[1]);
  const row = Number(match[2]);
  if (column > 16_384 || row > 1_048_576) {
    throw new OoxmlPackageError(`XLSX cell address is out of range: ${input}`);
  }
  return { column, row, address: `${columnIndexToName(column)}${row}` };
}

export function compareCellAddresses(left: string, right: string) {
  const a = parseCellAddress(left);
  const b = parseCellAddress(right);
  return a.row - b.row || a.column - b.column;
}

export function expandCellRange(
  start: string,
  end: string,
  maxCells = 100_000
) {
  const first = parseCellAddress(start);
  const last = parseCellAddress(end);
  const minRow = Math.min(first.row, last.row);
  const maxRow = Math.max(first.row, last.row);
  const minColumn = Math.min(first.column, last.column);
  const maxColumn = Math.max(first.column, last.column);
  const count = (maxRow - minRow + 1) * (maxColumn - minColumn + 1);
  if (count > maxCells) {
    throw new OoxmlPackageError('XLSX formula range is too large');
  }
  const addresses: string[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let column = minColumn; column <= maxColumn; column++) {
      addresses.push(`${columnIndexToName(column)}${row}`);
    }
  }
  return addresses;
}
