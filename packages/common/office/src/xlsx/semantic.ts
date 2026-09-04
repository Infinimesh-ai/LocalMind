import {
  relationshipPartName,
  sourcePartNameFromRelationshipPart,
} from '../docx/path';
import { relationshipTypeName } from '../docx/relationships';
import {
  findChildElement,
  findFirstElement,
  getAttribute,
  getElementChildren,
  getTextContent,
  type OrderedXmlNode,
  parseOrderedXml,
} from '../docx/xml';
import { type OoxmlOpcPackage, OoxmlPackageError } from '../ooxml';
import {
  columnIndexToName,
  compareCellAddresses,
  parseCellAddress,
} from './address';
import {
  evaluateXlsxFormula,
  parseXlsxFormula,
  type XlsxFormulaAst,
  type XlsxFormulaValue,
} from './formula';

export const XLSX_SEMANTIC_STATE_VERSION = 'localmind-office-xlsx-state/v1';
export const XLSX_MODEL_VERSION = 'localmind-office-xlsx-model/v1';

export type XlsxCellValue = string | number | boolean | null;

export type XlsxCell = {
  address: string;
  row: number;
  column: number;
  type: 'blank' | 'string' | 'number' | 'boolean' | 'date' | 'error';
  value: XlsxCellValue;
  formula?: string;
  formulaAst?: XlsxFormulaAst;
  cachedValue?: XlsxCellValue;
  calculatedValue?: XlsxFormulaValue;
  calculationError?: string;
  styleIndex?: number;
};

export type XlsxWorksheet = {
  id: string;
  name: string;
  state?: string;
  relationshipId: string;
  part: string;
  dimension?: string;
  cells: XlsxCell[];
  rows: Array<{ row: number; heightPt?: number; hidden?: boolean }>;
  columns: Array<{
    min: number;
    max: number;
    width?: number;
    hidden?: boolean;
    styleIndex?: number;
  }>;
  mergedCells: string[];
  frozenPane?: { xSplit?: number; ySplit?: number; topLeftCell?: string };
  autoFilter?: {
    ref: string;
    criteria: Array<{ columnIndex: number; values: string[] }>;
  };
  dataValidations: XlsxDataValidation[];
  tables: XlsxTable[];
  charts: XlsxChart[];
};

export type XlsxDataValidation = {
  range: string;
  type?: string;
  operator?: string;
  allowBlank?: boolean;
  formula1?: string;
  formula2?: string;
  promptTitle?: string;
  prompt?: string;
  errorTitle?: string;
  error?: string;
};

export type XlsxTable = {
  id: string;
  name: string;
  displayName: string;
  ref: string;
  part: string;
  totalsRow: boolean;
  styleName?: string;
  columns: Array<{ id: string; name: string; totalsRowFunction?: string }>;
};

export type XlsxChart = {
  id: string;
  part: string;
  drawingPart: string;
  type: 'column' | 'bar' | 'line' | 'pie' | 'unknown';
  title?: string;
  anchor?: { fromCell?: string; toCell?: string };
  series: Array<{
    name?: string;
    categoryFormula?: string;
    valueFormula?: string;
  }>;
};

export type XlsxFont = {
  name?: string;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  color?: string;
};

export type XlsxFill = { pattern?: string; foregroundColor?: string };

export type XlsxCellStyle = {
  index: number;
  numberFormatId?: number;
  fontId?: number;
  fillId?: number;
  borderId?: number;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapText?: boolean;
};

export type XlsxSemanticState = {
  schemaVersion: typeof XLSX_SEMANTIC_STATE_VERSION;
  modelVersion: typeof XLSX_MODEL_VERSION;
  workbookPart: string;
  activeSheetIndex: number;
  sheets: XlsxWorksheet[];
  definedNames: Array<{ name: string; formula: string; localSheetId?: number }>;
  styles: {
    fonts: XlsxFont[];
    fills: XlsxFill[];
    cells: XlsxCellStyle[];
  };
  package: {
    parts: Array<{
      path: string;
      contentType?: string;
      byteSize: number;
      handling: 'semantic' | 'opaque';
    }>;
    opaqueParts: string[];
    externalRelationships: Array<{
      sourcePart: string | null;
      id: string;
      type: string;
      target: string;
    }>;
  };
  compatibility: {
    unsupportedFormulaFunctions: string[];
    calculationErrors: number;
  };
  stats: {
    sheets: number;
    cells: number;
    formulas: number;
    calculatedFormulas: number;
    styles: number;
    tables: number;
    charts: number;
    validations: number;
    packageParts: number;
    opaqueParts: number;
  };
};

