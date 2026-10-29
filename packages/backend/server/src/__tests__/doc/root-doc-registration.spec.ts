import test from 'ava';
import * as Y from 'yjs';

import {
  prepareRootDocRegistration,
  prepareRootDocRegistrationWithYjs,
  readRootDocPageIdsWithYjs,
} from '../../core/doc/root-doc-registration';

test('plain legacy page arrays migrate incrementally without losing metadata', t => {
  const root = new Y.Doc();
  const client = new Y.Doc();
  try {
    const legacy = [
      {
        id: 'existing',
        custom: { nested: [1, { value: '保留' }] },
        tags: ['a'],
      },
      { id: 'deleted', trash: true, custom: 'also preserved' },
    ];
    root.getMap('meta').set('pages', legacy);
    root.getMap('meta').set('unknown', { a: ['keep'] });
    root.getMap('other').set('value', 'unrelated');
    const original = Y.encodeStateAsUpdate(root);
    t.deepEqual(readRootDocPageIdsWithYjs(original), ['existing']);
    t.deepEqual(
      prepareRootDocRegistration(original, 'existing', 'ignored').update,
      new Uint8Array([0, 0])
    );
    const plan = prepareRootDocRegistration(original, 'new', 'New');
    t.is(plan.replacementSnapshot, undefined);
    Y.applyUpdate(client, original);
    Y.applyUpdate(client, plan.update);
    Y.applyUpdate(client, plan.update);
    const pages = client.getMap('meta').get('pages') as Y.Array<Y.Map<unknown>>;
    t.true(pages instanceof Y.Array);
    t.true(pages.get(0) instanceof Y.Map);
    t.true(pages.get(0).get('custom') instanceof Y.Map);
    t.deepEqual(pages.toJSON().slice(0, 2), legacy);
    t.deepEqual(client.getMap('meta').get('unknown'), { a: ['keep'] });
    t.is(client.getMap('other').get('value'), 'unrelated');
    t.deepEqual(readRootDocPageIdsWithYjs(Y.encodeStateAsUpdate(client)), [
      'existing',
      'new',
    ]);
    t.deepEqual(root.getMap('meta').get('pages'), legacy);
  } finally {
    root.destroy();
    client.destroy();
  }
});

test('incremental registration preserves existing CRDT metadata and replays once', t => {
  const root = new Y.Doc();
  const client = new Y.Doc();
  try {
    const pages = new Y.Array<Y.Map<unknown>>();
    root.getMap('meta').set('name', 'Workspace');
    root.getMap('meta').set('pages', pages);
    const page = new Y.Map<unknown>();
    pages.push([page]);
    page.set('id', 'existing');
    page.set('title', 'Original');
    page.set('custom', new Y.Text('Keep unknown metadata'));
    const tags = new Y.Array<string>();
    tags.push(['original-tag']);
    page.set('tags', tags);
    root.getMap('other').set('value', 'Keep other shared types');
    const original = Y.encodeStateAsUpdate(root);
    Y.applyUpdate(client, original);
    const existingPages = client.getMap('meta').get('pages');
    const plan = prepareRootDocRegistrationWithYjs(original, 'new', '子页面')!;
    t.is(plan.replacementSnapshot, undefined);
    Y.applyUpdate(client, plan.update);
    Y.applyUpdate(client, plan.update);
    t.is(client.getMap('meta').get('pages'), existingPages);
    t.deepEqual(readRootDocPageIdsWithYjs(Y.encodeStateAsUpdate(client)), [
      'existing',
      'new',
    ]);
    t.is(client.getMap('meta').get('name'), 'Workspace');
    const originalPage = (existingPages as Y.Array<Y.Map<unknown>>).get(0);
    t.is(
      (originalPage.get('custom') as Y.Text).toString(),
      'Keep unknown metadata'
    );
    t.deepEqual((originalPage.get('tags') as Y.Array<string>).toArray(), [
      'original-tag',
    ]);
    t.is(client.getMap('other').get('value'), 'Keep other shared types');
    const replay = prepareRootDocRegistrationWithYjs(
      Y.encodeStateAsUpdate(client),
      'new',
      'Ignored title'
    )!;
    t.deepEqual(replay.update, new Uint8Array([0, 0]));
  } finally {
    root.destroy();
    client.destroy();
  }
});

test('incremental registration does not replace an invalid bootstrap page list', t => {
  const root = new Y.Doc();
  try {
    root.getMap('meta').set('pages', 'Invalid legacy value');
    t.is(
      prepareRootDocRegistrationWithYjs(
        Y.encodeStateAsUpdate(root),
        'new',
        'New'
      ),
      null
    );
    t.is(root.getMap('meta').get('pages'), 'Invalid legacy value');
  } finally {
    root.destroy();
  }
});
