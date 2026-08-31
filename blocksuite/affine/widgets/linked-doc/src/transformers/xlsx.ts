import type { ExtensionType, Schema, Workspace } from '@blocksuite/store';
import JSZip from 'jszip';

import { HtmlTransformer } from './html.js';
import {
  createOfficeHtmlDocument,
  directChildrenByLocalName,
  elementsByLocalName,
  firstElementByLocalName,
  officeFileName,
  type OfficeHtmlResult,
  readOfficeXml,
  relationshipId,
  relationshipTargets,
  resolveOfficePart,
  textFromRuns,
} from './office.js';

type ImportXlsxOptions = {
  collection: Workspace;
  schema: Schema;
  imported: Blob;
  extensions: ExtensionType[];
};

type WorkbookStyles = {
  dateStyles: Set<number>;
  date1904: boolean;
};

type CellPosition = {
  column: number;
  row: number;
};

const MAX_SHEETS = 100;
const MAX_ROWS_PER_SHEET = 10_000;
const MAX_COLUMNS_PER_SHEET = 256;
const MAX_SOURCE_CELLS = 100_000;
const MAX_RENDERED_CELLS_PER_SHEET = 200_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const BUILT_IN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function parseCellReference(reference: string): CellPosition | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(reference);
  if (!match) return null;

  let column = 0;
  for (const letter of match[1].toUpperCase()) {
    column = column * 26 + letter.charCodeAt(0) - 64;
  }
  return { column, row: Number(match[2]) };
}

function normalizedFormatCode(formatCode: string) {
  return formatCode
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/_.|\*./g, '')
    .toLowerCase();
}

function isDateFormat(formatCode: string) {
  const normalized = normalizedFormatCode(formatCode);
  return /(?:^|[^a-z])[ymdhis]+(?:[^a-z]|$)/.test(normalized);
}

function parseWorkbookStyles(
  workbook: Document,
  styles: Document | null
): WorkbookStyles {
  const workbookProperties = firstElementByLocalName(workbook, 'workbookPr');
  const date1904 = ['1', 'true'].includes(
    workbookProperties?.getAttribute('date1904')?.toLowerCase() ?? ''
  );
  if (!styles) return { date1904, dateStyles: new Set() };

  const customDateFormats = new Set<number>();
  for (const format of elementsByLocalName(styles, 'numFmt')) {
    const id = Number(format.getAttribute('numFmtId'));
    const code = format.getAttribute('formatCode');
    if (Number.isInteger(id) && code && isDateFormat(code)) {
      customDateFormats.add(id);
    }
  }

  const dateStyles = new Set<number>();
  const cellFormats = firstElementByLocalName(styles, 'cellXfs');
  if (cellFormats) {
    directChildrenByLocalName(cellFormats, 'xf').forEach((format, index) => {
      const formatId = Number(format.getAttribute('numFmtId'));
      if (
        BUILT_IN_DATE_FORMATS.has(formatId) ||
        customDateFormats.has(formatId)
      ) {
        dateStyles.add(index);
      }
    });
  }
  return { date1904, dateStyles };
}

function excelDate(serial: number, date1904: boolean) {
  if (!Number.isFinite(serial)) return String(serial);
  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  const adjustedDays = date1904
    ? wholeDays
    : wholeDays - (wholeDays >= 60 ? 1 : 0);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const date = new Date(
    epoch +
      adjustedDays * MILLISECONDS_PER_DAY +
      fraction * MILLISECONDS_PER_DAY
  );
  if (Number.isNaN(date.getTime())) return String(serial);

  const iso = date.toISOString();
  return Math.abs(fraction) < Number.EPSILON
    ? iso.slice(0, 10)
    : iso.slice(0, 19).replace('T', ' ');
}