export type XlsxSemanticLimits = {
  maxSheets: number;
  maxCells: number;
  maxSharedStrings: number;
  maxTextCharacters: number;
  maxStyles: number;
};

export const DEFAULT_XLSX_SEMANTIC_LIMITS: Readonly<XlsxSemanticLimits> = {
  maxSheets: 1024,
  maxCells: 2_000_000,
  maxSharedStrings: 2_000_000,
  maxTextCharacters: 128 * 1024 * 1024,
  maxStyles: 100_000,
};

function child(nodes: OrderedXmlNode[], name: string) {
  return findChildElement(nodes, name);
}

function children(node: OrderedXmlNode | undefined, name: string) {
  return node ? getElementChildren(node, name) : [];
}

function parseNumber(value: string | undefined) {
  if (value === undefined || value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseInteger(value: string | undefined) {
  const number = parseNumber(value);
  return number !== undefined && Number.isSafeInteger(number)
    ? number
    : undefined;
}

function parseBoolean(value: string | undefined) {
  if (value === undefined) return undefined;
  return !['0', 'false', 'off'].includes(value.toLowerCase());
}

function descendantText(nodes: OrderedXmlNode[]): string {
  let text = getTextContent(nodes);
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      text += descendantText(value as OrderedXmlNode[]);
    }
  }
  return text;
}

function parseSharedStrings(pkg: OoxmlOpcPackage, part: string | undefined) {
  if (!part) return [];
  const root = findFirstElement(
    parseOrderedXml(pkg.requirePart(part), part, pkg.limits.maxXmlPartBytes),
    'sst'
  );
  if (!root)
    throw new OoxmlPackageError('XLSX shared strings have no sst root');
  return children(root, 'sst')
    .filter(node => 'si' in node)
    .map(node => descendantText(children(node, 'si')));
}

function color(node: OrderedXmlNode | undefined) {
  if (!node) return undefined;
  const rgb = getAttribute(node, 'rgb');
  return rgb && /^[0-9A-F]{8}$/i.test(rgb)
    ? `#${rgb.slice(2).toUpperCase()}`
    : rgb;
}

function parseStyles(pkg: OoxmlOpcPackage, part: string | undefined) {
  const empty = {
    fonts: [] as XlsxFont[],
    fills: [] as XlsxFill[],
    cells: [] as XlsxCellStyle[],
  };
  if (!part) return empty;
  const root = findFirstElement(
    parseOrderedXml(pkg.requirePart(part), part, pkg.limits.maxXmlPartBytes),
    'styleSheet'
  );
  if (!root) throw new OoxmlPackageError('XLSX styles have no styleSheet root');
  const nodes = children(root, 'styleSheet');
  const fontsRoot = child(nodes, 'fonts');
  const fillsRoot = child(nodes, 'fills');
  const cellXfsRoot = child(nodes, 'cellXfs');
  return {
    fonts: children(fontsRoot, 'fonts')
      .filter(node => 'font' in node)
      .map(node => {
        const content = children(node, 'font');
        return {
          name: getAttribute(child(content, 'name') ?? {}, 'val'),
          sizePt: parseNumber(getAttribute(child(content, 'sz') ?? {}, 'val')),
          bold: child(content, 'b') ? true : undefined,
          italic: child(content, 'i') ? true : undefined,
          underline:
            getAttribute(child(content, 'u') ?? {}, 'val') ??
            (child(content, 'u') ? 'single' : undefined),
          color: color(child(content, 'color')),
        } satisfies XlsxFont;
      }),
    fills: children(fillsRoot, 'fills')
      .filter(node => 'fill' in node)
      .map(node => {
        const pattern = child(children(node, 'fill'), 'patternFill');
        const patternNodes = children(pattern, 'patternFill');
        return {
          pattern: getAttribute(pattern ?? {}, 'patternType'),
          foregroundColor: color(child(patternNodes, 'fgColor')),
        } satisfies XlsxFill;
      }),
    cells: children(cellXfsRoot, 'cellXfs')
      .filter(node => 'xf' in node)
      .map((node, index) => {
        const alignment = child(children(node, 'xf'), 'alignment');
        return {
          index,
          numberFormatId: parseInteger(getAttribute(node, 'numFmtId')),
          fontId: parseInteger(getAttribute(node, 'fontId')),
          fillId: parseInteger(getAttribute(node, 'fillId')),
          borderId: parseInteger(getAttribute(node, 'borderId')),
          horizontalAlignment: getAttribute(alignment ?? {}, 'horizontal'),
          verticalAlignment: getAttribute(alignment ?? {}, 'vertical'),
          wrapText: parseBoolean(getAttribute(alignment ?? {}, 'wrapText')),
        } satisfies XlsxCellStyle;
      }),
  };
}

