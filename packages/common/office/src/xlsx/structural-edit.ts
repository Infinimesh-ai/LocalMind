import type {
  OfficeWorkbookAddChartCommand,
  OfficeWorkbookColumnPropertiesCommand,
  OfficeWorkbookDeleteChartCommand,
  OfficeWorkbookDimensionChangeCommand,
  OfficeWorkbookFilterCommand,
  OfficeWorkbookFormatRangeCommand,
  OfficeWorkbookMergeCellsCommand,
  OfficeWorkbookRowPropertiesCommand,
  OfficeWorkbookSetTableCommand,
  OfficeWorkbookSheetAddCommand,
  OfficeWorkbookSheetDeleteCommand,
  OfficeWorkbookSheetRenameCommand,
  OfficeWorkbookSheetReorderCommand,
  OfficeWorkbookValidationCommand,
} from '../command';
import { relationshipPartName } from '../docx/path';
import { relationshipTypeName } from '../docx/relationships';
import {
  buildPreservedXml,
  type OrderedXmlNode,
  parsePreservedXml,
} from '../docx/xml';
import {
  appendOoxmlRelationship,
  ensureOoxmlContentType,
  nextOoxmlPartName,
  nextOoxmlRelationshipId,
  type OoxmlOpcPackage,
  OoxmlPackageError,
  relativeOoxmlTarget,
  removeOoxmlContentTypeOverride,
  removeOoxmlRelationship,
} from '../ooxml';
import {
  columnIndexToName,
  expandCellRange,
  parseCellAddress,
} from './address';
import { openXlsxPackage } from './package';
import {
  readXlsxSemanticState,
  type XlsxSemanticState,
  type XlsxWorksheet,
} from './semantic';

export type XlsxStructuralCommand =
  | OfficeWorkbookFormatRangeCommand
  | OfficeWorkbookMergeCellsCommand
  | OfficeWorkbookRowPropertiesCommand
  | OfficeWorkbookColumnPropertiesCommand
  | OfficeWorkbookFilterCommand
  | OfficeWorkbookValidationCommand
  | OfficeWorkbookSheetAddCommand
  | OfficeWorkbookSheetDeleteCommand
  | OfficeWorkbookSheetRenameCommand
  | OfficeWorkbookSheetReorderCommand
  | OfficeWorkbookDimensionChangeCommand
  | OfficeWorkbookSetTableCommand
  | OfficeWorkbookAddChartCommand
  | OfficeWorkbookDeleteChartCommand;

type PackageChanges = {
  replacements: Map<string, Uint8Array>;
  additions: Map<string, Uint8Array>;
  removals: Set<string>;
};

function changes(): PackageChanges {
  return {
    replacements: new Map(),
    additions: new Map(),
    removals: new Set(),
  };
}

function elementKey(node: OrderedXmlNode) {
  return Object.keys(node).find(
    key => key !== ':@' && key !== '#text' && !key.startsWith('?')
  );
}

