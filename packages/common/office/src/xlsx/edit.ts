import {
  type OfficeCommand,
  type OfficeWorkbookSetCellCommand,
  parseOfficeCommand,
} from '../command';
import {
  buildPreservedXml,
  type OrderedXmlNode,
  parsePreservedXml,
} from '../docx/xml';
import { type OoxmlOpcPackage, OoxmlPackageError } from '../ooxml';
import { compareCellAddresses, parseCellAddress } from './address';
import { evaluateXlsxFormula, parseXlsxFormula } from './formula';
import { openXlsxPackage } from './package';
import { readXlsxSemanticState, type XlsxSemanticState } from './semantic';
import {
  applyXlsxStructuralCommand,
  type XlsxStructuralCommand,
} from './structural-edit';

export type XlsxCommandResult = {
  packageBytes: Uint8Array;
  state: XlsxSemanticState;
  summary: Record<string, unknown> & { operation: string };
};

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

function createElement(
  prefix: string,
  name: string,
  children: OrderedXmlNode[] = [],
  attrs?: Record<string, string>
): OrderedXmlNode {
  return {
    [qualify(prefix, name)]: children,
    ...(attrs && Object.keys(attrs).length ? { ':@': attrs } : {}),
  };
}

function children(node: OrderedXmlNode) {
  const key = elementKey(node);
  const value = key ? node[key] : undefined;
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

function findChild(nodes: OrderedXmlNode[], name: string) {
  return nodes.find(node => {
    const key = elementKey(node);
    return key ? localName(key) === name : false;
  });
}

function requireWorksheet(nodes: OrderedXmlNode[]) {
  const worksheet = findChild(nodes, 'worksheet');
  const key = worksheet ? elementKey(worksheet) : undefined;
  const content = key ? worksheet?.[key] : undefined;
  if (!worksheet || !key || !Array.isArray(content)) {
    throw new OoxmlPackageError('XLSX worksheet has no editable root');
  }
  const sheetData = findChild(content as OrderedXmlNode[], 'sheetData');
  const sheetDataKey = sheetData ? elementKey(sheetData) : undefined;
  const rows = sheetDataKey ? sheetData?.[sheetDataKey] : undefined;
  if (!sheetData || !sheetDataKey || !Array.isArray(rows)) {
    throw new OoxmlPackageError('XLSX worksheet has no editable sheetData');
  }
  return {
    prefix: prefixOf(key),
    rows: rows as OrderedXmlNode[],
  };
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
  const insertion = rowChildren.findIndex(node => {
    const key = elementKey(node);
    const reference =
      key && localName(key) === 'c' ? attribute(node, 'r') : undefined;
    return reference ? compareCellAddresses(reference, address) > 0 : false;
  });
  rowChildren.splice(
    insertion === -1 ? rowChildren.length : insertion,
    0,
    created
  );
  return created;
}

function textElement(prefix: string, name: string, text: string) {
  return createElement(prefix, name, [{ '#text': text }]);
}

function updateCell(
  cell: OrderedXmlNode,
  prefix: string,
  command: OfficeWorkbookSetCellCommand
) {
  const content = children(cell);
  for (let index = content.length - 1; index >= 0; index--) {
    const key = elementKey(content[index]);
    if (key && ['f', 'v', 'is'].includes(localName(key)))
      content.splice(index, 1);
  }
  if (command.styleIndex !== undefined) {
    setAttribute(cell, 's', String(command.styleIndex));
  }
  switch (command.input.type) {
    case 'blank':
      setAttribute(cell, 't');
      break;
    case 'string':
      setAttribute(cell, 't', 'inlineStr');
      content.push(
        createElement(prefix, 'is', [
          textElement(prefix, 't', command.input.value),
        ])
      );
      break;
    case 'number':
      setAttribute(cell, 't', 'n');
      content.push(textElement(prefix, 'v', String(command.input.value)));
      break;
    case 'boolean':
      setAttribute(cell, 't', 'b');
      content.push(textElement(prefix, 'v', command.input.value ? '1' : '0'));
      break;
    case 'formula': {
      const formula = command.input.formula.replace(/^=/, '');
      const ast = parseXlsxFormula(formula);
      evaluateXlsxFormula(ast, {
        sheet: '',
        resolveCell: () => null,
      });
      setAttribute(cell, 't');
      content.push(textElement(prefix, 'f', formula));
      break;
    }
  }
}

function verifyResult(
  state: XlsxSemanticState,
  command: OfficeWorkbookSetCellCommand,
  normalizedAddress: string
) {
  const sheet = state.sheets.find(
    candidate => candidate.id === command.target.sheetId
  );
  const cell = sheet?.cells.find(
    candidate => candidate.address === normalizedAddress
  );
  if (!sheet || !cell)
    throw new OoxmlPackageError(
      'XLSX command output is missing its target cell'
    );
  if (
    command.styleIndex !== undefined &&
    cell.styleIndex !== command.styleIndex
  ) {
    throw new OoxmlPackageError(
      'XLSX command output did not preserve the requested style'
    );
  }
  switch (command.input.type) {
    case 'blank':
      if (cell.value !== null || cell.formula)
        throw new OoxmlPackageError('XLSX command output is not blank');
      break;
    case 'formula':
      if (cell.formula !== command.input.formula.replace(/^=/, '')) {
        throw new OoxmlPackageError(
          'XLSX command output formula does not match'
        );
      }
      break;
    default:
      if (cell.value !== command.input.value) {
        throw new OoxmlPackageError('XLSX command output value does not match');
      }
  }
}

export function applyXlsxCommand(
  pkg: OoxmlOpcPackage,
  input: OfficeCommand | unknown
): XlsxCommandResult {
  const command = parseOfficeCommand(input);
  if (command.operation !== 'office.workbook.cell.set') {
    if (command.operation.startsWith('office.workbook.')) {
      return applyXlsxStructuralCommand(pkg, command as XlsxStructuralCommand);
    }
    throw new OoxmlPackageError(
      `Expected an XLSX command, received ${command.operation}`
    );
  }
  const state = readXlsxSemanticState(pkg);
  const sheet = state.sheets.find(
    candidate => candidate.id === command.target.sheetId
  );
  if (!sheet)
    throw new OoxmlPackageError(
      `XLSX sheet not found: ${command.target.sheetId}`
    );
  if (
    command.styleIndex !== undefined &&
    command.styleIndex >= state.styles.cells.length
  ) {
    throw new OoxmlPackageError(
      `XLSX style index is out of range: ${command.styleIndex}`
    );
  }
  const address = parseCellAddress(command.target.address);
  const xml = parsePreservedXml(
    pkg.requirePart(sheet.part),
    sheet.part,
    pkg.limits.maxXmlPartBytes
  );
  const worksheet = requireWorksheet(xml);
  const row = ensureRow(worksheet.rows, address.row, worksheet.prefix);
  const cell = ensureCell(row, address.address, worksheet.prefix);
  updateCell(cell, worksheet.prefix, command);
  const worksheetBytes = buildPreservedXml(
    xml,
    sheet.part,
    pkg.limits.maxXmlPartBytes
  );
  const packageBytes = pkg.write(new Map([[sheet.part, worksheetBytes]]));
  const outputPackage = openXlsxPackage(packageBytes, pkg.limits);
  const outputState = readXlsxSemanticState(outputPackage);
  verifyResult(outputState, command, address.address);
  return {
    packageBytes,
    state: outputState,
    summary: {
      operation: command.operation,
      sheetId: command.target.sheetId,
      address: address.address,
      valueType: command.input.type,
      formulaLength:
        command.input.type === 'formula'
          ? command.input.formula.length
          : undefined,
      stringLength:
        command.input.type === 'string'
          ? command.input.value.length
          : undefined,
      styleChanged: command.styleIndex !== undefined,
    },
  };
}