function findDescendant(
  nodes: OrderedXmlNode[],
  name: string
): OrderedXmlNode | undefined {
  for (const node of nodes) {
    if (name in node) return node;
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      const found = findDescendant(value as OrderedXmlNode[], name);
      if (found) return found;
    }
  }
  return undefined;
}

function findDescendants(
  nodes: OrderedXmlNode[],
  name: string,
  output: OrderedXmlNode[] = []
) {
  for (const node of nodes) {
    if (name in node) output.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      findDescendants(value as OrderedXmlNode[], name, output);
    }
  }
  return output;
}

function parseTable(pkg: OoxmlOpcPackage, part: string): XlsxTable {
  const root = findFirstElement(
    parseOrderedXml(pkg.requirePart(part), part, pkg.limits.maxXmlPartBytes),
    'table'
  );
  if (!root) throw new OoxmlPackageError(`XLSX table has no root: ${part}`);
  const nodes = children(root, 'table');
  const style = child(nodes, 'tableStyleInfo');
  const columnsRoot = child(nodes, 'tableColumns');
  return {
    id: getAttribute(root, 'id') ?? part,
    name: getAttribute(root, 'name') ?? part,
    displayName:
      getAttribute(root, 'displayName') ?? getAttribute(root, 'name') ?? part,
    ref: getAttribute(root, 'ref') ?? '',
    part,
    totalsRow: parseBoolean(getAttribute(root, 'totalsRowShown')) ?? false,
    styleName: getAttribute(style ?? {}, 'name'),
    columns: children(columnsRoot, 'tableColumns')
      .filter(node => 'tableColumn' in node)
      .map(node => ({
        id: getAttribute(node, 'id') ?? '',
        name: getAttribute(node, 'name') ?? '',
        totalsRowFunction: getAttribute(node, 'totalsRowFunction'),
      })),
  };
}

function anchorCell(nodes: OrderedXmlNode[], name: 'from' | 'to') {
  const anchor = child(nodes, name);
  if (!anchor) return undefined;
  const content = children(anchor, name);
  const column = parseInteger(
    descendantText(children(child(content, 'col'), 'col'))
  );
  const row = parseInteger(
    descendantText(children(child(content, 'row'), 'row'))
  );
  if (column === undefined || row === undefined) return undefined;
  return `${columnIndexToName(column + 1)}${row + 1}`;
}

function chartType(nodes: OrderedXmlNode[]): XlsxChart['type'] {
  if (findDescendant(nodes, 'lineChart')) return 'line';
  if (findDescendant(nodes, 'pieChart')) return 'pie';
  const bar = findDescendant(nodes, 'barChart');
  if (!bar) return 'unknown';
  const direction = findDescendant(children(bar, 'barChart'), 'barDir');
  return getAttribute(direction ?? {}, 'val') === 'bar' ? 'bar' : 'column';
}

