import { OoxmlPackageError } from '../ooxml';
import { expandCellRange, parseCellAddress } from './address';

export type XlsxFormulaAst =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'cell'; address: string; sheet?: string }
  | {
      type: 'range';
      start: string;
      end: string;
      sheet?: string;
    }
  | { type: 'unary'; operator: '+' | '-'; operand: XlsxFormulaAst }
  | {
      type: 'binary';
      operator:
        | '+'
        | '-'
        | '*'
        | '/'
        | '^'
        | '&'
        | '='
        | '<>'
        | '<'
        | '<='
        | '>'
        | '>=';
      left: XlsxFormulaAst;
      right: XlsxFormulaAst;
    }
  | { type: 'function'; name: string; arguments: XlsxFormulaAst[] };

type Token =
  | { type: 'number'; value: string }
  | { type: 'string'; value: string }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'punctuation'; value: '(' | ')' | ',' | ':' | '!' }
  | { type: 'eof'; value: '' };

function tokenize(formula: string) {
  const input = formula.startsWith('=') ? formula.slice(1) : formula;
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const character = input[index];
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (character === '"') {
      let value = '';
      index++;
      let closed = false;
      while (index < input.length) {
        if (input[index] === '"') {
          if (input[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          closed = true;
          index++;
          break;
        }
        value += input[index++];
      }
      if (!closed)
        throw new OoxmlPackageError('XLSX formula string is not closed');
      tokens.push({ type: 'string', value });
      continue;
    }
    if (character === "'") {
      let value = '';
      index++;
      let closed = false;
      while (index < input.length) {
        if (input[index] === "'") {
          if (input[index + 1] === "'") {
            value += "'";
            index += 2;
            continue;
          }
          closed = true;
          index++;
          break;
        }
        value += input[index++];
      }
      if (!closed)
        throw new OoxmlPackageError('XLSX formula sheet name is not closed');
      tokens.push({ type: 'identifier', value });
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/.exec(
      input.slice(index)
    );
    if (number) {
      tokens.push({ type: 'number', value: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Z_$][A-Z0-9_.$]*/i.exec(input.slice(index));
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const twoCharacter = input.slice(index, index + 2);
    if (['<=', '>=', '<>'].includes(twoCharacter)) {
      tokens.push({ type: 'operator', value: twoCharacter });
      index += 2;
      continue;
    }
    if ('+-*/^&=<>'.includes(character)) {
      tokens.push({ type: 'operator', value: character });
      index++;
      continue;
    }
    if ('(),:!'.includes(character)) {
      tokens.push({
        type: 'punctuation',
        value: character as '(' | ')' | ',' | ':' | '!',
      });
      index++;
      continue;
    }
    throw new OoxmlPackageError(
      `XLSX formula contains unsupported syntax: ${character}`
    );
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '<=': 1,
  '>': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse() {
    const expression = this.expression(0);
    if (this.peek().type !== 'eof') {
      throw new OoxmlPackageError('XLSX formula has trailing syntax');
    }
    return expression;
  }

  private expression(minPrecedence: number): XlsxFormulaAst {
    let left = this.prefix();
    while (this.peek().type === 'operator') {
      const token = this.peek();
      const precedence = PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      this.index++;
      const right = this.expression(precedence + (token.value === '^' ? 0 : 1));
      left = {
        type: 'binary',
        operator: token.value as Extract<
          XlsxFormulaAst,
          { type: 'binary' }
        >['operator'],
        left,
        right,
      };
    }
    return left;
  }

  private prefix(): XlsxFormulaAst {
    const token = this.take();
    if (
      token.type === 'operator' &&
      (token.value === '+' || token.value === '-')
    ) {
      return {
        type: 'unary',
        operator: token.value,
        operand: this.expression(6),
      };
    }
    if (token.type === 'number')
      return { type: 'number', value: Number(token.value) };
    if (token.type === 'string') return { type: 'string', value: token.value };
    if (token.type === 'punctuation' && token.value === '(') {
      const value = this.expression(0);
      this.expect('punctuation', ')');
      return value;
    }
    if (token.type !== 'identifier') {
      throw new OoxmlPackageError('XLSX formula expression is incomplete');
    }
    if (/^(TRUE|FALSE)$/i.test(token.value)) {
      return { type: 'boolean', value: token.value.toUpperCase() === 'TRUE' };
    }
    if (this.peek().type === 'punctuation' && this.peek().value === '(') {
      this.index++;
      const args: XlsxFormulaAst[] = [];
      if (!(this.peek().type === 'punctuation' && this.peek().value === ')')) {
        while (true) {
          args.push(this.expression(0));
          if (
            !(this.peek().type === 'punctuation' && this.peek().value === ',')
          )
            break;
          this.index++;
        }
      }
      this.expect('punctuation', ')');
      return {
        type: 'function',
        name: token.value.toUpperCase(),
        arguments: args,
      };
    }
    let sheet: string | undefined;
    let addressToken = token.value;
    if (this.peek().type === 'punctuation' && this.peek().value === '!') {
      this.index++;
      sheet = token.value;
      const address = this.take();
      if (address.type !== 'identifier') {
        throw new OoxmlPackageError('XLSX formula sheet reference has no cell');
      }
      addressToken = address.value;
    }
    const address = parseCellAddress(addressToken).address;
    if (this.peek().type === 'punctuation' && this.peek().value === ':') {
      this.index++;
      const end = this.take();
      if (end.type !== 'identifier') {
        throw new OoxmlPackageError('XLSX formula range is incomplete');
      }
      return {
        type: 'range',
        sheet,
        start: address,
        end: parseCellAddress(end.value).address,
      };
    }
    return { type: 'cell', sheet, address };
  }

  private peek() {
    return this.tokens[this.index];
  }

  private take() {
    return this.tokens[this.index++];
  }

  private expect(type: Token['type'], value: string) {
    const token = this.take();
    if (token.type !== type || token.value !== value) {
      throw new OoxmlPackageError(`XLSX formula expected ${value}`);
    }
  }
}

export function parseXlsxFormula(formula: string) {
  if (!formula.trim() || formula.length > 32_768) {
    throw new OoxmlPackageError('XLSX formula is empty or too long');
  }
  return new FormulaParser(tokenize(formula)).parse();
}

export type XlsxFormulaValue = string | number | boolean | null;

export type XlsxFormulaContext = {
  sheet: string;
  resolveCell: (sheet: string, address: string) => XlsxFormulaValue;
};

function scalar(value: XlsxFormulaValue | XlsxFormulaValue[]) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function numeric(value: XlsxFormulaValue) {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number))
    throw new OoxmlPackageError('XLSX formula expected a number');
  return number;
}

function truthy(value: XlsxFormulaValue) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null || value === '') return false;
  return !['FALSE', '0'].includes(String(value).toUpperCase());
}

function isFormulaError(value: XlsxFormulaValue) {
  return typeof value === 'string' && /^#[A-Z0-9/?!]+$/i.test(value);
}

function matchesCriteria(value: XlsxFormulaValue, criteria: XlsxFormulaValue) {
  if (typeof criteria !== 'string') return value === criteria;
  const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criteria);
  const operator = match?.[1] ?? '=';
  const expectedText = match?.[2] ?? criteria;
  const expectedNumber = Number(expectedText);
  const numericComparison = Number.isFinite(expectedNumber);
  const left = numericComparison ? numeric(value) : String(value ?? '');
  const right = numericComparison ? expectedNumber : expectedText;
  if (!numericComparison && operator === '=' && /[*?]/.test(expectedText)) {
    const escaped = expectedText
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replaceAll('*', '.*')
      .replaceAll('?', '.');
    return new RegExp(`^${escaped}$`, 'i').test(String(value ?? ''));
  }
  switch (operator) {
    case '=':
      return left === right;
    case '<>':
      return left !== right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
  return false;
}

export function evaluateXlsxFormula(
  ast: XlsxFormulaAst,
  context: XlsxFormulaContext
): XlsxFormulaValue | XlsxFormulaValue[] {
  switch (ast.type) {
    case 'number':
    case 'string':
    case 'boolean':
      return ast.value;
    case 'cell':
      return context.resolveCell(ast.sheet ?? context.sheet, ast.address);
    case 'range':
      return expandCellRange(ast.start, ast.end).map(address =>
        context.resolveCell(ast.sheet ?? context.sheet, address)
      );
    case 'unary': {
      const value = numeric(scalar(evaluateXlsxFormula(ast.operand, context)));
      return ast.operator === '-' ? -value : value;
    }
    case 'binary': {
      const left = scalar(evaluateXlsxFormula(ast.left, context));
      const right = scalar(evaluateXlsxFormula(ast.right, context));
      switch (ast.operator) {
        case '+':
          return numeric(left) + numeric(right);
        case '-':
          return numeric(left) - numeric(right);
        case '*':
          return numeric(left) * numeric(right);
        case '/':
          return numeric(right) === 0
            ? '#DIV/0!'
            : numeric(left) / numeric(right);
        case '^':
          return numeric(left) ** numeric(right);
        case '&':
          return `${left ?? ''}${right ?? ''}`;
        case '=':
          return left === right;
        case '<>':
          return left !== right;
        case '<':
          return numeric(left) < numeric(right);
        case '<=':
          return numeric(left) <= numeric(right);
        case '>':
          return numeric(left) > numeric(right);
        case '>=':
          return numeric(left) >= numeric(right);
      }
      throw new OoxmlPackageError('XLSX formula operator is unsupported');
    }
    case 'function': {
      if (ast.name === 'IFERROR') {
        try {
          const value = scalar(evaluateXlsxFormula(ast.arguments[0], context));
          return isFormulaError(value)
            ? scalar(evaluateXlsxFormula(ast.arguments[1], context))
            : value;
        } catch {
          return scalar(evaluateXlsxFormula(ast.arguments[1], context));
        }
      }
      const evaluated = ast.arguments.map(argument =>
        evaluateXlsxFormula(argument, context)
      );
      const values = evaluated.flatMap(value =>
        Array.isArray(value) ? value : [value]
      );
      const numbers = values.flatMap(value => {
        if (typeof value === 'number') return [value];
        if (typeof value === 'boolean') return [value ? 1 : 0];
        if (value === null || value === '') return [];
        const parsed = Number(value);
        return Number.isFinite(parsed) ? [parsed] : [];
      });
      switch (ast.name) {
        case 'SUM':
          return numbers.reduce((total, value) => total + value, 0);
        case 'AVERAGE':
          return numbers.length
            ? numbers.reduce((total, value) => total + value, 0) /
                numbers.length
            : '#DIV/0!';
        case 'MIN':
          return numbers.length ? Math.min(...numbers) : 0;
        case 'MAX':
          return numbers.length ? Math.max(...numbers) : 0;
        case 'COUNT':
          return numbers.length;
        case 'COUNTA':
          return values.filter(value => value !== null && value !== '').length;
        case 'IF':
          return truthy(values[0] ?? null)
            ? (values[1] ?? true)
            : (values[2] ?? false);
        case 'AND':
          return values.every(truthy);
        case 'OR':
          return values.some(truthy);
        case 'NOT':
          return !truthy(values[0] ?? null);
        case 'ABS':
          return Math.abs(numeric(values[0] ?? null));
        case 'ROUND': {
          const digits = Math.trunc(numeric(values[1] ?? 0));
          const factor = 10 ** digits;
          return Math.round(numeric(values[0] ?? null) * factor) / factor;
        }
        case 'COUNTIF': {
          const range = Array.isArray(evaluated[0])
            ? evaluated[0]
            : [scalar(evaluated[0])];
          const criteria = scalar(evaluated[1]);
          return range.filter(value => matchesCriteria(value, criteria)).length;
        }
        case 'SUMIF': {
          const range = Array.isArray(evaluated[0])
            ? evaluated[0]
            : [scalar(evaluated[0])];
          const criteria = scalar(evaluated[1]);
          const sumRange = evaluated[2]
            ? Array.isArray(evaluated[2])
              ? evaluated[2]
              : [scalar(evaluated[2])]
            : range;
          return range.reduce<number>(
            (total, value, index) =>
              matchesCriteria(value, criteria)
                ? total + numeric(sumRange[index] ?? null)
                : total,
            0
          );
        }
        default:
          throw new OoxmlPackageError(
            `XLSX formula function is unsupported: ${ast.name}`
          );
      }
    }
  }
}
