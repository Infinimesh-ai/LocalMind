import { parseOfficeCommandBatch } from '@localmind/office';
import { createMinimalXlsxFixture } from '@localmind/office/testing';
import { openXlsxPackage, readXlsxSemanticState } from '@localmind/office/xlsx';
import { describe, expect, test } from 'vitest';

import {
  copySpreadsheetValues,
  parseSpreadsheetInput,
  parseSpreadsheetTsv,
  spreadsheetPasteBatch,
} from './spreadsheet-clipboard';

const sheet = () =>
  readXlsxSemanticState(openXlsxPackage(createMinimalXlsxFixture())).sheets[0];
const base = {
  artifactId: 'artifact-1',
  revisionId: 'revision-1',
  id: 'paste-1',
};

describe('spreadsheet clipboard', () => {
  test('parses rectangular TSV, CRLF, quoted tabs/newlines and escaped quotes', () => {
    expect(
      parseSpreadsheetTsv('名称\t值\r\n"海\t棠"\t"第一行\n""第二行"""\r\n')
    ).toEqual([
      ['名称', '值'],
      ['海\t棠', '第一行\n"第二行"'],
    ]);
    expect(parseSpreadsheetTsv('A\t\nB\t')).toEqual([
      ['A', ''],
      ['B', ''],
    ]);
    expect(parseSpreadsheetTsv('')).toEqual([['']]);
  });
  test('rejects ragged or broken quoted input before creating commands', () => {
    for (const text of ['a\tb\nc', '"unclosed', '"closed"extra\tb'])
      expect(() => parseSpreadsheetTsv(text)).toThrow('shape');
  });
  test('enforces cell and UTF-8 byte bounds', () => {
    expect(
      parseSpreadsheetTsv(Array.from({ length: 64 }, () => '1').join('\t'))[0]
    ).toHaveLength(64);
    expect(() =>
      parseSpreadsheetTsv(Array.from({ length: 65 }, () => '1').join('\t'))
    ).toThrow('limit');
    expect(() => parseSpreadsheetTsv('😀'.repeat(65537))).toThrow('limit');
  });
  test('keeps typed values, formula intent, leading zeroes and explicit literal strings', () => {
    expect(
      [
        '',
        '10',
        '-2.5',
        'TRUE',
        'false',
        '=SUM(A1:A2)',
        "'=A1",
        '00123',
        "'TRUE",
      ].map(parseSpreadsheetInput)
    ).toEqual([
      { type: 'blank' },
      { type: 'number', value: 10 },
      { type: 'number', value: -2.5 },
      { type: 'boolean', value: true },
      { type: 'boolean', value: false },
      { type: 'formula', formula: 'SUM(A1:A2)' },
      { type: 'string', value: '=A1' },
      { type: 'string', value: '00123' },
      { type: 'string', value: 'TRUE' },
    ]);
  });
  test('creates one version-bound user batch while preserving target style', () => {
    const target = sheet();
    target.cells.find(cell => cell.address === 'B2')!.styleIndex = 3;
    const result = spreadsheetPasteBatch({
      ...base,
      sheet: target,
      address: 'B2',
      text: '15\ttrue\n25\t=SUM(B2:B3)',
    });
    expect(result.range).toBe('B2:C3');
    expect(parseOfficeCommandBatch(result.batch)).toEqual(result.batch);
    expect(
      result.batch.commands.map(command =>
        command.operation === 'office.workbook.cell.set'
          ? command.target.address
          : null
      )
    ).toEqual(['B2', 'C2', 'B3', 'C3']);
    expect(result.batch.commands[0]).toMatchObject({
      styleIndex: 3,
      source: 'user',
      expectedRevisionId: 'revision-1',
    });
    expect(
      new Set(result.batch.commands.map(command => command.idempotencyKey)).size
    ).toBe(4);
  });
  test('rejects range overflow and any merged destination without mutating the sheet', () => {
    const target = sheet();
    const before = structuredClone(target);
    for (const address of ['XFD1', 'A1048576'])
      expect(() =>
        spreadsheetPasteBatch({
          ...base,
          sheet: target,
          address,
          text: 'a\tb\nc\td',
        })
      ).toThrow();
    expect(target).toEqual(before);
    target.mergedCells = ['B2:C2'];
    expect(() =>
      spreadsheetPasteBatch({
        ...base,
        sheet: target,
        address: 'A2',
        text: 'a\tb',
      })
    ).toThrow('merged');
  });
  test('copies values only, round-tripping strings, blank cells and formula results', () => {
    const target = sheet();
    target.mergedCells = [];
    target.cells = [
      {
        address: 'A1',
        row: 1,
        column: 1,
        type: 'string',
        value: '海棠\t"测试"\n第二行',
      },
      { address: 'B1', row: 1, column: 2, type: 'string', value: '=literal' },
      {
        address: 'A2',
        row: 2,
        column: 1,
        type: 'number',
        value: 1,
        formula: '1+2',
        calculatedValue: 3,
      },
    ];
    const pasted = spreadsheetPasteBatch({
      ...base,
      sheet: target,
      address: 'D4',
      text: copySpreadsheetValues(target, 'A1:B2'),
    });
    expect(
      pasted.batch.commands.map(command =>
        command.operation === 'office.workbook.cell.set' ? command.input : null
      )
    ).toEqual([
      { type: 'string', value: '海棠\t"测试"\n第二行' },
      { type: 'string', value: '=literal' },
      { type: 'number', value: 3 },
      { type: 'blank' },
    ]);
  });
  test('rejects oversized, reversed and merged copy ranges', () => {
    const target = sheet();
    expect(() => copySpreadsheetValues(target, 'A1:Z10')).toThrow('limit');
    expect(() => copySpreadsheetValues(target, 'B2:A1')).toThrow('invalid');
    target.mergedCells = ['A1:B1'];
    expect(() => copySpreadsheetValues(target, 'A1:B2')).toThrow('merged');
  });
});