function parseChart(
  pkg: OoxmlOpcPackage,
  drawingPart: string,
  relationshipId: string,
  part: string,
  anchor?: XlsxChart['anchor']
): XlsxChart {
  const root = findFirstElement(
    parseOrderedXml(pkg.requirePart(part), part, pkg.limits.maxXmlPartBytes),
    'chartSpace'
  );
  if (!root) throw new OoxmlPackageError(`XLSX chart has no root: ${part}`);
  const nodes = children(root, 'chartSpace');
  const titleNode = findDescendant(nodes, 'title');
  const series = findDescendants(nodes, 'ser').map(seriesNode => {
    const seriesNodes = children(seriesNode, 'ser');
    const text = findDescendant(children(child(seriesNodes, 'tx'), 'tx'), 'v');
    const category = findDescendant(
      children(child(seriesNodes, 'cat'), 'cat'),
      'f'
    );
    const value = findDescendant(
      children(child(seriesNodes, 'val'), 'val'),
      'f'
    );
    return {
      name: text ? descendantText(children(text, 'v')) : undefined,
      categoryFormula: category
        ? descendantText(children(category, 'f'))
        : undefined,
      valueFormula: value ? descendantText(children(value, 'f')) : undefined,
    };
  });
  return {
    id: `${drawingPart}:${relationshipId}`,
    part,
    drawingPart,
    type: chartType(nodes),
    title: titleNode
      ? descendantText(children(titleNode, 'title')).trim() || undefined
      : undefined,
    anchor,
    series,
  };
}

function parseWorksheetAssets(pkg: OoxmlOpcPackage, worksheetPart: string) {
  const relationships = pkg.getRelationships(worksheetPart);
  const tables = relationships
    .filter(
      relationship =>
        relationshipTypeName(relationship.type) === 'table' &&
        relationship.resolvedTarget
    )
    .map(relationship =>
      parseTable(pkg, relationship.resolvedTarget as string)
    );
  const charts: XlsxChart[] = [];
  const drawingParts: string[] = [];
  for (const drawingRelationship of relationships.filter(
    relationship =>
      relationshipTypeName(relationship.type) === 'drawing' &&
      relationship.resolvedTarget
  )) {
    const drawingPart = drawingRelationship.resolvedTarget as string;
    drawingParts.push(drawingPart);
    const root = findFirstElement(
      parseOrderedXml(
        pkg.requirePart(drawingPart),
        drawingPart,
        pkg.limits.maxXmlPartBytes
      ),
      'wsDr'
    );
    if (!root) {
      throw new OoxmlPackageError(`XLSX drawing has no root: ${drawingPart}`);
    }
    const chartRelationships = new Map(
      pkg
        .getRelationships(drawingPart)
        .filter(
          relationship =>
            relationshipTypeName(relationship.type) === 'chart' &&
            relationship.resolvedTarget
        )
        .map(relationship => [relationship.id, relationship])
    );
    for (const anchor of children(root, 'wsDr').filter(node =>
      ['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].some(
        name => name in node
      )
    )) {
      const anchorName = Object.keys(anchor).find(key => !key.startsWith(':'));
      const anchorNodes = anchorName ? children(anchor, anchorName) : [];
      const chartNode = findDescendant(anchorNodes, 'chart');
      const relationshipId = getAttribute(chartNode ?? {}, 'id');
      const relationship = relationshipId
        ? chartRelationships.get(relationshipId)
        : undefined;
      if (!relationshipId || !relationship?.resolvedTarget) continue;
      charts.push(
        parseChart(
          pkg,
          drawingPart,
          relationshipId,
          relationship.resolvedTarget,
          {
            fromCell: anchorCell(anchorNodes, 'from'),
            toCell: anchorCell(anchorNodes, 'to'),
          }
        )
      );
    }
  }
  return {
    tables,
    charts,
    semanticParts: [
      ...tables.map(table => table.part),
      ...drawingParts,
      ...charts.map(chart => chart.part),
    ],
  };
}