function localName(name: string) {
  const colon = name.lastIndexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

function prefixOf(name: string) {
  const colon = name.indexOf(':');
  return colon === -1 ? '' : name.slice(0, colon);
}

function qualify(prefix: string, name: string) {
  return prefix ? `${prefix}:${name}` : name;
}

function attributes(node: OrderedXmlNode) {
  const value = node[':@'];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

function attribute(node: OrderedXmlNode, name: string) {
  return Object.entries(attributes(node)).find(
    ([key]) => localName(key) === name
  )?.[1];
}

function setAttribute(node: OrderedXmlNode, name: string, value?: string) {
  const attrs = { ...attributes(node) };
  const existing = Object.keys(attrs).find(key => localName(key) === name);
  if (value === undefined) {
    if (existing) delete attrs[existing];
  } else {
    attrs[existing ?? name] = value;
  }
  if (Object.keys(attrs).length) node[':@'] = attrs;
  else delete node[':@'];
}

function children(node: OrderedXmlNode) {
  const key = elementKey(node);
  const value = key ? node[key] : undefined;
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

function createElement(
  prefix: string,
  name: string,
  content: OrderedXmlNode[] = [],
  attrs?: Record<string, string>
): OrderedXmlNode {
  return {
    [qualify(prefix, name)]: content,
    ...(attrs && Object.keys(attrs).length ? { ':@': attrs } : {}),
  };
}

function findChild(nodes: OrderedXmlNode[], name: string) {
  return nodes.find(node => {
    const key = elementKey(node);
    return key ? localName(key) === name : false;
  });
}

function removeChildren(nodes: OrderedXmlNode[], name: string) {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const key = elementKey(nodes[index]);
    if (key && localName(key) === name) nodes.splice(index, 1);
  }
}

function rootContent(nodes: OrderedXmlNode[], name: string, part: string) {
  const root = findChild(nodes, name);
  const key = root ? elementKey(root) : undefined;
  const content = key ? root?.[key] : undefined;
  if (!root || !key || !Array.isArray(content)) {
    throw new OoxmlPackageError(`XLSX ${name} root is invalid: ${part}`);
  }
  return {
    root,
    prefix: prefixOf(key),
    content: content as OrderedXmlNode[],
  };
}

function ensureContainer(
  nodes: OrderedXmlNode[],
  prefix: string,
  name: string,
  before: readonly string[] = []
) {
  const existing = findChild(nodes, name);
  if (existing) return existing;
  const created = createElement(prefix, name);
  const insertion = nodes.findIndex(node => {
    const key = elementKey(node);
    return key ? before.includes(localName(key)) : false;
  });
  nodes.splice(insertion === -1 ? nodes.length : insertion, 0, created);
  return created;
}

function updateCount(node: OrderedXmlNode) {
  setAttribute(node, 'count', String(children(node).length));
}

function writePart(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  part: string,
  bytes: Uint8Array
) {
  if (pkg.hasPart(part)) output.replacements.set(part, bytes);
  else output.additions.set(part, bytes);
}

function currentPart(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  part: string
) {
  return (
    output.replacements.get(part) ??
    output.additions.get(part) ??
    pkg.readPart(part)
  );
}

function writeContentType(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  input:
    | { kind: 'default'; extension: string; contentType: string }
    | { kind: 'override'; partName: string; contentType: string }
) {
  output.replacements.set(
    '[Content_Types].xml',
    ensureOoxmlContentType(
      currentPart(pkg, output, '[Content_Types].xml') ??
        pkg.requirePart('[Content_Types].xml'),
      input,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function removeContentType(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  part: string
) {
  output.replacements.set(
    '[Content_Types].xml',
    removeOoxmlContentTypeOverride(
      currentPart(pkg, output, '[Content_Types].xml') ??
        pkg.requirePart('[Content_Types].xml'),
      part,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function requireSheet(state: XlsxSemanticState, sheetId: string) {
  const sheet = state.sheets.find(candidate => candidate.id === sheetId);
  if (!sheet) throw new OoxmlPackageError(`XLSX sheet not found: ${sheetId}`);
  return sheet;
}

function worksheetXml(pkg: OoxmlOpcPackage, sheet: XlsxWorksheet) {
  const xml = parsePreservedXml(
    pkg.requirePart(sheet.part),
    sheet.part,
    pkg.limits.maxXmlPartBytes
  );
  const root = rootContent(xml, 'worksheet', sheet.part);
  const sheetData = ensureContainer(root.content, root.prefix, 'sheetData', [
    'sheetCalcPr',
    'sheetProtection',
    'protectedRanges',
    'scenarios',
    'autoFilter',
    'sortState',
    'dataConsolidate',
    'customSheetViews',
    'mergeCells',
  ]);
  return { xml, root, sheetData, rows: children(sheetData) };
}

function rowNumber(node: OrderedXmlNode) {
  return Number(attribute(node, 'r'));
}

function ensureRow(rows: OrderedXmlNode[], row: number, prefix: string) {
  const existing = rows.find(node => {
    const key = elementKey(node);
    return key && localName(key) === 'row' && rowNumber(node) === row;
  });
  if (existing) return existing;
  const created = createElement(prefix, 'row', [], { r: String(row) });
  const insertion = rows.findIndex(node => {
    const key = elementKey(node);
    return key && localName(key) === 'row' && rowNumber(node) > row;
  });
  rows.splice(insertion === -1 ? rows.length : insertion, 0, created);
  return created;
}

function ensureCell(rowNode: OrderedXmlNode, address: string, prefix: string) {
  const rowChildren = children(rowNode);
  const existing = rowChildren.find(node => {
    const key = elementKey(node);
    return key && localName(key) === 'c' && attribute(node, 'r') === address;
  });
  if (existing) return existing;
  const created = createElement(prefix, 'c', [], { r: address });
  const target = parseCellAddress(address);
  const insertion = rowChildren.findIndex(node => {
    const key = elementKey(node);
    if (!key || localName(key) !== 'c') return false;
    const reference = attribute(node, 'r');
    if (!reference) return false;
    const candidate = parseCellAddress(reference);
    return candidate.column > target.column;
  });
  rowChildren.splice(
    insertion === -1 ? rowChildren.length : insertion,
    0,
    created
  );
  return created;
}

function normalizedRange(input: string) {
  const [startInput, endInput] = input.split(':');
  const start = parseCellAddress(startInput);
  const end = parseCellAddress(endInput);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minColumn = Math.min(start.column, end.column);
  const maxColumn = Math.max(start.column, end.column);
  return {
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    ref: `${columnIndexToName(minColumn)}${minRow}:${columnIndexToName(maxColumn)}${maxRow}`,
  };
}

const STYLES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';
const WORKSHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const STYLES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const WORKSHEET_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const TABLE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml';
const TABLE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table';
const DRAWING_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.drawing+xml';
const DRAWING_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const CHART_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CHART_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';

function emptyStylesPart() {
  return new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  );
}

function ensureStylesPart(pkg: OoxmlOpcPackage, output: PackageChanges) {
  const relationship = pkg
    .getRelationships(pkg.mainPart)
    .find(item => relationshipTypeName(item.type) === 'styles');
  if (relationship?.resolvedTarget) {
    return {
      part: relationship.resolvedTarget,
      bytes: pkg.requirePart(relationship.resolvedTarget),
    };
  }
  const part = nextOoxmlPartName(
    pkg.listParts().map(item => item.path),
    'xl',
    'styles',
    'xml'
  );
  const relationshipId = nextOoxmlRelationshipId(
    pkg.getRelationships(pkg.mainPart)
  );
  const relationshipPart = relationshipPartName(pkg.mainPart);
  writePart(
    pkg,
    output,
    relationshipPart,
    appendOoxmlRelationship(
      pkg.readPart(relationshipPart),
      relationshipPart,
      {
        id: relationshipId,
        type: STYLES_RELATIONSHIP,
        target: relativeOoxmlTarget(pkg.mainPart, part),
      },
      pkg.limits.maxXmlPartBytes
    )
  );
  output.replacements.set(
    '[Content_Types].xml',
    ensureOoxmlContentType(
      pkg.requirePart('[Content_Types].xml'),
      { kind: 'override', partName: part, contentType: STYLES_CONTENT_TYPE },
      pkg.limits.maxXmlPartBytes
    )
  );
  return { part, bytes: emptyStylesPart() };
}

function setToggle(
  nodes: OrderedXmlNode[],
  prefix: string,
  name: string,
  value: boolean
) {
  let node = findChild(nodes, name);
  if (!node) {
    node = createElement(prefix, name);
    nodes.push(node);
  }
  setAttribute(node, 'val', value ? undefined : '0');
}

function setValueElement(
  nodes: OrderedXmlNode[],
  prefix: string,
  name: string,
  value: string
) {
  let node = findChild(nodes, name);
  if (!node) {
    node = createElement(prefix, name);
    nodes.push(node);
  }
  setAttribute(node, 'val', value);
}

function appendFormattedStyle(
  stylesXml: OrderedXmlNode[],
  part: string,
  baseStyleIndex: number,
  format: OfficeWorkbookFormatRangeCommand['format']
) {
  const root = rootContent(stylesXml, 'styleSheet', part);
  const fonts = ensureContainer(root.content, root.prefix, 'fonts');
  const fills = ensureContainer(root.content, root.prefix, 'fills');
  ensureContainer(root.content, root.prefix, 'borders');
  const cellXfs = ensureContainer(root.content, root.prefix, 'cellXfs');
  const xfNodes = children(cellXfs).filter(
    node => localName(elementKey(node) ?? '') === 'xf'
  );
  const baseXf =
    xfNodes[baseStyleIndex] ??
    xfNodes[0] ??
    createElement(root.prefix, 'xf', [], {
      numFmtId: '0',
      fontId: '0',
      fillId: '0',
      borderId: '0',
    });
  const xf = structuredClone(baseXf) as OrderedXmlNode;
  const fontChanged = [
    format.fontFamily,
    format.fontSizePt,
    format.bold,
    format.italic,
    format.underline,
    format.textColor,
  ].some(value => value !== undefined);
  if (fontChanged) {
    const fontNodes = children(fonts).filter(
      node => localName(elementKey(node) ?? '') === 'font'
    );
    const fontId = Number(attribute(baseXf, 'fontId')) || 0;
    const font = structuredClone(
      fontNodes[fontId] ?? createElement(root.prefix, 'font')
    ) as OrderedXmlNode;
    const nextFontId = fontNodes.length;
    const fontChildren = children(font);
    if (format.fontFamily !== undefined)
      setValueElement(fontChildren, root.prefix, 'name', format.fontFamily);
    if (format.fontSizePt !== undefined)
      setValueElement(
        fontChildren,
        root.prefix,
        'sz',
        String(format.fontSizePt)
      );
    if (format.bold !== undefined)
      setToggle(fontChildren, root.prefix, 'b', format.bold);
    if (format.italic !== undefined)
      setToggle(fontChildren, root.prefix, 'i', format.italic);
    if (format.underline !== undefined)
      setToggle(fontChildren, root.prefix, 'u', format.underline);
    if (format.textColor !== undefined) {
      let color = findChild(fontChildren, 'color');
      if (!color) {
        color = createElement(root.prefix, 'color');
        fontChildren.push(color);
      }
      setAttribute(
        color,
        'rgb',
        `FF${format.textColor.slice(1).toUpperCase()}`
      );
    }
    children(fonts).push(font);
    updateCount(fonts);
    setAttribute(xf, 'fontId', String(nextFontId));
    setAttribute(xf, 'applyFont', '1');
  }
  if (format.fillColor !== undefined) {
    const nextFillId = children(fills).filter(
      node => localName(elementKey(node) ?? '') === 'fill'
    ).length;
    const fill = createElement(root.prefix, 'fill', [
      createElement(
        root.prefix,
        'patternFill',
        [
          createElement(root.prefix, 'fgColor', [], {
            rgb: `FF${format.fillColor.slice(1).toUpperCase()}`,
          }),
          createElement(root.prefix, 'bgColor', [], { indexed: '64' }),
        ],
        { patternType: 'solid' }
      ),
    ]);
    children(fills).push(fill);
    updateCount(fills);
    setAttribute(xf, 'fillId', String(nextFillId));
    setAttribute(xf, 'applyFill', '1');
  }
  if (format.numberFormatId !== undefined) {
    setAttribute(xf, 'numFmtId', String(format.numberFormatId));
    setAttribute(xf, 'applyNumberFormat', '1');
  }
  if (
    format.horizontalAlignment !== undefined ||
    format.verticalAlignment !== undefined ||
    format.wrapText !== undefined
  ) {
    const xfChildren = children(xf);
    let alignment = findChild(xfChildren, 'alignment');
    if (!alignment) {
      alignment = createElement(root.prefix, 'alignment');
      xfChildren.push(alignment);
    }
    if (format.horizontalAlignment !== undefined)
      setAttribute(alignment, 'horizontal', format.horizontalAlignment);
    if (format.verticalAlignment !== undefined)
      setAttribute(alignment, 'vertical', format.verticalAlignment);
    if (format.wrapText !== undefined)
      setAttribute(alignment, 'wrapText', format.wrapText ? '1' : '0');
    setAttribute(xf, 'applyAlignment', '1');
  }
  children(cellXfs).push(xf);
  updateCount(cellXfs);
  return xfNodes.length;
}

function formatRange(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookFormatRangeCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.target.sheetId);
  const worksheet = worksheetXml(pkg, sheet);
  const addresses = expandCellRange(
    ...(() => {
      const [start, end] = command.target.range.split(':');
      return [start, end] as const;
    })()
  );
  const styleSource = ensureStylesPart(pkg, output);
  const styleXml = parsePreservedXml(
    styleSource.bytes,
    styleSource.part,
    pkg.limits.maxXmlPartBytes
  );
  const semanticCells = new Map(sheet.cells.map(cell => [cell.address, cell]));
  const styleByBase = new Map<number, number>();
  for (const address of addresses) {
    const parsed = parseCellAddress(address);
    const row = ensureRow(worksheet.rows, parsed.row, worksheet.root.prefix);
    const cell = ensureCell(row, parsed.address, worksheet.root.prefix);
    const base =
      Number(attribute(cell, 's')) ||
      semanticCells.get(address)?.styleIndex ||
      0;
    let style = styleByBase.get(base);
    if (style === undefined) {
      style = appendFormattedStyle(
        styleXml,
        styleSource.part,
        base,
        command.format
      );
      styleByBase.set(base, style);
    }
    setAttribute(cell, 's', String(style));
  }
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  writePart(
    pkg,
    output,
    styleSource.part,
    buildPreservedXml(styleXml, styleSource.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    range: normalizedRange(command.target.range).ref,
    cells: addresses.length,
    generatedStyles: styleByBase.size,
  };
}

function rangesOverlap(
  left: ReturnType<typeof normalizedRange>,
  right: ReturnType<typeof normalizedRange>
) {
  return !(
    left.maxRow < right.minRow ||
    right.maxRow < left.minRow ||
    left.maxColumn < right.minColumn ||
    right.maxColumn < left.minColumn
  );
}

function mergeCells(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookMergeCellsCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.target.sheetId);
  const worksheet = worksheetXml(pkg, sheet);
  const range = normalizedRange(command.target.range);
  let mergeRoot = findChild(worksheet.root.content, 'mergeCells');
  if (!mergeRoot && command.merged) {
    mergeRoot = ensureContainer(
      worksheet.root.content,
      worksheet.root.prefix,
      'mergeCells',
      [
        'phoneticPr',
        'conditionalFormatting',
        'dataValidations',
        'hyperlinks',
        'printOptions',
        'pageMargins',
        'pageSetup',
        'headerFooter',
        'rowBreaks',
        'colBreaks',
        'customProperties',
        'cellWatches',
        'ignoredErrors',
        'smartTags',
        'drawing',
      ]
    );
  }
  const entries = mergeRoot ? children(mergeRoot) : [];
  const exact = entries.findIndex(node => attribute(node, 'ref') === range.ref);
  if (command.merged) {
    const conflict = entries.some(node => {
      const ref = attribute(node, 'ref');
      return ref
        ? rangesOverlap(range, normalizedRange(ref)) && ref !== range.ref
        : false;
    });
    if (conflict)
      throw new OoxmlPackageError(
        'XLSX merge overlaps an existing merged range'
      );
    if (exact === -1) {
      entries.push(
        createElement(worksheet.root.prefix, 'mergeCell', [], {
          ref: range.ref,
        })
      );
    }
  } else if (exact !== -1) {
    entries.splice(exact, 1);
  } else {
    throw new OoxmlPackageError(`XLSX merged range not found: ${range.ref}`);
  }
  if (mergeRoot) {
    if (entries.length) updateCount(mergeRoot);
    else removeChildren(worksheet.root.content, 'mergeCells');
  }
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    range: range.ref,
    merged: command.merged,
  };
}

function setRowProperties(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookRowPropertiesCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.sheetId);
  const worksheet = worksheetXml(pkg, sheet);
  const row = ensureRow(worksheet.rows, command.row, worksheet.root.prefix);
  if (command.heightPt !== undefined) {
    setAttribute(
      row,
      'ht',
      command.heightPt === null ? undefined : String(command.heightPt)
    );
    setAttribute(
      row,
      'customHeight',
      command.heightPt === null ? undefined : '1'
    );
  }
  if (command.hidden !== undefined)
    setAttribute(row, 'hidden', command.hidden ? '1' : '0');
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    row: command.row,
    heightPt: command.heightPt,
    hidden: command.hidden,
  };
}

function setColumnProperties(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookColumnPropertiesCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.sheetId);
  const worksheet = worksheetXml(pkg, sheet);
  const cols = ensureContainer(
    worksheet.root.content,
    worksheet.root.prefix,
    'cols',
    ['sheetData']
  );
  const entries = children(cols);
  let column = entries.find(
    node =>
      Number(attribute(node, 'min')) === command.startColumn &&
      Number(attribute(node, 'max')) === command.endColumn
  );
  if (!column) {
    column = createElement(worksheet.root.prefix, 'col', [], {
      min: String(command.startColumn),
      max: String(command.endColumn),
    });
    entries.push(column);
  }
  if (command.width !== undefined) {
    setAttribute(
      column,
      'width',
      command.width === null ? undefined : String(command.width)
    );
    setAttribute(
      column,
      'customWidth',
      command.width === null ? undefined : '1'
    );
  }
  if (command.hidden !== undefined)
    setAttribute(column, 'hidden', command.hidden ? '1' : '0');
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    startColumn: command.startColumn,
    endColumn: command.endColumn,
    width: command.width,
    hidden: command.hidden,
  };
}

function setFilter(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookFilterCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.target.sheetId);
  const worksheet = worksheetXml(pkg, sheet);
  removeChildren(worksheet.root.content, 'autoFilter');
  const range = normalizedRange(command.target.range);
  if (command.criteria.length) {
    const width = range.maxColumn - range.minColumn + 1;
    if (command.criteria.some(item => item.columnIndex >= width)) {
      throw new OoxmlPackageError('XLSX filter column is outside its range');
    }
    const filter = createElement(
      worksheet.root.prefix,
      'autoFilter',
      command.criteria.map(item =>
        createElement(
          worksheet.root.prefix,
          'filterColumn',
          [
            createElement(
              worksheet.root.prefix,
              'filters',
              item.values.map(value =>
                createElement(worksheet.root.prefix, 'filter', [], {
                  val: value,
                })
              )
            ),
          ],
          { colId: String(item.columnIndex) }
        )
      ),
      { ref: range.ref }
    );
    const insertion = worksheet.root.content.findIndex(node => {
      const key = elementKey(node);
      return key
        ? [
            'sortState',
            'dataConsolidate',
            'customSheetViews',
            'mergeCells',
            'phoneticPr',
            'conditionalFormatting',
            'dataValidations',
            'hyperlinks',
          ].includes(localName(key))
        : false;
    });
    worksheet.root.content.splice(
      insertion === -1 ? worksheet.root.content.length : insertion,
      0,
      filter
    );
  }
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    range: range.ref,
    criteria: command.criteria.length,
  };
}

