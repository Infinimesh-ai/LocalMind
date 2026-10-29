import test from 'ava';
import * as Y from 'yjs';

import { prepareRootDocRegistration } from '../../core/doc/root-doc-registration';
import { SnapshotParser } from '../../core/doc/snapshot-parser';
import {
  parsePageDoc,
  parseWorkspaceDoc,
  readAllDocIdsFromWorkspaceSnapshot,
} from '../../core/utils/blocksuite';

const parser = new SnapshotParser();
test.after.always(async () => parser.close());

test.serial(
  'legacy array migration preserves data and rejects stale replacements',
  async t => {
    const parser = new SnapshotParser();
    const root = new Y.Doc({ gc: false });
    const migrated = new Y.Doc();
    try {
      root.getMap('meta').set('pages', [{ id: 'page', extra: { x: [1, 2] } }]);
      const original = Y.encodeStateAsUpdate(root);
      const decoded = await parser.decode('legacy-root', original);
      t.is(decoded.pagesKind, 'legacy-array');
      Y.applyUpdate(migrated, original);
      const plan = prepareRootDocRegistration(original, 'new', 'New');
      Y.applyUpdate(migrated, plan.update);
      const stored = Y.encodeStateAsUpdate(migrated);
      for (const clientID of [1, Number.MAX_SAFE_INTEGER - 1]) {
        const stale = new Y.Doc({ gc: false });
        try {
          stale.clientID = clientID;
          Y.applyUpdate(stale, original);
          const vector = Y.encodeStateVector(stale);
          stale.getMap('meta').set('pages', [{ id: 'page', extra: 'offline' }]);
          const update = Y.encodeStateAsUpdate(stale, vector);
          await t.throwsAsync(
            parser.validate({
              workspaceId: 'workspace',
              docId: 'workspace',
              snapshots: { workspace: stored },
              updates: [update],
            }),
            { message: 'page_tree_protocol_retired' }
          );
        } finally {
          stale.destroy();
        }
      }
      await parser.validate({
        workspaceId: 'workspace',
        docId: 'workspace',
        snapshots: { workspace: stored },
        updates: [plan.update],
      });
      const live = new Y.Doc();
      try {
        Y.applyUpdate(live, stored);
        const vector = Y.encodeStateVector(live);
        const pages = live.getMap('meta').get('pages') as Y.Array<
          Y.Map<unknown>
        >;
        pages.get(0).set('title', 'edited after migration');
        await parser.validate({
          workspaceId: 'workspace',
          docId: 'workspace',
          snapshots: { workspace: stored },
          updates: [Y.encodeStateAsUpdate(live, vector)],
        });
      } finally {
        live.destroy();
      }
    } finally {
      root.destroy();
      migrated.destroy();
      await parser.close();
    }
  }
);

function root() {
  const doc = new Y.Doc();
  const pages = new Y.Array<Y.Map<unknown>>();
  doc.getMap('meta').set('pages', pages);
  const page = new Y.Map<unknown>();
  page.set('id', 'page');
  page.set('title', 'before');
  pages.push([page]);
  return { doc, page };
}

test.serial(
  'decodes off-thread, isolates cached values and keys them by current bytes',
  async t => {
    const { doc, page } = root();
    const first = Y.encodeStateAsUpdate(doc);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const decoded = await parser.decode('workspace:root', first);
    clearInterval(timer);
    t.true(
      ticks > 0,
      'the request thread remains responsive during cold parsing'
    );
    t.is(decoded.pagesKind, 'array');
    decoded.maps.meta.name = 'not canonical';
    t.is(
      (await parser.decode('workspace:root', first)).maps.meta.name,
      undefined
    );
    page.set('title', 'after');
    const next = await parser.decode(
      'workspace:root',
      Y.encodeStateAsUpdate(doc)
    );
    t.deepEqual(next.maps.meta.pages, [{ id: 'page', title: 'after' }]);
    t.deepEqual(
      (await parser.decode('workspace:root', first)).maps.meta.pages,
      [{ id: 'page', title: 'before' }]
    );
    doc.destroy();
  }
);