function rawCellValue(node: OrderedXmlNode, sharedStrings: readonly string[]) {
  const content = children(node, 'c');
  const valueText = descendantText(children(child(content, 'v'), 'v'));
  const type = getAttribute(node, 't');
  if (type === 'inlineStr') {
    return {
      type: 'string' as const,
      value: descendantText(children(child(content, 'is'), 'is')),
    };
  }
  if (type === 's') {
    const index = parseInteger(valueText);
    return {
      type: 'string' as const,
      value: index === undefined ? '' : (sharedStrings[index] ?? ''),
    };
  }
  if (type === 'b')
    return { type: 'boolean' as const, value: valueText === '1' };
  if (type === 'str') return { type: 'string' as const, value: valueText };
  if (type === 'e') return { type: 'error' as const, value: valueText };
  if (type === 'd') return { type: 'date' as const, value: valueText };
  if (!valueText) return { type: 'blank' as const, value: null };
  const number = parseNumber(valueText);
  return number === undefined
    ? { type: 'string' as const, value: valueText }
    : { type: 'number' as const, value: number };
}

function parseWorksheet(
  pkg: OoxmlOpcPackage,
  descriptor: Pick<
    XlsxWorksheet,
    'id' | 'name' | 'state' | 'relationshipId' | 'part'
  >,
  sharedStrings: readonly string[],
  limits: XlsxSemanticLimits,
  counters: { cells: number; textCharacters: number }
): XlsxWorksheet {
  const root = findFirstElement(
    parseOrderedXml(
      pkg.requirePart(descriptor.part),
      descriptor.part,
      pkg.limits.maxXmlPartBytes
    ),
    'worksheet'
  );
  if (!root)
    throw new OoxmlPackageError(
      `XLSX worksheet has no root: ${descriptor.part}`
    );
  const nodes = children(root, 'worksheet');
  const rowsRoot = child(nodes, 'sheetData');
  const cells: XlsxCell[] = [];
  const rows: XlsxWorksheet['rows'] = [];
  for (const rowNode of children(rowsRoot, 'sheetData').filter(
    node => 'row' in node
  )) {
    const rowNumber = parseInteger(getAttribute(rowNode, 'r'));
    if (rowNumber) {
      rows.push({
        row: rowNumber,
        heightPt: parseNumber(getAttribute(rowNode, 'ht')),
        hidden: parseBoolean(getAttribute(rowNode, 'hidden')),
      });
    }
    for (const cellNode of children(rowNode, 'row').filter(
      node => 'c' in node
    )) {
      const reference = getAttribute(cellNode, 'r');
      if (!reference)
        throw new OoxmlPackageError(
          `XLSX cell has no address: ${descriptor.part}`
        );
      const address = parseCellAddress(reference);
      counters.cells++;
      if (counters.cells > limits.maxCells)
        throw new OoxmlPackageError('XLSX workbook contains too many cells');
      const parsed = rawCellValue(cellNode, sharedStrings);
      if (typeof parsed.value === 'string') {
        counters.textCharacters += parsed.value.length;
        if (counters.textCharacters > limits.maxTextCharacters) {
          throw new OoxmlPackageError('XLSX workbook contains too much text');
        }
      }
      const formulaNode = child(children(cellNode, 'c'), 'f');
      const formula = formulaNode
        ? descendantText(children(formulaNode, 'f'))
        : undefined;
      let formulaAst: XlsxFormulaAst | undefined;
      let calculationError: string | undefined;
      if (formula) {
        try {
          formulaAst = parseXlsxFormula(formula);
        } catch (error) {
          calculationError =
            error instanceof Error ? error.message : String(error);
        }
      }
      cells.push({
        address: address.address,
        row: address.row,
        column: address.column,
        type: parsed.type,
        value: parsed.value,
        formula,
        formulaAst,
        cachedValue: formula ? parsed.value : undefined,
        calculationError,
        styleIndex: parseInteger(getAttribute(cellNode, 's')),
      });
    }
  }
  cells.sort((left, right) =>
    compareCellAddresses(left.address, right.address)
  );
  const columnsRoot = child(nodes, 'cols');
  const columns = children(columnsRoot, 'cols')
    .filter(node => 'col' in node)
    .map(node => ({
      min: parseInteger(getAttribute(node, 'min')) ?? 1,
      max: parseInteger(getAttribute(node, 'max')) ?? 1,
      width: parseNumber(getAttribute(node, 'width')),
      hidden: parseBoolean(getAttribute(node, 'hidden')),
      styleIndex: parseInteger(getAttribute(node, 'style')),
    }));
  const mergedRoot = child(nodes, 'mergeCells');
  const mergedCells = children(mergedRoot, 'mergeCells')
    .filter(node => 'mergeCell' in node)
    .map(node => getAttribute(node, 'ref'))
    .filter((value): value is string => Boolean(value));
  const sheetViews = child(nodes, 'sheetViews');
  const sheetView = children(sheetViews, 'sheetViews').find(
    node => 'sheetView' in node
  );
  const pane = child(children(sheetView, 'sheetView'), 'pane');
  const frozenPane =
    pane && getAttribute(pane, 'state') === 'frozen'
      ? {
          xSplit: parseNumber(getAttribute(pane, 'xSplit')),
          ySplit: parseNumber(getAttribute(pane, 'ySplit')),
          topLeftCell: getAttribute(pane, 'topLeftCell'),
        }
      : undefined;
  const autoFilterNode = child(nodes, 'autoFilter');
  const autoFilterRef = getAttribute(autoFilterNode ?? {}, 'ref');
  const autoFilter =
    autoFilterNode && autoFilterRef
      ? {
          ref: autoFilterRef,
          criteria: children(autoFilterNode, 'autoFilter')
            .filter(node => 'filterColumn' in node)
            .map(node => ({
              columnIndex: parseInteger(getAttribute(node, 'colId')) ?? 0,
              values: findDescendants(children(node, 'filterColumn'), 'filter')
                .map(filter => getAttribute(filter, 'val'))
                .filter((value): value is string => value !== undefined),
            })),
        }
      : undefined;
  const validationsRoot = child(nodes, 'dataValidations');
  const dataValidations = children(validationsRoot, 'dataValidations')
    .filter(node => 'dataValidation' in node)
    .map(node => {
      const validationNodes = children(node, 'dataValidation');
      const formula1 = child(validationNodes, 'formula1');
      const formula2 = child(validationNodes, 'formula2');
      return {
        range: getAttribute(node, 'sqref') ?? '',
        type: getAttribute(node, 'type'),
        operator: getAttribute(node, 'operator'),
        allowBlank: parseBoolean(getAttribute(node, 'allowBlank')),
        formula1: formula1
          ? descendantText(children(formula1, 'formula1'))
          : undefined,
        formula2: formula2
          ? descendantText(children(formula2, 'formula2'))
          : undefined,
        promptTitle: getAttribute(node, 'promptTitle'),
        prompt: getAttribute(node, 'prompt'),
        errorTitle: getAttribute(node, 'errorTitle'),
        error: getAttribute(node, 'error'),
      } satisfies XlsxDataValidation;
    })
    .filter(validation => validation.range);
  const assets = parseWorksheetAssets(pkg, descriptor.part);
  return {
    ...descriptor,
    dimension: getAttribute(child(nodes, 'dimension') ?? {}, 'ref'),
    cells,
    rows,
    columns,
    mergedCells,
    frozenPane,
    autoFilter,
    dataValidations,
    tables: assets.tables,
    charts: assets.charts,
  };
}

