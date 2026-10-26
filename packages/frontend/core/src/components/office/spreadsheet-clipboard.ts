import {
  OFFICE_COMMAND_BATCH_MAX_COMMANDS,
  type OfficeCommandBatch,
  type OfficeWorkbookSetCellCommand,
} from '@localmind/office';
import {
  columnIndexToName,
  parseCellAddress,
  xlsxRangeContains,
  type XlsxSemanticState,
} from '@localmind/office/xlsx';

type Sheet = XlsxSemanticState['sheets'][number];
const MAX_CLIPBOARD_BYTES = 256 * 1024;

export class SpreadsheetClipboardError extends Error {
  constructor(readonly code: 'limit' | 'shape' | 'merged' | 'invalid') {
    super(`Spreadsheet clipboard: ${code}`);
  }
}

export function parseSpreadsheetInput(
  value: string
): OfficeWorkbookSetCellCommand['input'] {
  if (!value) return { type: 'blank' };
  if (value.startsWith("'")) return { type: 'string', value: value.slice(1) };
  if (value.startsWith('='))
    return { type: 'formula', formula: value.slice(1) };
  if (/^(true|false)$/i.test(value))
    return { type: 'boolean', value: value.toLowerCase() === 'true' };
  const number = Number(value);
  // Identifiers with leading zeroes must not be silently changed into numbers.
  if (
    value.trim() &&
    Number.isFinite(number) &&
    !/^[+-]?0\d/.test(value.trim())
  )
    return { type: 'number', value: number };
  return { type: 'string', value };
}

export function parseSpreadsheetTsv(text: string): string[][] {
  if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES)
    throw new SpreadsheetClipboardError('limit');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  let cells = 0;
  const pushCell = () => {
    if (++cells > OFFICE_COMMAND_BATCH_MAX_COMMANDS)
      throw new SpreadsheetClipboardError('limit');
    row.push(value);
    value = '';
    closed = false;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += char;
    } else if (char === '\t' || char === '\r' || char === '\n') {
      pushCell();
      if (char !== '\t') {
        if (char === '\r' && text[index + 1] === '\n') index++;
        rows.push(row);
        row = [];
      }
    } else if (closed) {
      throw new SpreadsheetClipboardError('shape');
    } else if (char === '"' && !value) quoted = true;
    else value += char;
  }
  if (quoted) throw new SpreadsheetClipboardError('shape');
  if (value || row.length || !rows.length || !/[\r\n]$/.test(text)) {
    pushCell();
    rows.push(row);
  }
  if (rows.some(candidate => candidate.length !== rows[0].length))
    throw new SpreadsheetClipboardError('shape');
  return rows;
}

export function spreadsheetPasteBatch(input: {
  text: string;
  address: string;
  sheet: Sheet;
  artifactId: string;
  revisionId: string;
  id: string;
}): { batch: OfficeCommandBatch; range: string } {
  const rows = parseSpreadsheetTsv(input.text);
  const start = parseCellAddress(input.address);
  const last = parseCellAddress(
    `${columnIndexToName(start.column + rows[0].length - 1)}${start.row + rows.length - 1}`
  );
  const currentCells = new Map(
    input.sheet.cells.map(cell => [cell.address, cell])
  );
  const commands: OfficeWorkbookSetCellCommand[] = rows.flatMap(
    (row, rowIndex) =>
      row.map((value, columnIndex) => {
        const address = `${columnIndexToName(start.column + columnIndex)}${start.row + rowIndex}`;
        if (
          input.sheet.mergedCells.some(merge =>
            xlsxRangeContains(merge, address)
          )
        )
          throw new SpreadsheetClipboardError('merged');
        const id = `${input.id}:${rowIndex}:${columnIndex}`;
        return {
          version: 'localmind-office-command/v1',
          commandId: id,
          idempotencyKey: `office-paste-cell:${id}`,
          artifactId: input.artifactId,
          expectedRevisionId: input.revisionId,
          source: 'user',
          operation: 'office.workbook.cell.set',
          target: { type: 'cell', sheetId: input.sheet.id, address },
          input: parseSpreadsheetInput(value),
          styleIndex: currentCells.get(address)?.styleIndex,
        };
      })
  );
  return {
    range: `${start.address}:${last.address}`,
    batch: {
      version: 'localmind-office-command-batch/v1',
      batchId: input.id,
      idempotencyKey: `office-paste:${input.id}`,
      source: 'user',
      artifactId: input.artifactId,
      expectedRevisionId: input.revisionId,
      commands,
    },
  };
}

export function copySpreadsheetValues(sheet: Sheet, range: string): string {
  const [first, last = first, extra] = range.split(':');
  if (extra !== undefined) throw new SpreadsheetClipboardError('invalid');
  const start = parseCellAddress(first);
  const end = parseCellAddress(last);
  const rowCount = end.row - start.row + 1;
  const columnCount = end.column - start.column + 1;
  if (rowCount < 1 || columnCount < 1)
    throw new SpreadsheetClipboardError('invalid');
  if (rowCount * columnCount > OFFICE_COMMAND_BATCH_MAX_COMMANDS)
    throw new SpreadsheetClipboardError('limit');
  const cells = new Map(sheet.cells.map(cell => [cell.address, cell]));
  const text = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) => {
      const address = `${columnIndexToName(start.column + column)}${start.row + row}`;
      if (sheet.mergedCells.some(merge => xlsxRangeContains(merge, address)))
        throw new SpreadsheetClipboardError('merged');
      const cell = cells.get(address);
      if (cell?.calculationError)
        throw new SpreadsheetClipboardError('invalid');
      const value = cell?.formula ? cell.calculatedValue : cell?.value;
      const raw =
        value === null || value === undefined
          ? ''
          : typeof value === 'string'
            ? `'${value}`
            : String(value);
      return /[\t\r\n"]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
    }).join('\t')
  ).join('\n');
  if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES)
    throw new SpreadsheetClipboardError('limit');
  return text;
}
