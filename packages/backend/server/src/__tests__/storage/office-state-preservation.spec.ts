import test from 'ava';

import { preserveOfficeState } from '../../core/office/state-preservation';

test('native Office edits retain independent and unknown state fields', t => {
  const before = {
    schemaVersion: 'v1',
    body: [{ id: 'paragraph:ABCD', text: 'old' }],
    layout: { width: 100 },
  };
  const after = { ...before, body: [{ id: 'paragraph:ABCD', text: 'new' }] };
  const stored = {
    ...before,
    body: [{ ...before.body[0], future: { exact: ['keep'] } }],
    layout: { width: 120 },
    opaque: [null, false, 0],
  };
  t.deepEqual(preserveOfficeState(before, after, stored), {
    ...stored,
    body: [{ ...stored.body[0], text: 'new' }],
  });
});

test('state merging follows stable object IDs across reordering', t => {
  const before = {
    sheets: [
      { id: '2', name: 'Two' },
      { id: '1', name: 'One' },
    ],
  };
  const stored = {
    sheets: before.sheets.map(sheet => ({ ...sheet, opaque: sheet.id })),
  };
  const after = { sheets: [before.sheets[1], before.sheets[0]] };
  t.deepEqual(preserveOfficeState(before, after, stored), {
    sheets: [stored.sheets[1], stored.sheets[0]],
  });
});

test('ambiguous positional identities reject instead of moving unknown state onto another paragraph', t => {
  const before = { body: [{ id: 'paragraph:1', text: 'old' }] };
  const stored = {
    body: [{ ...before.body[0], annotation: 'belongs to old' }],
  };
  t.throws(
    () =>
      preserveOfficeState(
        before,
        {
          body: [
            { id: 'paragraph:1', text: 'inserted' },
            { id: 'paragraph:2', text: 'old' },
          ],
        },
        stored
      ),
    { message: 'preservation_failed' }
  );
  t.is(stored.body[0].annotation, 'belongs to old');
});

test('explicit deletion removes the selected state object and retains other objects', t => {
  const before = { slides: [{ id: 'first' }, { id: 'second' }] };
  const stored = {
    slides: [
      { id: 'first', future: 1 },
      { id: 'second', future: 2 },
    ],
  };
  t.deepEqual(
    preserveOfficeState(before, { slides: [{ id: 'second' }] }, stored),
    { slides: [{ id: 'second', future: 2 }] }
  );
});

test('same-length structural edits cannot move opaque positional state to a different object', t => {
  const before = {
    body: [
      { id: 'paragraph:1', text: 'a' },
      { id: 'paragraph:2', text: 'b' },
    ],
  };
  const stored = {
    body: before.body.map(block => ({ ...block, opaque: block.text })),
  };
  const after = {
    body: [
      { id: 'paragraph:1', text: 'b' },
      { id: 'paragraph:2', text: 'a' },
    ],
  };
  t.throws(() => preserveOfficeState(before, after, stored, true), {
    message: 'preservation_failed',
  });
});

test('stable numeric Word paragraph identities are not mistaken for positional IDs', t => {
  const paragraph = {
    id: 'paragraph:00000001',
    sourceId: '00000001',
    text: 'keep',
  };
  const before = { body: [paragraph] },
    stored = { body: [{ ...paragraph, opaque: 'retained' }] };
  t.deepEqual(
    preserveOfficeState(
      before,
      {
        body: [
          paragraph,
          { id: 'paragraph:00000002', sourceId: '00000002', text: 'new' },
        ],
      },
      stored,
      true
    ).body[0],
    stored.body[0]
  );
});

test('a newly generated ID cannot collide with independent stored objects', t => {
  t.throws(
    () =>
      preserveOfficeState(
        { sheets: [{ id: 'old' }] },
        { sheets: [{ id: 'old' }, { id: 'new' }] },
        { sheets: [{ id: 'old' }, { id: 'new', opaque: true }] }
      ),
    { message: 'preservation_failed' }
  );
});

test('optional native parser fields are JSON absence, not opaque positional state', t => {
  const before = {
    body: [
      { id: 'paragraph:1', text: '', sourceId: undefined, format: undefined },
    ],
  };
  const stored = JSON.parse(JSON.stringify(before));
  t.deepEqual(
    preserveOfficeState(
      before,
      {
        body: [
          {
            id: 'paragraph:ABCD',
            text: 'typed',
            sourceId: undefined,
            format: undefined,
          },
        ],
      },
      stored,
      true
    ),
    { body: [{ id: 'paragraph:ABCD', text: 'typed' }] }
  );
});

test('declared editor identity mappings carry independent paragraph state onto the same surviving paragraph', t => {
  const before = {
    body: [
      { id: 'paragraph:1', text: 'keep' },
      { id: 'paragraph:2', text: '' },
    ],
  };
  const stored = {
    body: before.body.map(block => ({
      ...block,
      unknown: { evidence: block.id },
    })),
  };
  const after = {
    body: [
      { id: 'paragraph:00000001', sourceId: '00000001', text: 'keep' },
      { id: 'paragraph:00000002', sourceId: '00000002', text: 'typed' },
      { id: 'paragraph:00000003', sourceId: '00000003', text: 'new' },
    ],
  };
  t.deepEqual(
    preserveOfficeState(
      before,
      after,
      stored,
      true,
      new Map([
        ['paragraph:1', 'paragraph:00000001'],
        ['paragraph:2', 'paragraph:00000002'],
      ])
    ),
    {
      body: [
        { ...after.body[0], unknown: stored.body[0].unknown },
        { ...after.body[1], unknown: stored.body[1].unknown },
        after.body[2],
      ],
    }
  );
});
