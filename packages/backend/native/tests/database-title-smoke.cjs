// Synthetic Yjs snapshots only; this does not read or modify a live workspace.
// node tests/database-title-smoke.cjs /absolute/path/server-native.node
const assert = require('node:assert/strict');
const path = require('node:path');
const Y = require('yjs');
const native = require(path.resolve(process.argv[2]));

function yValue(value) {
  if (value instanceof Y.AbstractType) return value;
  if (Array.isArray(value)) {
    const array = new Y.Array();
    array.push(value.map(yValue));
    return array;
  }
  if (value && typeof value === 'object') {
    return new Y.Map(
      Object.entries(value).map(([key, item]) => [key, yValue(item)])
    );
  }
  return value;
}

function snapshot(explicitTitle, withCells) {
  const doc = new Y.Doc();
  const blocks = doc.getMap('blocks');
  function block(id, flavour, children, props) {
    const value = new Y.Map();
    blocks.set(id, value);
    value.set('sys:id', id);
    value.set('sys:flavour', flavour);
    value.set('sys:version', 1);
    const childIds = new Y.Array();
    value.set('sys:children', childIds);
    childIds.push(children);
    for (const [key, property] of Object.entries(props))
      value.set(key, yValue(property));
  }
  block('page', 'affine:page', ['note'], {
    'prop:title': new Y.Text('Table fixture'),
  });
  block('note', 'affine:note', ['database'], {});
  block('database', 'affine:database', ['row'], {
    'prop:title': new Y.Text('Tasks'),
    'prop:columns': [
      ...(explicitTitle
        ? [{ id: 'title', type: 'title', name: 'Task name' }]
        : []),
      { id: 'amount', type: 'number', name: 'Amount' },
    ],
    ...(withCells ? { 'prop:cells': { row: { amount: { value: 0 } } } } : {}),
  });
  block('row', 'affine:paragraph', [], {
    'prop:type': 'text',
    'prop:text': new Y.Text('QA task title'),
  });
  const encoded = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return encoded;
}

for (const aiEditable of [false, true]) {
  for (const [explicitTitle, withCells] of [
    [false, true],
    [true, true],
    [false, false],
  ]) {
    const result = native.parseDocToMarkdown(
      snapshot(explicitTitle, withCells),
      'page',
      aiEditable
    );
    assert.match(result.markdown, /QA task title/);
    assert.match(result.markdown, explicitTitle ? /Task name/ : /Title/);
    assert.match(result.markdown, /Amount/);
    if (withCells) assert.match(result.markdown, /\|\s*0\s*\|/);
  }
}
console.log(
  'PASS: 6 native table-title cases (implicit/explicit/title-only × read/edit)'
);