test.serial(
  'preserves lifecycle validation and continues after a rejected update',
  async t => {
    const { doc, page } = root();
    const bin = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    page.set('trash', true);
    const input = {
      workspaceId: 'workspace',
      docId: 'workspace',
      snapshots: { workspace: bin },
    };
    await t.throwsAsync(
      parser.validate({
        ...input,
        updates: [Y.encodeStateAsUpdate(doc, vector)],
      }),
      { message: 'page_tree_protocol_retired' }
    );
    await parser.validate({ ...input, updates: [] });
    t.pass();
    doc.destroy();
  }
);

test.serial(
  'rejects removed pages and page containers changing to edgeless',
  async t => {
    const { doc } = root();
    const properties = new Y.Doc();
    properties.getMap('page').set('primaryMode', 'page');
    const before = Y.encodeStateAsUpdate(properties);
    const vector = Y.encodeStateVector(properties);
    properties.getMap('page').set('primaryMode', 'edgeless');
    const tree = new Y.Doc();
    for (const [key, value] of Object.entries({
      id: 'parent',
      type: 'doc',
      data: 'page',
    }))
      tree.getMap('parent').set(key, value);
    tree.getMap('child').set('parentId', 'parent');
    const snapshots = {
      workspace: Y.encodeStateAsUpdate(doc),
      db$workspace$docProperties: before,
      db$workspace$folders: Y.encodeStateAsUpdate(tree),
    };
    await t.throwsAsync(
      parser.validate({
        workspaceId: 'workspace',
        docId: 'missing',
        snapshots,
        updates: [],
      }),
      { message: 'page_tree_resource_unavailable' }
    );
    await t.throwsAsync(
      parser.validate({
        workspaceId: 'workspace',
        docId: 'db$workspace$docProperties',
        snapshots,
        updates: [Y.encodeStateAsUpdate(properties, vector)],
      }),
      { message: 'page_tree_container_has_descendants' }
    );
    await parser.validate({
      workspaceId: 'workspace',
      docId: 'page',
      snapshots,
      updates: [],
    });
    t.pass();
    doc.destroy();
    properties.destroy();
    tree.destroy();
  }
);

test.serial(
  'distinguishes malformed lifecycle arrays from a valid Y.Array',
  async t => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('pages', { id: 'page' });
    const decoded = await parser.decode('invalid', Y.encodeStateAsUpdate(doc));
    t.is(decoded.pagesKind, 'invalid');
    doc.destroy();
  }
);

test.serial(
  'off-thread native readers preserve workspace, document and trash semantics',
  async t => {
    const { doc, page } = root();
    doc.getMap('meta').set('name', 'Workspace');
    doc.getMap('meta').set('avatar', 'avatar-key');
    page.set('trash', true);
    const bin = Y.encodeStateAsUpdate(doc);
    t.deepEqual(await parser.workspaceContent(bin), parseWorkspaceDoc(bin));
    for (const includeTrash of [false, true])
      t.deepEqual(
        await parser.docIds(bin, includeTrash),
        readAllDocIdsFromWorkspaceSnapshot(bin, includeTrash)
      );
    t.deepEqual(await parser.pageContent(bin, 150), parsePageDoc(bin));
    doc.destroy();
  }
);

test.serial(
  'rejects bounded queue overflow and closes queued work',
  async t => {
    const bounded = new SnapshotParser();
    const tasks = Array.from({ length: 35 }, () =>
      bounded.docIds(new Uint8Array())
    );
    const results = Promise.allSettled(tasks);
    await bounded.close();
    const settled = await results;
    t.true(settled.every(result => result.status === 'rejected'));
    const last = settled.at(-1);
    t.is(
      last?.status === 'rejected' ? last.reason.message : '',
      'Document parser is busy; retry'
    );
    await t.throwsAsync(bounded.decode('closed', null), {
      message: 'Document parser closed',
    });
  }
);
