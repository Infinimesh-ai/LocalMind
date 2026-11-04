import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editDocumentFile } from '../../core/doc/document-file';
import { documentFileCommand } from '../../core/doc/document-file-schema';

const edit = (text: string, mime: string, commands: unknown[]) =>
  editDocumentFile(
    text,
    mime,
    commands.map(command => documentFileCommand.parse(command))
  );

void test('JSON token editing retains BOM, CRLF, whitespace and unedited large numeric literals', () => {
  const source =
    '\uFEFF{\r\n  "big": 900719925474099312345,\r\n  "message" : "old", "list": [1e+20, 2]\r\n}\r\n';
  const updated = edit(source, 'application/json', [
    {
      opId: 'set',
      type: 'file.json.set',
      path: ['message'],
      valueJson: '"new"',
    },
  ]);
  assert.equal(updated, source.replace('"old"', '"new"'));
  assert.equal(
    edit(updated, 'application/json', [
      {
        opId: 'noop',
        type: 'file.json.set',
        path: ['message'],
        valueJson: '"new"',
      },
    ]),
    updated
  );
  const inserted = edit(updated, 'application/json', [
    {
      opId: 'insert',
      type: 'file.json.array.insert',
      path: ['list'],
      index: 1,
      valuesJson: ['900719925474099312346'],
    },
  ]);
  assert.equal(
    inserted,
    updated.replace('[1e+20, 2]', '[1e+20, 900719925474099312346,2]')
  );
  const added = edit(inserted, 'application/json', [
    { opId: 'add', type: 'file.json.set', path: ['new'], valueJson: '1e+200' },
  ]);
  assert.ok(added.includes('900719925474099312345'));
  assert.ok(added.includes('1e+200'));
});

void test('JSON edits reject ambiguous keys, missing parents and mismatched MIME without touching source', () => {
  for (const text of ['{"x":1,"x":2}', '{}'])
    assert.throws(() =>
      edit(text, 'application/json', [
        {
          opId: 'set',
          type: 'file.json.set',
          path: ['missing', 'key'],
          valueJson: '3',
        },
      ])
    );
  assert.throws(() =>
    edit('{}', 'text/plain', [
      { opId: 'set', type: 'file.json.set', path: [], valueJson: 'null' },
    ])
  );
  assert.throws(() =>
    edit('[]', 'application/json', [
      {
        opId: 'set',
        type: 'file.json.array.insert',
        path: [],
        index: 2,
        valuesJson: ['null'],
      },
    ])
  );
});

void test('CSV cells preserve unrelated quoting, embedded CRLF, BOM and blank rows', () => {
  const source = '\uFEFF"head",B\r\n"multiline\r\nvalue","quoted"\r\n,\r\n';
  const changed = edit(source, 'text/csv', [
    {
      opId: 'cell',
      type: 'file.csv.cell.set',
      row: 1,
      column: 1,
      value: 'new,value',
    },
  ]);
  assert.equal(changed, source.replace('"quoted"', '"new,value"'));
  assert.equal(
    edit(source, 'text/csv', [
      {
        opId: 'noop',
        type: 'file.csv.cell.set',
        row: 1,
        column: 1,
        value: 'quoted',
      },
    ]),
    source
  );
  assert.equal(
    edit(source, 'text/csv', [
      {
        opId: 'column',
        type: 'file.csv.column.insert',
        index: 1,
        values: ['X', 'Y', 'Z'],
      },
    ]),
    '\uFEFF"head",X,B\r\n"multiline\r\nvalue",Y,"quoted"\r\n,Z,\r\n'
  );
  assert.equal(
    edit(source, 'text/csv', [
      { opId: 'remove', type: 'file.csv.column.delete', index: 1 },
    ]),
    '\uFEFF"head"\r\n"multiline\r\nvalue"\r\n\r\n'
  );
});

void test('CSV row operations retain existing newline and dialect conventions', () => {
  const source = 'a;b\r\nc;d';
  const inserted = edit(source, 'text/csv', [
    {
      opId: 'row',
      type: 'file.csv.row.insert',
      delimiter: ';',
      index: 1,
      values: ['e;f', 'g'],
    },
  ]);
  assert.equal(inserted, 'a;b\r\n"e;f";g\r\nc;d');
  assert.equal(
    edit(inserted, 'text/csv', [
      { opId: 'delete', type: 'file.csv.row.delete', delimiter: ';', index: 1 },
    ]),
    source
  );
  assert.throws(() =>
    edit('"unclosed', 'text/csv', [
      { opId: 'bad', type: 'file.csv.cell.set', row: 0, column: 0, value: 'x' },
    ])
  );
});

void test('file batch rejection is atomic and UTF-16 offsets cannot split a grapheme', () => {
  const original = 'a👨‍👩‍👧‍👦b';
  assert.throws(() =>
    edit(original, 'text/plain', [
      {
        opId: 'valid',
        type: 'file.text.splice',
        offset: 0,
        deleteCount: 1,
        insert: 'A',
      },
      {
        opId: 'invalid',
        type: 'file.text.splice',
        offset: 2,
        deleteCount: 1,
        insert: 'x',
      },
    ])
  );
  assert.equal(original, 'a👨‍👩‍👧‍👦b');
});
