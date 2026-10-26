import { expandCellRange, parseCellAddress } from './address';
import { parseXlsxFormula } from './formula';
import type {
  XlsxCellValue,
  XlsxSemanticState,
  XlsxWorksheet,
} from './semantic';

export function xlsxValueText(value: XlsxCellValue | undefined) {
  if (value === null || value === undefined) return '';
  return typeof value === 'boolean'
    ? value
      ? 'TRUE'
      : 'FALSE'
    : String(value);
}

export function xlsxRangeContains(range: string, address: string) {
  const cell = parseCellAddress(address);
  return range
    .trim()
    .split(/\s+/)
    .some(part => {
      const [first, last = first] = part.split(':');
      const start = parseCellAddress(first);
      const end = parseCellAddress(last);
      return (
        cell.row >= start.row &&
        cell.row <= end.row &&
        cell.column >= start.column &&
        cell.column <= end.column
      );
    });
}

function listValues(
  state: XlsxSemanticState,
  sheet: XlsxWorksheet,
  formula: string,
  depth = 0
): string[] | undefined {
  if (depth > 8) return;
  const source = formula.replace(/^=/, '').trim();
  if (source.startsWith('"') && source.endsWith('"')) {
    return source.slice(1, -1).replaceAll('""', '"').split(',');
  }
  const defined = state.definedNames.find(
    item =>
      item.name === source &&
      (item.localSheetId === undefined ||
        item.localSheetId === state.sheets.indexOf(sheet))
  );
  if (defined) return listValues(state, sheet, defined.formula, depth + 1);
  const ast = parseXlsxFormula(source);
  if (ast.type !== 'cell' && ast.type !== 'range') return;
  const target = ast.sheet
    ? state.sheets.find(item => item.name === ast.sheet)
    : sheet;
  if (!target) return;
  const addresses =
    ast.type === 'cell'
      ? [ast.address]
      : expandCellRange(ast.start, ast.end, 10_000);
  const cells = new Map(target.cells.map(cell => [cell.address, cell]));
  return addresses.map(address => {
    const cell = cells.get(address);
    return xlsxValueText(cell?.formula ? cell.calculatedValue : cell?.value);
  });
}

/** Validate edits using the same persisted rules for UI and command execution. */
export function validateXlsxCellValue(
  state: XlsxSemanticState,
  sheet: XlsxWorksheet,
  address: string,
  value: XlsxCellValue
): 'invalid' | 'unsupported' | null {
  for (const rule of sheet.dataValidations) {
    try {
      if (
        !xlsxRangeContains(rule.range, address) ||
        !rule.type ||
        rule.type === 'none'
      )
        continue;
      if (value === null || value === '') {
        if (rule.allowBlank) continue;
        return 'invalid';
      }
      if (rule.type === 'list') {
        const allowed = listValues(state, sheet, rule.formula1 ?? '');
        if (!allowed) return 'unsupported';
        if (
          !allowed.some(
            item => item.toLowerCase() === xlsxValueText(value).toLowerCase()
          )
        )
          return 'invalid';
        continue;
      }
      if (!['whole', 'decimal', 'textLength'].includes(rule.type))
        return 'unsupported';
      const first = rule.formula1?.trim();
      const second = rule.formula2?.trim();
      if (!first || !Number.isFinite(Number(first))) return 'unsupported';
      const number =
        rule.type === 'textLength'
          ? xlsxValueText(value).length
          : typeof value === 'number'
            ? value
            : NaN;
      if (
        !Number.isFinite(number) ||
        (rule.type === 'whole' && !Number.isInteger(number))
      )
        return 'invalid';
      const a = Number(first);
      const operator = rule.operator ?? 'between';
      if (
        ['between', 'notBetween'].includes(operator) &&
        (!second || !Number.isFinite(Number(second)))
      )
        return 'unsupported';
      const b = Number(second);
      let valid: boolean;
      switch (operator) {
        case 'between':
          valid = number >= a && number <= b;
          break;
        case 'notBetween':
          valid = number < a || number > b;
          break;
        case 'equal':
          valid = number === a;
          break;
        case 'notEqual':
          valid = number !== a;
          break;
        case 'lessThan':
          valid = number < a;
          break;
        case 'lessThanOrEqual':
          valid = number <= a;
          break;
        case 'greaterThan':
          valid = number > a;
          break;
        case 'greaterThanOrEqual':
          valid = number >= a;
          break;
        default:
          return 'unsupported';
      }
      if (!valid) return 'invalid';
    } catch {
      return 'unsupported';
    }
  }
  return null;
}