function setValidation(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookValidationCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.target.sheetId);
  const worksheet = worksheetXml(pkg, sheet);
  const range = normalizedRange(command.target.range);
  let root = findChild(worksheet.root.content, 'dataValidations');
  if (!root && command.validation !== false) {
    root = ensureContainer(
      worksheet.root.content,
      worksheet.root.prefix,
      'dataValidations',
      [
        'hyperlinks',
        'printOptions',
        'pageMargins',
        'pageSetup',
        'headerFooter',
        'rowBreaks',
        'colBreaks',
        'customProperties',
        'cellWatches',
        'ignoredErrors',
        'smartTags',
        'drawing',
      ]
    );
  }
  const entries = root ? children(root) : [];
  const existing = entries.findIndex(
    node => attribute(node, 'sqref') === range.ref
  );
  if (existing !== -1) entries.splice(existing, 1);
  if (command.validation !== false) {
    const validation = command.validation;
    entries.push(
      createElement(
        worksheet.root.prefix,
        'dataValidation',
        [
          createElement(worksheet.root.prefix, 'formula1', [
            { '#text': validation.formula1 },
          ]),
          ...(validation.formula2 !== undefined
            ? [
                createElement(worksheet.root.prefix, 'formula2', [
                  { '#text': validation.formula2 },
                ]),
              ]
            : []),
        ],
        {
          type: validation.type,
          sqref: range.ref,
          ...(validation.operator ? { operator: validation.operator } : {}),
          allowBlank: validation.allowBlank ? '1' : '0',
          ...(validation.promptTitle
            ? { promptTitle: validation.promptTitle }
            : {}),
          ...(validation.prompt ? { prompt: validation.prompt } : {}),
          ...(validation.errorTitle
            ? { errorTitle: validation.errorTitle }
            : {}),
          ...(validation.error ? { error: validation.error } : {}),
          showInputMessage: validation.prompt ? '1' : '0',
          showErrorMessage: validation.error ? '1' : '0',
        }
      )
    );
  }
  if (root) {
    if (entries.length) updateCount(root);
    else removeChildren(worksheet.root.content, 'dataValidations');
  }
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    range: range.ref,
    enabled: command.validation !== false,
  };
}

