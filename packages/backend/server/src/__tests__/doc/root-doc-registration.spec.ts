import test from 'ava';
import * as Y from 'yjs';

import {
  prepareRootDocRegistrationWithYjs,
  readRootDocPageIdsWithYjs,
} from '../../core/doc/root-doc-registration';

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
