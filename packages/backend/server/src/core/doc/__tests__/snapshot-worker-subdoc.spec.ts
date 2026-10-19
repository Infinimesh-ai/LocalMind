import test from 'ava';
import * as Y from 'yjs';

import { validatePageTreeSyncUpdate } from '../page-tree-sync';
import { SnapshotParser, snapshotParser } from '../snapshot-parser';

test.after.always(async () => snapshotParser.close());

test('workspace metadata decoding handles subdocuments and isolates cached values', async t => {
  const parser = new SnapshotParser();
  const root = new Y.Doc();
  t.teardown(async () => {
    root.destroy();
    await parser.close();
  });
  const pages = new Y.Array();
  pages.push([{ id: 'page-1', title: 'Page' }]);
  root.getMap('meta').set('pages', pages);
  root.getMap('spaces').set('page-1', new Y.Doc({ guid: 'page-1' }));
  const bin = Y.encodeStateAsUpdate(root);
  const first = await parser.decode('workspace-with-subdoc', bin);
  t.is(first.pagesKind, 'array');
  t.deepEqual(first.maps.meta.pages, [{ id: 'page-1', title: 'Page' }]);
  t.deepEqual(first.maps.spaces['page-1'], { guid: 'page-1' });
  first.maps.spaces['page-1'] = null;
  t.deepEqual(
    (await parser.decode('workspace-with-subdoc', bin)).maps.spaces['page-1'],
    { guid: 'page-1' }
  );
  const vector = Y.encodeStateVector(root);
  root.getMap('spaces').delete('page-1');
  t.deepEqual(Y.encodeStateVector(root), vector);
  t.deepEqual(
    (await parser.decode('workspace-with-subdoc', Y.encodeStateAsUpdate(root)))
      .maps.spaces,
    {}
  );
});

test('body sync rereads the authoritative root and rejects removal after a cached read', async t => {
  const root = new Y.Doc();
  t.teardown(() => root.destroy());
  const pages = new Y.Array();
  pages.push([{ id: 'body-1' }]);
  root.getMap('meta').set('pages', pages);
  let reads = 0;
  const input = {
    workspaceId: 'body-sync-workspace',
    docId: 'body-1',
    updates: [new Uint8Array([0, 0])],
    read: async () => {
      reads++;
      return {
        spaceId: 'body-sync-workspace',
        docId: 'body-sync-workspace',
        bin: Y.encodeStateAsUpdate(root),
        timestamp: 1,
      };
    },
  };
  await validatePageTreeSyncUpdate(input);
  await validatePageTreeSyncUpdate(input);
  t.is(reads, 2);
  const vector = Y.encodeStateVector(root);
  pages.delete(0);
  t.deepEqual(Y.encodeStateVector(root), vector);
  await t.throwsAsync(validatePageTreeSyncUpdate(input), {
    message: 'page_tree_resource_unavailable',
  });
  await t.throwsAsync(
    validatePageTreeSyncUpdate({
      ...input,
      read: async () => {
        throw new Error('Storage unavailable');
      },
    }),
    { message: 'Storage unavailable' }
  );
});