function calculateSheets(sheets: XlsxWorksheet[]) {
  const sheetByName = new Map(sheets.map(sheet => [sheet.name, sheet]));
  const values = new Map<string, XlsxFormulaValue>();
  const visiting = new Set<string>();
  const key = (sheet: string, address: string) => `${sheet}\0${address}`;
  const resolve = (sheetName: string, address: string): XlsxFormulaValue => {
    const normalized = parseCellAddress(address).address;
    const cacheKey = key(sheetName, normalized);
    if (values.has(cacheKey)) return values.get(cacheKey) ?? null;
    if (visiting.has(cacheKey))
      throw new OoxmlPackageError('XLSX formula contains a circular reference');
    const sheet = sheetByName.get(sheetName);
    const cell = sheet?.cells.find(
      candidate => candidate.address === normalized
    );
    if (!cell) return null;
    if (!cell.formulaAst) return cell.value;
    visiting.add(cacheKey);
    try {
      const calculated = evaluateXlsxFormula(cell.formulaAst, {
        sheet: sheetName,
        resolveCell: resolve,
      });
      const scalar = Array.isArray(calculated)
        ? (calculated[0] ?? null)
        : calculated;
      values.set(cacheKey, scalar);
      cell.calculatedValue = scalar;
      return scalar;
    } finally {
      visiting.delete(cacheKey);
    }
  };
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      if (!cell.formulaAst) continue;
      try {
        resolve(sheet.name, cell.address);
      } catch (error) {
        cell.calculationError =
          error instanceof Error ? error.message : String(error);
      }
    }
  }
}