function workbookXml(pkg: OoxmlOpcPackage) {
  const xml = parsePreservedXml(
    pkg.requirePart(pkg.mainPart),
    pkg.mainPart,
    pkg.limits.maxXmlPartBytes
  );
  const root = rootContent(xml, 'workbook', pkg.mainPart);
  const sheets = ensureContainer(root.content, root.prefix, 'sheets');
  return { xml, root, sheets, entries: children(sheets) };
}

function addSheet(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookSheetAddCommand,
  output: PackageChanges
) {
  if (
    state.sheets.some(
      sheet => sheet.name.toLowerCase() === command.name.toLowerCase()
    )
  ) {
    throw new OoxmlPackageError(
      `XLSX worksheet name already exists: ${command.name}`
    );
  }
  const workbook = workbookXml(pkg);
  const relationships = pkg.getRelationships(pkg.mainPart);
  const relationshipId = nextOoxmlRelationshipId(relationships);
  const part = nextOoxmlPartName(
    pkg.listParts().map(item => item.path),
    'xl/worksheets',
    'sheet',
    'xml'
  );
  const sheetId = String(
    Math.max(0, ...state.sheets.map(sheet => Number(sheet.id) || 0)) + 1
  );
  const node = createElement(workbook.root.prefix, 'sheet', [], {
    name: command.name,
    sheetId,
    'r:id': relationshipId,
  });
  const afterIndex = command.afterSheetId
    ? workbook.entries.findIndex(
        item => attribute(item, 'sheetId') === command.afterSheetId
      )
    : workbook.entries.length - 1;
  if (command.afterSheetId && afterIndex === -1) {
    throw new OoxmlPackageError(
      `XLSX sheet not found: ${command.afterSheetId}`
    );
  }
  workbook.entries.splice(afterIndex + 1, 0, node);
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(workbook.xml, pkg.mainPart, pkg.limits.maxXmlPartBytes)
  );
  const relationshipPart = relationshipPartName(pkg.mainPart);
  writePart(
    pkg,
    output,
    relationshipPart,
    appendOoxmlRelationship(
      pkg.readPart(relationshipPart),
      relationshipPart,
      {
        id: relationshipId,
        type: WORKSHEET_RELATIONSHIP,
        target: relativeOoxmlTarget(pkg.mainPart, part),
      },
      pkg.limits.maxXmlPartBytes
    )
  );
  output.replacements.set(
    '[Content_Types].xml',
    ensureOoxmlContentType(
      pkg.requirePart('[Content_Types].xml'),
      { kind: 'override', partName: part, contentType: WORKSHEET_CONTENT_TYPE },
      pkg.limits.maxXmlPartBytes
    )
  );
  output.additions.set(
    part,
    new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/></worksheet>'
    )
  );
  return { operation: command.operation, sheetId, name: command.name, part };
}