function readCellValue(
  cell: Element,
  sharedStrings: string[],
  styles: WorkbookStyles
) {
  const type = cell.getAttribute('t');
  const rawValue = firstElementByLocalName(cell, 'v')?.textContent ?? '';

  if (type === 'inlineStr') {
    const inlineString = firstElementByLocalName(cell, 'is');
    return inlineString ? textFromRuns(inlineString) : '';
  }
  if (type === 's') {
    const index = Number(rawValue);
    return Number.isInteger(index) ? (sharedStrings[index] ?? '') : '';
  }
  if (type === 'b') return rawValue === '1' ? 'TRUE' : 'FALSE';
  if (type === 'str' || type === 'e' || type === 'd') return rawValue;

  const formula = firstElementByLocalName(cell, 'f')?.textContent;
  if (!rawValue && formula) return `=${formula}`;
  if (!rawValue) return '';

  const styleIndex = Number(cell.getAttribute('s'));
  if (styles.dateStyles.has(styleIndex)) {
    return excelDate(Number(rawValue), styles.date1904);
  }
  return rawValue;
}

function parseSharedStrings(document: Document | null) {
  if (!document) return [];
  return elementsByLocalName(document, 'si').map(textFromRuns);
}

function parseMergeRange(reference: string) {
  const [startReference, endReference] = reference.split(':');
  const start = parseCellReference(startReference);
  const end = parseCellReference(endReference ?? startReference);
  if (!start || !end) return null;
  return {
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
  };
}

function appendWorksheet(
  output: Document,
  worksheet: Document,
  sheetName: string,
  sharedStrings: string[],
  styles: WorkbookStyles,
  cellBudget: { count: number }
) {
  const heading = output.createElement('h2');
  heading.textContent = sheetName;
  output.body.append(heading);

  const values = new Map<string, string>();
  let maxRow = 0;
  let maxColumn = 0;
  let sequentialRow = 0;

  const sheetData = firstElementByLocalName(worksheet, 'sheetData');
  if (!sheetData) return;

  for (const rowElement of directChildrenByLocalName(sheetData, 'row')) {
    sequentialRow += 1;
    const declaredRow = Number(rowElement.getAttribute('r'));
    const fallbackRow =
      Number.isInteger(declaredRow) && declaredRow > 0
        ? declaredRow
        : sequentialRow;
    let sequentialColumn = 0;

    for (const cell of directChildrenByLocalName(rowElement, 'c')) {
      sequentialColumn += 1;
      const position =
        parseCellReference(cell.getAttribute('r') ?? '') ??
        ({ row: fallbackRow, column: sequentialColumn } satisfies CellPosition);
      if (
        position.row > MAX_ROWS_PER_SHEET ||
        position.column > MAX_COLUMNS_PER_SHEET
      ) {
        throw new Error(
          `Worksheet "${sheetName}" exceeds the ${MAX_ROWS_PER_SHEET}-row or ${MAX_COLUMNS_PER_SHEET}-column import limit.`
        );
      }

      cellBudget.count += 1;
      if (cellBudget.count > MAX_SOURCE_CELLS) {
        throw new Error(
          `The workbook exceeds the ${MAX_SOURCE_CELLS}-cell import limit.`
        );
      }

      values.set(
        `${position.row}:${position.column}`,
        readCellValue(cell, sharedStrings, styles)
      );
      maxRow = Math.max(maxRow, position.row);
      maxColumn = Math.max(maxColumn, position.column);
    }
  }

  const mergeRanges = elementsByLocalName(worksheet, 'mergeCell')
    .map(mergeCell => parseMergeRange(mergeCell.getAttribute('ref') ?? ''))
    .filter((range): range is NonNullable<typeof range> => range !== null);
  for (const range of mergeRanges) {
    if (
      range.endRow > MAX_ROWS_PER_SHEET ||
      range.endColumn > MAX_COLUMNS_PER_SHEET
    ) {
      throw new Error(
        `Worksheet "${sheetName}" exceeds the ${MAX_ROWS_PER_SHEET}-row or ${MAX_COLUMNS_PER_SHEET}-column import limit.`
      );
    }
    maxRow = Math.max(maxRow, range.endRow);
    maxColumn = Math.max(maxColumn, range.endColumn);
  }
  if (!maxRow || !maxColumn) return;
  if (maxRow * maxColumn > MAX_RENDERED_CELLS_PER_SHEET) {
    throw new Error(`Worksheet "${sheetName}" is too sparse to import safely.`);
  }

  const mergeStarts = new Map<
    string,
    { rowSpan: number; columnSpan: number }
  >();
  const mergedCells = new Set<string>();
  for (const range of mergeRanges) {
    mergeStarts.set(`${range.startRow}:${range.startColumn}`, {
      rowSpan: range.endRow - range.startRow + 1,
      columnSpan: range.endColumn - range.startColumn + 1,
    });
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (
        let column = range.startColumn;
        column <= range.endColumn;
        column++
      ) {
        if (row !== range.startRow || column !== range.startColumn) {
          mergedCells.add(`${row}:${column}`);
        }
      }
    }
  }

  const table = output.createElement('table');
  const body = output.createElement('tbody');
  for (let row = 1; row <= maxRow; row++) {
    const tableRow = output.createElement('tr');
    for (let column = 1; column <= maxColumn; column++) {
      const key = `${row}:${column}`;
      if (mergedCells.has(key)) continue;

      const tableCell = output.createElement('td');
      tableCell.textContent = values.get(key) ?? '';
      const merge = mergeStarts.get(key);
      if (merge?.rowSpan && merge.rowSpan > 1) {
        tableCell.rowSpan = merge.rowSpan;
      }
      if (merge?.columnSpan && merge.columnSpan > 1) {
        tableCell.colSpan = merge.columnSpan;
      }
      tableRow.append(tableCell);
    }
    body.append(tableRow);
  }
  table.append(body);
  output.body.append(table);
}