function packageInventory(pkg: OoxmlOpcPackage, semanticParts: Set<string>) {
  const parts = pkg.listParts().map(part => ({
    ...part,
    handling: semanticParts.has(part.path)
      ? ('semantic' as const)
      : ('opaque' as const),
  }));
  const externalRelationships: XlsxSemanticState['package']['externalRelationships'] =
    [];
  for (const part of parts) {
    if (!part.path.endsWith('.rels')) continue;
    const sourcePart = sourcePartNameFromRelationshipPart(part.path);
    for (const relationship of pkg.getRelationships(sourcePart)) {
      if (relationship.targetMode === 'External') {
        externalRelationships.push({
          sourcePart,
          id: relationship.id,
          type: relationship.type,
          target: relationship.target,
        });
      }
    }
  }
  return {
    parts,
    opaqueParts: parts
      .filter(part => part.handling === 'opaque')
      .map(part => part.path),
    externalRelationships,
  };
}

export function readXlsxSemanticState(
  pkg: OoxmlOpcPackage,
  options: Partial<XlsxSemanticLimits> = {}
): XlsxSemanticState {
  if (pkg.format !== 'xlsx')
    throw new OoxmlPackageError('Expected an XLSX package');
  const limits = { ...DEFAULT_XLSX_SEMANTIC_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new OoxmlPackageError(
        `XLSX semantic limit must be positive: ${name}`
      );
    }
  }
  const workbookRoot = findFirstElement(
    parseOrderedXml(
      pkg.requirePart(pkg.mainPart),
      pkg.mainPart,
      pkg.limits.maxXmlPartBytes
    ),
    'workbook'
  );
  if (!workbookRoot)
    throw new OoxmlPackageError('XLSX workbook has no workbook root');
  const workbookNodes = children(workbookRoot, 'workbook');
  const relationships = pkg.getRelationships(pkg.mainPart);
  const relationshipById = new Map(
    relationships.map(relationship => [relationship.id, relationship])
  );
  const relationshipByType = (type: string) =>
    relationships.find(
      relationship => relationshipTypeName(relationship.type) === type
    )?.resolvedTarget;
  const sharedStringsPart = relationshipByType('sharedStrings');
  const stylesPart = relationshipByType('styles');
  const sharedStrings = parseSharedStrings(pkg, sharedStringsPart);
  if (sharedStrings.length > limits.maxSharedStrings) {
    throw new OoxmlPackageError(
      'XLSX workbook contains too many shared strings'
    );
  }
  const styles = parseStyles(pkg, stylesPart);
  if (styles.cells.length > limits.maxStyles)
    throw new OoxmlPackageError('XLSX workbook contains too many styles');
  const sheetsRoot = child(workbookNodes, 'sheets');
  const sheetNodes = children(sheetsRoot, 'sheets').filter(
    node => 'sheet' in node
  );
  if (!sheetNodes.length || sheetNodes.length > limits.maxSheets) {
    throw new OoxmlPackageError('XLSX workbook has an invalid sheet count');
  }
  const counters = {
    cells: 0,
    textCharacters: sharedStrings.reduce((sum, value) => sum + value.length, 0),
  };
  const sheets = sheetNodes.map((node, index) => {
    const relationshipId = getAttribute(node, 'id');
    const relationship = relationshipId
      ? relationshipById.get(relationshipId)
      : undefined;
    if (
      !relationshipId ||
      !relationship?.resolvedTarget ||
      relationshipTypeName(relationship.type) !== 'worksheet'
    ) {
      throw new OoxmlPackageError(
        `XLSX sheet relationship is invalid at index ${index}`
      );
    }
    return parseWorksheet(
      pkg,
      {
        id: getAttribute(node, 'sheetId') ?? String(index + 1),
        name: getAttribute(node, 'name') ?? `Sheet${index + 1}`,
        state: getAttribute(node, 'state'),
        relationshipId,
        part: relationship.resolvedTarget,
      },
      sharedStrings,
      limits,
      counters
    );
  });
  calculateSheets(sheets);
  const bookViews = child(workbookNodes, 'bookViews');
  const workbookView = children(bookViews, 'bookViews').find(
    node => 'workbookView' in node
  );
  const activeSheetIndex = Math.min(
    parseInteger(getAttribute(workbookView ?? {}, 'activeTab')) ?? 0,
    sheets.length - 1
  );
  const definedNamesRoot = child(workbookNodes, 'definedNames');
  const definedNames = children(definedNamesRoot, 'definedNames')
    .filter(node => 'definedName' in node)
    .map(node => ({
      name: getAttribute(node, 'name') ?? '',
      formula: descendantText(children(node, 'definedName')),
      localSheetId: parseInteger(getAttribute(node, 'localSheetId')),
    }))
    .filter(item => item.name);
  const semanticParts = new Set([
    '[Content_Types].xml',
    '_rels/.rels',
    pkg.mainPart,
    ...sheets.map(sheet => sheet.part),
    ...sheets.map(sheet => relationshipPartName(sheet.part)),
    ...sheets.flatMap(sheet => [
      ...sheet.tables.map(table => table.part),
      ...sheet.tables.map(table => relationshipPartName(table.part)),
      ...sheet.charts.flatMap(chart => [
        chart.drawingPart,
        relationshipPartName(chart.drawingPart),
        chart.part,
        relationshipPartName(chart.part),
      ]),
    ]),
    ...(sharedStringsPart ? [sharedStringsPart] : []),
    ...(stylesPart ? [stylesPart] : []),
  ]);
  const packageState = packageInventory(pkg, semanticParts);
  const formulas = sheets
    .flatMap(sheet => sheet.cells)
    .filter(cell => cell.formula);
  const unsupportedFormulaFunctions = [
    ...new Set(
      formulas.flatMap(cell => {
        const match = cell.calculationError?.match(
          /function is unsupported: ([A-Z0-9_.]+)/
        );
        return match ? [match[1]] : [];
      })
    ),
  ].sort();
  return {
    schemaVersion: XLSX_SEMANTIC_STATE_VERSION,
    modelVersion: XLSX_MODEL_VERSION,
    workbookPart: pkg.mainPart,
    activeSheetIndex,
    sheets,
    definedNames,
    styles,
    package: packageState,
    compatibility: {
      unsupportedFormulaFunctions,
      calculationErrors: formulas.filter(cell => cell.calculationError).length,
    },
    stats: {
      sheets: sheets.length,
      cells: counters.cells,
      formulas: formulas.length,
      calculatedFormulas: formulas.filter(
        cell => cell.calculatedValue !== undefined
      ).length,
      styles: styles.cells.length,
      tables: sheets.reduce((total, sheet) => total + sheet.tables.length, 0),
      charts: sheets.reduce((total, sheet) => total + sheet.charts.length, 0),
      validations: sheets.reduce(
        (total, sheet) => total + sheet.dataValidations.length,
        0
      ),
      packageParts: packageState.parts.length,
      opaqueParts: packageState.opaqueParts.length,
    },
  };
}