function deleteSheet(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookSheetDeleteCommand,
  output: PackageChanges
) {
  if (state.sheets.length === 1)
    throw new OoxmlPackageError('XLSX cannot delete its final worksheet');
  const sheet = requireSheet(state, command.sheetId);
  const workbook = workbookXml(pkg);
  const index = workbook.entries.findIndex(
    item => attribute(item, 'sheetId') === sheet.id
  );
  if (index === -1)
    throw new OoxmlPackageError('XLSX worksheet identity changed');
  workbook.entries.splice(index, 1);
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(workbook.xml, pkg.mainPart, pkg.limits.maxXmlPartBytes)
  );
  const relationshipPart = relationshipPartName(pkg.mainPart);
  output.replacements.set(
    relationshipPart,
    removeOoxmlRelationship(
      pkg.requirePart(relationshipPart),
      relationshipPart,
      sheet.relationshipId,
      pkg.limits.maxXmlPartBytes
    )
  );
  output.replacements.set(
    '[Content_Types].xml',
    removeOoxmlContentTypeOverride(
      pkg.requirePart('[Content_Types].xml'),
      sheet.part,
      pkg.limits.maxXmlPartBytes
    )
  );
  output.removals.add(sheet.part);
  const sheetRelationshipPart = relationshipPartName(sheet.part);
  if (pkg.hasPart(sheetRelationshipPart))
    output.removals.add(sheetRelationshipPart);
  return { operation: command.operation, sheetId: sheet.id, name: sheet.name };
}

function renameSheet(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookSheetRenameCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.sheetId);
  if (
    state.sheets.some(
      candidate =>
        candidate.id !== sheet.id &&
        candidate.name.toLowerCase() === command.name.toLowerCase()
    )
  ) {
    throw new OoxmlPackageError(
      `XLSX worksheet name already exists: ${command.name}`
    );
  }
  const workbook = workbookXml(pkg);
  const node = workbook.entries.find(
    item => attribute(item, 'sheetId') === sheet.id
  );
  if (!node) throw new OoxmlPackageError('XLSX worksheet identity changed');
  setAttribute(node, 'name', command.name);
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(workbook.xml, pkg.mainPart, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    oldName: sheet.name,
    name: command.name,
  };
}

function reorderSheets(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookSheetReorderCommand,
  output: PackageChanges
) {
  if (
    command.sheetIds.length !== state.sheets.length ||
    new Set(command.sheetIds).size !== state.sheets.length ||
    command.sheetIds.some(id => !state.sheets.some(sheet => sheet.id === id))
  ) {
    throw new OoxmlPackageError(
      'XLSX sheet order must contain every sheet exactly once'
    );
  }
  const workbook = workbookXml(pkg);
  const byId = new Map(
    workbook.entries.map(node => [attribute(node, 'sheetId'), node])
  );
  const ordered = command.sheetIds.map(id => byId.get(id));
  if (ordered.some(node => !node))
    throw new OoxmlPackageError('XLSX worksheet identity changed');
  children(workbook.sheets).splice(
    0,
    children(workbook.sheets).length,
    ...(ordered as OrderedXmlNode[])
  );
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(workbook.xml, pkg.mainPart, pkg.limits.maxXmlPartBytes)
  );
  return { operation: command.operation, sheetIds: command.sheetIds };
}

function relationshipBytes(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  sourcePart: string
) {
  const part = relationshipPartName(sourcePart);
  return {
    part,
    bytes: currentPart(pkg, output, part),
  };
}