export async function parseXlsxToHtml(
  imported: Blob
): Promise<OfficeHtmlResult> {
  const archive = await JSZip.loadAsync(imported);
  if (!archive.file('[Content_Types].xml')) {
    throw new Error('The selected file is not a valid Excel workbook.');
  }

  const workbookPath = 'xl/workbook.xml';
  const workbook = await readOfficeXml(archive, workbookPath);
  const relationships = relationshipTargets(
    await readOfficeXml(archive, 'xl/_rels/workbook.xml.rels')
  );
  const sharedStrings = parseSharedStrings(
    await readOfficeXml(archive, 'xl/sharedStrings.xml', false)
  );
  const styles = parseWorkbookStyles(
    workbook,
    await readOfficeXml(archive, 'xl/styles.xml', false)
  );
  const sheets = elementsByLocalName(workbook, 'sheet');
  if (!sheets.length) {
    throw new Error('The Excel workbook does not contain any worksheets.');
  }
  if (sheets.length > MAX_SHEETS) {
    throw new Error(
      `The workbook exceeds the ${MAX_SHEETS}-sheet import limit.`
    );
  }

  const output = createOfficeHtmlDocument();
  const cellBudget = { count: 0 };
  for (const [index, sheet] of sheets.entries()) {
    const id = relationshipId(sheet);
    const target = id ? relationships.get(id) : null;
    if (!target) {
      throw new Error(`The workbook is missing worksheet ${index + 1}.`);
    }
    const worksheetPath = resolveOfficePart(workbookPath, target);
    appendWorksheet(
      output,
      await readOfficeXml(archive, worksheetPath),
      sheet.getAttribute('name') || `Sheet ${index + 1}`,
      sharedStrings,
      styles,
      cellBudget
    );
  }

  return {
    html: output.documentElement.outerHTML,
    fileName: officeFileName(imported, /\.xlsx$/i),
  };
}

async function importXlsx({
  collection,
  schema,
  imported,
  extensions,
}: ImportXlsxOptions) {
  const { html, fileName } = await parseXlsxToHtml(imported);
  return HtmlTransformer.importHTMLToDoc({
    collection,
    schema,
    html,
    fileName,
    extensions,
  });
}

export const XlsxTransformer = {
  importXlsx,
  parseXlsxToHtml,
};
