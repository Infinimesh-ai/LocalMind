import { WORKSPACE_PAGE_TREE_CONTRACT } from '@affine/graphql';
import test from 'ava';
import * as Y from 'yjs';

import { snapshotParser } from '../snapshot-parser';
import { WorkspacePageTreeService } from '../workspace-page-tree';

test.after.always(async () => snapshotParser.close());

test('read snapshots cover nested titles, pure deletions, authorization and tree revisions', async t => {
  const actor = { workspaceId: 'snapshot-workspace', actorId: 'owner' };
  const root = new Y.Doc();
  const tree = new Y.Doc();
  t.teardown(() => {
    root.destroy();
    tree.destroy();
  });
  const pages = new Y.Array<Y.Map<unknown>>();
  root.getMap('meta').set('pages', pages);
  root.getMap('meta').set('legacy', true);
  for (const [id, parentId] of [
    ['parent', null],
    ['child', 'parent'],
  ] as const) {
    const page = new Y.Map<unknown>();
    page.set('id', id);
    page.set('title', id);
    pages.push([page]);
    for (const [key, value] of Object.entries({
      id,
      parentId,
      type: 'doc',
      data: id,
      index: 'a0',
    }))
      tree.getMap(id).set(key, value);
  }
  let authorizationVersion = 1;
  let revision = 1;
  let allowed = true;
  const acl = {
    assert: async () => {
      if (!allowed) throw new Error('Access denied');
    },
    can: async () => allowed,
    doc: () => ({ can: async () => allowed }),
  };
  const service = new WorkspacePageTreeService(
    {
      observe: async (read: () => Promise<unknown>) => read(),
      getDocReadOnly: async (_workspaceId: string, id: string) => {
        const doc =
          id === actor.workspaceId
            ? root
            : id === `db$${actor.workspaceId}$folders`
              ? tree
              : null;
        return doc ? { bin: Y.encodeStateAsUpdate(doc) } : null;
      },
    } as never,
    {} as never,
    {} as never,
    {
      workspacePageTree: {
        state: async () => ({
          phase: 'switched',
          revision,
          contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
        }),
        inventory: async () => ({ files: [], office: [], policies: [] }),
        authorizationVersion: async () => authorizationVersion,
      },
    } as never,
    { user: () => ({ workspace: () => acl }) } as never
  );
  const first = await service.list(actor, null);
  t.regex(first.snapshotRevision!, /^[a-f\d]{64}$/);
  t.is(
    (await service.list(actor, 'parent')).snapshotRevision,
    first.snapshotRevision
  );
  t.is(
    (await service.list(actor, null)).snapshotRevision,
    first.snapshotRevision
  );
  pages.get(1).set('title', 'renamed child');
  const renamed = await service.list(actor, null);
  t.is(renamed.revision, first.revision);
  t.not(renamed.snapshotRevision, first.snapshotRevision);
  const children = await service.list(actor, 'parent');
  t.is(children.items[0].title, 'renamed child');
  t.is(children.snapshotRevision, renamed.snapshotRevision);
  const vector = Y.encodeStateVector(root);
  root.getMap('meta').delete('legacy');
  t.deepEqual(Y.encodeStateVector(root), vector);
  const deleted = await service.list(actor, null);
  t.not(deleted.snapshotRevision, renamed.snapshotRevision);
  authorizationVersion++;
  const authorization = await service.list(actor, null);
  t.not(authorization.snapshotRevision, deleted.snapshotRevision);
  revision++;
  t.not(
    (await service.list(actor, null)).snapshotRevision,
    authorization.snapshotRevision
  );
  allowed = false;
  await t.throwsAsync(service.list(actor, null), { message: 'Access denied' });
});