function appendRelationship(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  sourcePart: string,
  relationship: { id: string; type: string; target: string }
) {
  const source = relationshipBytes(pkg, output, sourcePart);
  writePart(
    pkg,
    output,
    source.part,
    appendOoxmlRelationship(
      source.bytes,
      source.part,
      relationship,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function deleteRelationship(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  sourcePart: string,
  relationshipId: string
) {
  const source = relationshipBytes(pkg, output, sourcePart);
  if (!source.bytes) {
    throw new OoxmlPackageError(
      `XLSX relationship part is missing: ${source.part}`
    );
  }
  writePart(
    pkg,
    output,
    source.part,
    removeOoxmlRelationship(
      source.bytes,
      source.part,
      relationshipId,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function tableColumns(
  sheet: XlsxWorksheet,
  range: ReturnType<typeof normalizedRange>
) {
  const used = new Set<string>();
  const byAddress = new Map(sheet.cells.map(cell => [cell.address, cell]));
  return Array.from(
    { length: range.maxColumn - range.minColumn + 1 },
    (_, index) => {
      const address = `${columnIndexToName(range.minColumn + index)}${range.minRow}`;
      const raw = String(byAddress.get(address)?.value ?? '').trim();
      const base = raw || `Column${index + 1}`;
      let name = base;
      let suffix = 2;
      while (used.has(name.toLowerCase())) name = `${base}_${suffix++}`;
      used.add(name.toLowerCase());
      return name;
    }
  );
}

function buildTablePart(
  part: string,
  input: {
    id: string;
    name: string;
    displayName: string;
    ref: string;
    totalsRow: boolean;
    styleName?: string;
    columns: string[];
  },
  maxXmlPartBytes: number
) {
  const table = createElement(
    '',
    'table',
    [
      createElement('', 'autoFilter', [], { ref: input.ref }),
      createElement(
        '',
        'tableColumns',
        input.columns.map((name, index) =>
          createElement('', 'tableColumn', [], {
            id: String(index + 1),
            name,
          })
        ),
        { count: String(input.columns.length) }
      ),
      createElement('', 'tableStyleInfo', [], {
        name: input.styleName ?? 'TableStyleMedium2',
        showFirstColumn: '0',
        showLastColumn: '0',
        showRowStripes: '1',
        showColumnStripes: '0',
      }),
    ],
    {
      xmlns: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      id: input.id,
      name: input.name,
      displayName: input.displayName,
      ref: input.ref,
      headerRowCount: '1',
      totalsRowShown: input.totalsRow ? '1' : '0',
    }
  );
  return buildPreservedXml([table], part, maxXmlPartBytes);
}

function setTable(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookSetTableCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.target.sheetId);
  const range = normalizedRange(command.target.range);
  if (range.maxRow === range.minRow) {
    throw new OoxmlPackageError(
      'XLSX table range must contain a header row and at least one data row'
    );
  }
  const existing = sheet.tables.find(table => table.ref === range.ref);
  const worksheet = worksheetXml(pkg, sheet);
  const relationships = pkg.getRelationships(sheet.part);
  const existingRelationship = existing
    ? relationships.find(item => item.resolvedTarget === existing.part)
    : undefined;
  if (command.table === false) {
    if (!existing || !existingRelationship) {
      throw new OoxmlPackageError(`XLSX table not found: ${range.ref}`);
    }
    const tableParts = findChild(worksheet.root.content, 'tableParts');
    if (tableParts) {
      const entries = children(tableParts);
      const index = entries.findIndex(
        node => attribute(node, 'id') === existingRelationship.id
      );
      if (index !== -1) entries.splice(index, 1);
      if (entries.length) updateCount(tableParts);
      else removeChildren(worksheet.root.content, 'tableParts');
    }
    deleteRelationship(pkg, output, sheet.part, existingRelationship.id);
    removeContentType(pkg, output, existing.part);
    output.removals.add(existing.part);
    const relPart = relationshipPartName(existing.part);
    if (pkg.hasPart(relPart)) output.removals.add(relPart);
    writePart(
      pkg,
      output,
      sheet.part,
      buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
    );
    return {
      operation: command.operation,
      sheetId: sheet.id,
      range: range.ref,
      removed: true,
      tableId: existing.id,
    };
  }
  const table = command.table;
  const duplicate = state.sheets
    .flatMap(candidate => candidate.tables)
    .find(
      table =>
        table.part !== existing?.part &&
        [table.name, table.displayName].some(
          value =>
            value.toLowerCase() === table.name.toLowerCase() ||
            value.toLowerCase() ===
              (table.displayName ?? table.name).toLowerCase()
        )
    );
  if (duplicate) {
    throw new OoxmlPackageError(
      `XLSX table name already exists: ${command.table.name}`
    );
  }
  const overlap = sheet.tables.find(
    table =>
      table.part !== existing?.part &&
      rangesOverlap(range, normalizedRange(table.ref))
  );
  if (overlap) {
    throw new OoxmlPackageError(
      `XLSX table overlaps an existing table: ${overlap.ref}`
    );
  }
  const tableId =
    existing?.id ??
    String(
      Math.max(
        0,
        ...state.sheets.flatMap(candidate =>
          candidate.tables.map(table => Number(table.id) || 0)
        )
      ) + 1
    );
  const part =
    existing?.part ??
    nextOoxmlPartName(
      pkg.listParts().map(item => item.path),
      'xl/tables',
      'table',
      'xml'
    );
  let relationshipId = existingRelationship?.id;
  if (!relationshipId) {
    relationshipId = nextOoxmlRelationshipId(relationships);
    appendRelationship(pkg, output, sheet.part, {
      id: relationshipId,
      type: TABLE_RELATIONSHIP,
      target: relativeOoxmlTarget(sheet.part, part),
    });
    const tableParts = ensureContainer(
      worksheet.root.content,
      worksheet.root.prefix,
      'tableParts'
    );
    children(tableParts).push(
      createElement(worksheet.root.prefix, 'tablePart', [], {
        'r:id': relationshipId,
      })
    );
    updateCount(tableParts);
  }
  writePart(
    pkg,
    output,
    part,
    buildTablePart(
      part,
      {
        id: tableId,
        name: table.name,
        displayName: table.displayName ?? table.name,
        ref: range.ref,
        totalsRow: table.totalsRow ?? false,
        styleName: table.styleName,
        columns: tableColumns(sheet, range),
      },
      pkg.limits.maxXmlPartBytes
    )
  );
  writeContentType(pkg, output, {
    kind: 'override',
    partName: part,
    contentType: TABLE_CONTENT_TYPE,
  });
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    range: range.ref,
    removed: false,
    tableId,
    name: table.name,
  };
}

function marker(prefix: string, name: 'from' | 'to', address: string) {
  const cell = parseCellAddress(address);
  return createElement(prefix, name, [
    createElement(prefix, 'col', [{ '#text': String(cell.column - 1) }]),
    createElement(prefix, 'colOff', [{ '#text': '0' }]),
    createElement(prefix, 'row', [{ '#text': String(cell.row - 1) }]),
    createElement(prefix, 'rowOff', [{ '#text': '0' }]),
  ]);
}

function nextDrawingObjectId(xml: OrderedXmlNode[]) {
  const ids: number[] = [];
  const visit = (nodes: OrderedXmlNode[]) => {
    for (const node of nodes) {
      if (localName(elementKey(node) ?? '') === 'cNvPr') {
        ids.push(Number(attribute(node, 'id')) || 0);
      }
      visit(children(node));
    }
  };
  visit(xml);
  return String(Math.max(0, ...ids) + 1);
}

function buildChartPart(
  part: string,
  command: OfficeWorkbookAddChartCommand,
  maxXmlPartBytes: number
) {
  const series = command.series.map((item, index) =>
    createElement('c', 'ser', [
      createElement('c', 'idx', [], { val: String(index) }),
      createElement('c', 'order', [], { val: String(index) }),
      createElement('c', 'tx', [
        createElement('c', 'v', [{ '#text': item.name }]),
      ]),
      createElement('c', 'cat', [
        createElement('c', 'strRef', [
          createElement('c', 'f', [{ '#text': command.categoryRange }]),
        ]),
      ]),
      createElement('c', 'val', [
        createElement('c', 'numRef', [
          createElement('c', 'f', [{ '#text': item.valueRange }]),
        ]),
      ]),
    ])
  );
  const axisIds = ['130001', '130002'];
  const plot =
    command.chartType === 'pie'
      ? createElement('c', 'pieChart', [
          createElement('c', 'varyColors', [], { val: '1' }),
          ...series,
        ])
      : command.chartType === 'line'
        ? createElement('c', 'lineChart', [
            createElement('c', 'grouping', [], { val: 'standard' }),
            ...series,
            ...axisIds.map(id => createElement('c', 'axId', [], { val: id })),
          ])
        : createElement('c', 'barChart', [
            createElement('c', 'barDir', [], {
              val: command.chartType === 'bar' ? 'bar' : 'col',
            }),
            createElement('c', 'grouping', [], { val: 'clustered' }),
            ...series,
            ...axisIds.map(id => createElement('c', 'axId', [], { val: id })),
          ]);
  const title = command.title
    ? createElement('c', 'title', [
        createElement('c', 'tx', [
          createElement('c', 'rich', [
            createElement('a', 'bodyPr'),
            createElement('a', 'lstStyle'),
            createElement('a', 'p', [
              createElement('a', 'r', [
                createElement('a', 't', [{ '#text': command.title }]),
              ]),
            ]),
          ]),
        ]),
      ])
    : undefined;
  const axes =
    command.chartType === 'pie'
      ? []
      : [
          createElement('c', 'catAx', [
            createElement('c', 'axId', [], { val: axisIds[0] }),
            createElement('c', 'scaling', [
              createElement('c', 'orientation', [], { val: 'minMax' }),
            ]),
            createElement('c', 'axPos', [], { val: 'b' }),
            createElement('c', 'crossAx', [], { val: axisIds[1] }),
            createElement('c', 'crosses', [], { val: 'autoZero' }),
          ]),
          createElement('c', 'valAx', [
            createElement('c', 'axId', [], { val: axisIds[1] }),
            createElement('c', 'scaling', [
              createElement('c', 'orientation', [], { val: 'minMax' }),
            ]),
            createElement('c', 'axPos', [], { val: 'l' }),
            createElement('c', 'crossAx', [], { val: axisIds[0] }),
            createElement('c', 'crosses', [], { val: 'autoZero' }),
          ]),
        ];
  const root = createElement(
    'c',
    'chartSpace',
    [
      createElement('c', 'chart', [
        ...(title ? [title] : []),
        createElement('c', 'plotArea', [
          createElement('c', 'layout'),
          plot,
          ...axes,
        ]),
        createElement('c', 'plotVisOnly', [], { val: '1' }),
      ]),
    ],
    {
      'xmlns:c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
      'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'xmlns:r':
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    }
  );
  return buildPreservedXml([root], part, maxXmlPartBytes);
}

function containsRelationshipId(
  node: OrderedXmlNode,
  relationshipId: string
): boolean {
  if (
    Object.entries(attributes(node)).some(
      ([key, value]) => localName(key) === 'id' && value === relationshipId
    )
  ) {
    return true;
  }
  return children(node).some(child =>
    containsRelationshipId(child, relationshipId)
  );
}

function addChart(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookAddChartCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.sheetId);
  const worksheet = worksheetXml(pkg, sheet);
  const worksheetRelationships = pkg.getRelationships(sheet.part);
  let drawingRelationship = worksheetRelationships.find(
    item => relationshipTypeName(item.type) === 'drawing' && item.resolvedTarget
  );
  let drawingPart = drawingRelationship?.resolvedTarget;
  let drawingXml: OrderedXmlNode[];
  if (!drawingRelationship || !drawingPart) {
    drawingPart = nextOoxmlPartName(
      pkg.listParts().map(item => item.path),
      'xl/drawings',
      'drawing',
      'xml'
    );
    const relationshipId = nextOoxmlRelationshipId(worksheetRelationships);
    appendRelationship(pkg, output, sheet.part, {
      id: relationshipId,
      type: DRAWING_RELATIONSHIP,
      target: relativeOoxmlTarget(sheet.part, drawingPart),
    });
    worksheet.root.content.push(
      createElement(worksheet.root.prefix, 'drawing', [], {
        'r:id': relationshipId,
      })
    );
    drawingXml = [
      createElement('xdr', 'wsDr', [], {
        'xmlns:xdr':
          'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
        'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
        'xmlns:r':
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      }),
    ];
    writeContentType(pkg, output, {
      kind: 'override',
      partName: drawingPart,
      contentType: DRAWING_CONTENT_TYPE,
    });
  } else {
    drawingXml = parsePreservedXml(
      pkg.requirePart(drawingPart),
      drawingPart,
      pkg.limits.maxXmlPartBytes
    );
  }
  const drawing = rootContent(drawingXml, 'wsDr', drawingPart);
  const chartPart = nextOoxmlPartName(
    pkg.listParts().map(item => item.path),
    'xl/charts',
    'chart',
    'xml'
  );
  const chartRelationshipId = nextOoxmlRelationshipId(
    pkg.getRelationships(drawingPart)
  );
  appendRelationship(pkg, output, drawingPart, {
    id: chartRelationshipId,
    type: CHART_RELATIONSHIP,
    target: relativeOoxmlTarget(drawingPart, chartPart),
  });
  const objectId = nextDrawingObjectId(drawingXml);
  drawing.content.push(
    createElement('xdr', 'twoCellAnchor', [
      marker('xdr', 'from', command.anchor.fromCell),
      marker('xdr', 'to', command.anchor.toCell),
      createElement('xdr', 'graphicFrame', [
        createElement('xdr', 'nvGraphicFramePr', [
          createElement('xdr', 'cNvPr', [], {
            id: objectId,
            name: `Chart ${objectId}`,
          }),
          createElement('xdr', 'cNvGraphicFramePr'),
        ]),
        createElement('xdr', 'xfrm', [
          createElement('a', 'off', [], { x: '0', y: '0' }),
          createElement('a', 'ext', [], { cx: '0', cy: '0' }),
        ]),
        createElement('a', 'graphic', [
          createElement(
            'a',
            'graphicData',
            [
              createElement('c', 'chart', [], {
                'xmlns:c':
                  'http://schemas.openxmlformats.org/drawingml/2006/chart',
                'r:id': chartRelationshipId,
              }),
            ],
            {
              uri: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
            }
          ),
        ]),
      ]),
      createElement('xdr', 'clientData'),
    ])
  );
  writePart(
    pkg,
    output,
    drawingPart,
    buildPreservedXml(drawingXml, drawingPart, pkg.limits.maxXmlPartBytes)
  );
  writePart(
    pkg,
    output,
    chartPart,
    buildChartPart(chartPart, command, pkg.limits.maxXmlPartBytes)
  );
  writeContentType(pkg, output, {
    kind: 'override',
    partName: chartPart,
    contentType: CHART_CONTENT_TYPE,
  });
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    chartId: `${drawingPart}:${chartRelationshipId}`,
    chartType: command.chartType,
    series: command.series.length,
  };
}

function deleteChart(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookDeleteChartCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.sheetId);
  const chart = sheet.charts.find(item => item.id === command.chartId);
  if (!chart) {
    throw new OoxmlPackageError(`XLSX chart not found: ${command.chartId}`);
  }
  const relationshipId = chart.id.slice(chart.drawingPart.length + 1);
  const drawingXml = parsePreservedXml(
    pkg.requirePart(chart.drawingPart),
    chart.drawingPart,
    pkg.limits.maxXmlPartBytes
  );
  const drawing = rootContent(drawingXml, 'wsDr', chart.drawingPart);
  const index = drawing.content.findIndex(node =>
    containsRelationshipId(node, relationshipId)
  );
  if (index === -1) {
    throw new OoxmlPackageError('XLSX chart anchor is missing');
  }
  drawing.content.splice(index, 1);
  writePart(
    pkg,
    output,
    chart.drawingPart,
    buildPreservedXml(drawingXml, chart.drawingPart, pkg.limits.maxXmlPartBytes)
  );
  deleteRelationship(pkg, output, chart.drawingPart, relationshipId);
  removeContentType(pkg, output, chart.part);
  output.removals.add(chart.part);
  const relPart = relationshipPartName(chart.part);
  if (pkg.hasPart(relPart)) output.removals.add(relPart);
  return {
    operation: command.operation,
    sheetId: sheet.id,
    chartId: chart.id,
    chartType: chart.type,
  };
}

function shiftCoordinate(
  value: number,
  command: OfficeWorkbookDimensionChangeCommand
) {
  const start = command.index;
  const end = command.index + command.count - 1;
  if (command.action === 'insert')
    return value >= start ? value + command.count : value;
  if (value >= start && value <= end) return undefined;
  return value > end ? value - command.count : value;
}

function shiftAddress(
  address: string,
  command: OfficeWorkbookDimensionChangeCommand
) {
  const parsed = parseCellAddress(address);
  const row =
    command.axis === 'row' ? shiftCoordinate(parsed.row, command) : parsed.row;
  const column =
    command.axis === 'column'
      ? shiftCoordinate(parsed.column, command)
      : parsed.column;
  if (!row || !column || row > 1_048_576 || column > 16_384) return undefined;
  return `${columnIndexToName(column)}${row}`;
}

function shiftRange(
  range: string,
  command: OfficeWorkbookDimensionChangeCommand
) {
  const parts = range.split(':');
  if (parts.length !== 2) return shiftAddress(parts[0], command);
  const start = shiftAddress(parts[0], command);
  const end = shiftAddress(parts[1], command);
  return start && end ? normalizedRange(`${start}:${end}`).ref : undefined;
}

function replaceNodeText(node: OrderedXmlNode, value: string) {
  const nodeChildren = children(node);
  const text = nodeChildren.find(item => typeof item['#text'] === 'string');
  if (text) text['#text'] = value;
  else nodeChildren.push({ '#text': value });
}

function shiftFormula(
  formula: string,
  sheetName: string,
  command: OfficeWorkbookDimensionChangeCommand
) {
  return formula.replace(
    /((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]{0,6})/g,
    (
      match,
      qualifier: string | undefined,
      absoluteColumn: string,
      columnName: string,
      absoluteRow: string,
      rowText: string
    ) => {
      if (qualifier) {
        const qualified = qualifier
          .slice(0, -1)
          .replace(/^'|'$/g, '')
          .replaceAll("''", "'");
        if (qualified !== sheetName) return match;
      }
      const shifted = shiftAddress(`${columnName}${rowText}`, command);
      if (!shifted) return '#REF!';
      const parsed = parseCellAddress(shifted);
      return `${qualifier ?? ''}${absoluteColumn}${columnIndexToName(parsed.column)}${absoluteRow}${parsed.row}`;
    }
  );
}

function changeDimension(
  pkg: OoxmlOpcPackage,
  state: XlsxSemanticState,
  command: OfficeWorkbookDimensionChangeCommand,
  output: PackageChanges
) {
  const sheet = requireSheet(state, command.sheetId);
  if (command.axis === 'column' && command.index + command.count - 1 > 16_384) {
    throw new OoxmlPackageError(
      'XLSX column change exceeds the worksheet limit'
    );
  }
  if (command.axis === 'row' && command.index + command.count - 1 > 1_048_576) {
    throw new OoxmlPackageError('XLSX row change exceeds the worksheet limit');
  }
  const worksheet = worksheetXml(pkg, sheet);
  for (let rowIndex = worksheet.rows.length - 1; rowIndex >= 0; rowIndex--) {
    const row = worksheet.rows[rowIndex];
    if (localName(elementKey(row) ?? '') !== 'row') continue;
    const currentRow = Number(attribute(row, 'r'));
    const nextRow =
      command.axis === 'row'
        ? shiftCoordinate(currentRow, command)
        : currentRow;
    if (!nextRow) {
      worksheet.rows.splice(rowIndex, 1);
      continue;
    }
    setAttribute(row, 'r', String(nextRow));
    const rowChildren = children(row);
    for (let cellIndex = rowChildren.length - 1; cellIndex >= 0; cellIndex--) {
      const cell = rowChildren[cellIndex];
      if (localName(elementKey(cell) ?? '') !== 'c') continue;
      const reference = attribute(cell, 'r');
      const shifted = reference ? shiftAddress(reference, command) : undefined;
      if (!shifted) {
        rowChildren.splice(cellIndex, 1);
        continue;
      }
      setAttribute(cell, 'r', shifted);
      const formula = findChild(children(cell), 'f');
      if (formula) {
        const value = children(formula)
          .map(node => String(node['#text'] ?? ''))
          .join('');
        replaceNodeText(formula, shiftFormula(value, sheet.name, command));
      }
    }
  }
  worksheet.rows.sort((left, right) => rowNumber(left) - rowNumber(right));
  const merged = findChild(worksheet.root.content, 'mergeCells');
  if (merged) {
    const entries = children(merged);
    for (let index = entries.length - 1; index >= 0; index--) {
      const ref = attribute(entries[index], 'ref');
      const shifted = ref ? shiftRange(ref, command) : undefined;
      if (shifted) setAttribute(entries[index], 'ref', shifted);
      else entries.splice(index, 1);
    }
    if (entries.length) updateCount(merged);
    else removeChildren(worksheet.root.content, 'mergeCells');
  }
  for (const name of ['dimension', 'autoFilter']) {
    const node = findChild(worksheet.root.content, name);
    const ref = node ? attribute(node, 'ref') : undefined;
    const shifted = ref ? shiftRange(ref, command) : undefined;
    if (node && shifted) setAttribute(node, 'ref', shifted);
  }
  const validations = findChild(worksheet.root.content, 'dataValidations');
  if (validations) {
    for (const validation of children(validations)) {
      const ref = attribute(validation, 'sqref');
      const shifted = ref ? shiftRange(ref, command) : undefined;
      if (shifted) setAttribute(validation, 'sqref', shifted);
    }
  }
  writePart(
    pkg,
    output,
    sheet.part,
    buildPreservedXml(worksheet.xml, sheet.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    sheetId: sheet.id,
    axis: command.axis,
    action: command.action,
    index: command.index,
    count: command.count,
  };
}

export function applyXlsxStructuralCommand(
  pkg: OoxmlOpcPackage,
  command: XlsxStructuralCommand
) {
  const state = readXlsxSemanticState(pkg);
  const output = changes();
  const summary = (() => {
    switch (command.operation) {
      case 'office.workbook.range.format':
        return formatRange(pkg, state, command, output);
      case 'office.workbook.cells.merge.set':
        return mergeCells(pkg, state, command, output);
      case 'office.workbook.row.properties.set':
        return setRowProperties(pkg, state, command, output);
      case 'office.workbook.column.properties.set':
        return setColumnProperties(pkg, state, command, output);
      case 'office.workbook.filter.set':
        return setFilter(pkg, state, command, output);
      case 'office.workbook.validation.set':
        return setValidation(pkg, state, command, output);
      case 'office.workbook.sheet.add':
        return addSheet(pkg, state, command, output);
      case 'office.workbook.sheet.delete':
        return deleteSheet(pkg, state, command, output);
      case 'office.workbook.sheet.rename':
        return renameSheet(pkg, state, command, output);
      case 'office.workbook.sheets.reorder':
        return reorderSheets(pkg, state, command, output);
      case 'office.workbook.dimension.change':
        return changeDimension(pkg, state, command, output);
      case 'office.workbook.table.set':
        return setTable(pkg, state, command, output);
      case 'office.workbook.chart.add':
        return addChart(pkg, state, command, output);
      case 'office.workbook.chart.delete':
        return deleteChart(pkg, state, command, output);
    }
  })();
  const packageBytes = pkg.write(output.replacements, {
    additions: output.additions,
    removals: output.removals,
  });
  const next = readXlsxSemanticState(openXlsxPackage(packageBytes, pkg.limits));
  return { packageBytes, state: next, summary };
}
