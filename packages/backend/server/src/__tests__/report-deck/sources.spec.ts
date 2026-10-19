import type { DeckSourceRef } from '@localmind/office/report-deck';
import test from 'ava';

import { AccessDenied, BadRequest, NotFound } from '../../base';
import { ResourceError } from '../../core/doc/resource-types';
import {
  decodeDeckCursor,
  encodeDeckCursor,
} from '../../core/report-deck/service';
import {
  allocateDeckBudget,
  deckSourceKey,
  estimateDeckMinutes,
  planDeckSources,
  truncateDocuments,
} from '../../core/report-deck/source-rules';
import { deckSourceFailureReason } from '../../core/report-deck/sources';

const doc = (scopeId: string, resourceId: string): DeckSourceRef => ({
  scopeKind: 'workspace',
  scopeId,
  kind: 'doc',
  resourceId,
});
const projectFile = (scopeId: string, resourceId: string): DeckSourceRef => ({
  scopeKind: 'project',
  scopeId,
  kind: 'file',
  resourceId,
});

test('exact duplicates keep the first occurrence; doc and file of one id are the same resource', t => {
  const plan = planDeckSources(
    [
      doc('w1', 'a'),
      doc('w1', 'b'),
      doc('w1', 'a'),
      { ...doc('w1', 'b'), kind: 'file' },
      doc('w2', 'a'),
    ],
    200
  );
  t.deepEqual(
    plan.map(item => item.skip),
    [null, null, 'duplicate', 'duplicate', null]
  );
  t.is(
    deckSourceKey(doc('w1', 'a')),
    deckSourceKey({ ...doc('w1', 'a'), kind: 'file' })
  );
});

test('a whole project merges the other sources of that project, in any order', t => {
  const plan = planDeckSources(
    [
      projectFile('p1', 'r1'),
      { scopeKind: 'project', scopeId: 'p1', kind: 'project_all' },
      { scopeKind: 'project', scopeId: 'p1', kind: 'folder', resourceId: 'f' },
      projectFile('p2', 'r1'),
      { scopeKind: 'project', scopeId: 'p1', kind: 'project_all' },
    ],
    200
  );
  t.deepEqual(
    plan.map(item => item.skip),
    ['duplicate', null, 'duplicate', null, 'duplicate']
  );
});

test('sources beyond the source limit are over budget and do not trigger merging', t => {
  const plan = planDeckSources(
    [
      projectFile('p1', 'r1'),
      doc('w1', 'a'),
      { scopeKind: 'project', scopeId: 'p1', kind: 'project_all' },
    ],
    2
  );
  t.deepEqual(
    plan.map(item => item.skip),
    [null, null, 'over_budget']
  );
});

test('character budget is allocated in selection order', t => {
  t.deepEqual(allocateDeckBudget([400, 0, 500, 300, 10], 1000), [
    { status: 'included', reason: null, keep: 400 },
    { status: 'excluded', reason: 'empty', keep: 0 },
    { status: 'included', reason: null, keep: 500 },
    { status: 'truncated', reason: null, keep: 100 },
    { status: 'excluded', reason: 'over_budget', keep: 0 },
  ]);
  t.deepEqual(allocateDeckBudget([1000], 1000), [
    { status: 'included', reason: null, keep: 1000 },
  ]);
});

test('truncation keeps leading documents and drops blank remainders', t => {
  const docs = [
    { key: 'a', text: 'hello' },
    { key: 'b', text: '   ' },
    { key: 'c', text: 'world!' },
    { key: 'd', text: 'never' },
  ];
  t.deepEqual(truncateDocuments(docs, 8), [
    { key: 'a', text: 'hello' },
    { key: 'c', text: 'wor' },
  ]);
  t.deepEqual(truncateDocuments(docs, 0), []);
});

test('failures map to user-visible exclusion reasons', t => {
  t.is(deckSourceFailureReason(new AccessDenied()), 'no_permission');
  t.is(deckSourceFailureReason(new NotFound()), 'not_found');
  t.is(
    deckSourceFailureReason(new ResourceError('permission_denied')),
    'no_permission'
  );
  t.is(
    deckSourceFailureReason(new ResourceError('resource_not_found')),
    'not_found'
  );
  t.is(deckSourceFailureReason(new BadRequest('x')), 'unsupported');
  t.is(deckSourceFailureReason(new BadRequest('x'), 'not_found'), 'not_found');
  t.is(deckSourceFailureReason(new Error('boom')), 'unsupported');
});

test('estimate and cursor helpers are stable', t => {
  t.is(estimateDeckMinutes(0), 1);
  t.true(estimateDeckMinutes(600000) > estimateDeckMinutes(48000));
  const cursor = { createdAt: new Date('2026-10-15T00:00:00.000Z'), id: 'd1' };
  t.deepEqual(decodeDeckCursor(encodeDeckCursor(cursor)), cursor);
  t.is(decodeDeckCursor(null), null);
  t.throws(() => decodeDeckCursor('not-a-cursor'));
});
