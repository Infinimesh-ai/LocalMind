import {
  WORKSPACE_PAGE_TREE_CONTRACT,
  type WorkspacePageTreeCommandInput,
} from '@affine/graphql';
import { expect, test, vi } from 'vitest';
import { Array as YArray, Doc as YDoc, Map as YMap } from 'yjs';

import {
  LocalPageTreeAdapter,
  type LocalPageTreePorts,
} from './page-tree-local';

function setup() {
  const root = new YDoc(),
    folders = new YDoc(),
    properties = new YDoc(),
    journal = new YDoc();
  const pages = new YArray<YMap<unknown>>();
  root.getMap('meta').set('pages', pages);
  const create = vi.fn(async ({ id, title, primaryMode, at }) => {
    if (!pages.toArray().some(page => page.get('id') === id))
      pages.push([
        new YMap<unknown>([
          ['id', id],
          ['title', title],
          ['createDate', at],
          ['displayUpdateEvent', { at, by: null, actor: 'unknown' }],
        ]),
      ]);
    properties.getMap(id).set('primaryMode', primaryMode);
  });
  let queue = Promise.resolve();
  const ports: LocalPageTreePorts = {
    workspaceId: 'local',
    root,
    folders,
    properties,
    journal,
    ready: async () => {},
    persist: async () => {},
    exclusive: run => {
      const next = queue.then(run);
      queue = next.then(
        () => {},
        () => {}
      );
      return next;
    },
    create,
    delete: async id => {
      const index = pages.toArray().findIndex(page => page.get('id') === id);
      if (index >= 0) pages.delete(index, 1);
    },
  };
  const adapter = new LocalPageTreeAdapter(ports);
  const row = (id: string, values: Record<string, unknown>) => {
    const row = folders.getMap(id);
    for (const [key, value] of Object.entries({ id, ...values }))
      row.set(key, value);
  };
  const command = async (
    input: Partial<WorkspacePageTreeCommandInput> & { action: string }
  ) => {
    const page = await adapter.list({});
    return adapter.execute({
      workspaceId: 'local',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      expectedRevision: page.revision,
      expectedAuthorizationRevision: page.authorizationRevision,
      requestKey: crypto.randomUUID(),
      ...input,
    });
  };
  return {
    root,
    folders,
    properties,
    journal,
    pages,
    create,
    ports,
    adapter,
    row,
    command,
  };
}

test('local migration creates real containers, deterministically collapses placements and preserves prior resource evidence', async () => {
  const { create, adapter, row, pages } = setup();
  await create({ id: 'doc', title: 'Original', primaryMode: 'page', at: 13 });
  const before = pages.get(0).toJSON();
  row('parent', {
    type: 'folder',
    data: 'Container',
    parentId: null,
    index: 'a0',
    defaultSortMode: 'name-desc',
  });
  row('empty', {
    type: 'folder',
    data: 'Empty',
    parentId: 'parent',
    index: 'a0',
  });
  row('one', { type: 'doc', data: 'doc', parentId: 'parent', index: 'a1' });
  row('two', { type: 'doc', data: 'doc', parentId: null, index: 'a2' });
  const root = await adapter.list({});
  expect(root.items).toHaveLength(1);
  expect(root.items[0].defaultSortMode).toBe('name-desc');
  expect(
    (await adapter.list({ parentNodeId: 'parent' })).items.map(
      node => node.title
    )
  ).toEqual(['Empty', 'Original']);
  expect(pages.get(0).toJSON()).toMatchObject(before);
  expect(create).toHaveBeenCalledTimes(1);
  await adapter.list({});
  expect(create).toHaveBeenCalledTimes(1);
});

test('a failed local folder migration resumes without creating content documents', async () => {
  const { create, adapter, row, ports, pages } = setup();
  row('one', { type: 'folder', data: 'One', parentId: null, index: 'a0' });
  row('two', { type: 'folder', data: 'Two', parentId: null, index: 'a1' });
  ports.persist = vi
    .fn()
    .mockRejectedValueOnce(new Error('disk interrupted'))
    .mockResolvedValue(undefined);
  await expect(adapter.list({})).rejects.toThrow('disk interrupted');
  const resumed = new LocalPageTreeAdapter(ports);
  expect((await resumed.list({})).items.map(item => item.nodeId)).toEqual([
    'one',
    'two',
  ]);
  expect(create).not.toHaveBeenCalled();
  expect(pages.length).toBe(0);
});

test('local subtree trash and restore leave prior independent trash and update evidence intact', async () => {
  const { command, adapter, pages } = setup();
  const parent = await command({
    action: 'create',
    title: 'Parent',
    primaryMode: 'page',
    parentNodeId: null,
  });
  const child = await command({
    action: 'create',
    title: 'Child',
    primaryMode: 'page',
    parentNodeId: parent.nodeId,
  });
  const independent = await command({
    action: 'create',
    title: 'Independent',
    primaryMode: 'page',
    parentNodeId: parent.nodeId,
  });
  const events = pages.toArray().map(page => page.get('displayUpdateEvent'));
  await command({ action: 'trash', nodeId: independent.nodeId });
  await command({ action: 'trash', nodeId: parent.nodeId });
  await expect(
    command({ action: 'delete', nodeId: parent.nodeId })
  ).rejects.toThrow('dependent trash');
  await command({ action: 'restore', nodeId: parent.nodeId });
  expect(
    (await adapter.list({ parentNodeId: parent.nodeId })).items.map(
      node => node.nodeId
    )
  ).toEqual([child.nodeId]);
  expect(
    (await adapter.list({ trash: true })).items.map(node => node.nodeId)
  ).toEqual([independent.nodeId]);
  expect(pages.toArray().map(page => page.get('displayUpdateEvent'))).toEqual(
    events
  );
});

test('local cycles, leaves, stale requests and identity reuse are rejected before writing', async () => {
  const { command, adapter } = setup();
  const parent = await command({
    action: 'create',
    title: 'Page',
    primaryMode: 'page',
    parentNodeId: null,
  });
  const child = await command({
    action: 'create',
    title: 'Child',
    primaryMode: 'page',
    parentNodeId: parent.nodeId,
  });
  const whiteboard = await command({
    action: 'create',
    title: 'Board',
    primaryMode: 'edgeless',
    parentNodeId: null,
  });
  await expect(
    command({
      action: 'move',
      nodeId: parent.nodeId,
      parentNodeId: child.nodeId,
    })
  ).rejects.toThrow('cycle');
  await expect(
    command({
      action: 'move',
      nodeId: child.nodeId,
      parentNodeId: whiteboard.nodeId,
    })
  ).rejects.toThrow('active page');
  const before = await adapter.list({});
  await expect(
    command({
      action: 'move',
      nodeId: child.nodeId,
      parentNodeId: null,
      expectedRevision: 0,
    })
  ).rejects.toThrow('changed');
  expect(await adapter.list({})).toEqual(before);
  await command({ action: 'trash', nodeId: child.nodeId });
  await command({ action: 'delete', nodeId: child.nodeId });
  await expect(
    command({
      action: 'create',
      title: 'Revive',
      primaryMode: 'page',
      resourceId: child.resourceId,
      parentNodeId: null,
    })
  ).rejects.toThrow('identity');
});

test('local recovery never removes a document absent from its frozen plan', async () => {
  const { adapter, create, row, pages, ports } = setup();
  row('parent', {
    type: 'folder',
    data: 'Container',
    parentId: null,
    index: 'a0',
  });
  ports.persist = vi
    .fn()
    .mockRejectedValueOnce(new Error('interrupted'))
    .mockResolvedValue(undefined);
  await expect(adapter.list({})).rejects.toThrow();
  await create({
    id: 'concurrent',
    title: 'Keep',
    primaryMode: 'page',
    at: 22,
  });
  await expect(adapter.list({})).rejects.toThrow('missing_resource');
  expect(pages.toArray().some(page => page.get('id') === 'concurrent')).toBe(
    true
  );
});

test('local lifecycle confirmation bounds the preview and rejects a changed tree', async () => {
  const { command, adapter } = setup();
  const parent = await command({
    action: 'create',
    title: 'Parent',
    primaryMode: 'page',
    parentNodeId: null,
  });
  for (let index = 0; index < 21; index++)
    await command({
      action: 'create',
      title: `Child ${index}`,
      primaryMode: 'page',
      parentNodeId: parent.nodeId,
    });
  const preview = await adapter.lifecyclePreview(parent.nodeId, 'trash');
  expect(preview.total).toBe(22);
  expect(preview.items).toHaveLength(20);
  expect(preview.truncated).toBe(true);
  await command({
    action: 'create',
    title: 'Late child',
    primaryMode: 'page',
    parentNodeId: parent.nodeId,
  });
  await expect(
    adapter.execute({
      workspaceId: 'local',
      contractVersion: WORKSPACE_PAGE_TREE_CONTRACT,
      action: 'trash',
      nodeId: parent.nodeId,
      expectedRevision: preview.revision,
      expectedAuthorizationRevision: preview.authorizationRevision,
      requestKey: 'confirmed-old-preview',
    })
  ).rejects.toThrow();
  expect(
    (await adapter.list({ parentNodeId: parent.nodeId })).items
  ).toHaveLength(22);
});

test('local dual containers survive restart, preserve children on conversion, and upload typed folders without bodies', async () => {
  const { adapter, command, ports, pages, create } = setup();
  const folder = await command({
    action: 'create-folder',
    title: 'Folder',
    parentNodeId: null,
  });
  expect(pages.length).toBe(0);
  expect(create).not.toHaveBeenCalled();
  const page = await command({
    action: 'create',
    title: 'Page',
    primaryMode: 'page',
    parentNodeId: folder.nodeId,
  });
  const nested = await command({
    action: 'create-folder',
    title: 'Nested',
    parentNodeId: page.nodeId,
  });
  const resumed = new LocalPageTreeAdapter(ports);
  expect(
    (await resumed.list({ parentNodeId: folder.nodeId })).items[0].resourceId
  ).toBe(page.resourceId);
  const snapshot = await resumed.uploadSnapshot();
  expect(snapshot.find(item => item.nodeId === nested.nodeId)).toMatchObject({
    kind: 'folder',
    parentNodeId: page.nodeId,
    folder: { metadataVersion: 1 },
  });
  const converted = await command({
    action: 'convert-folder',
    nodeId: folder.nodeId,
    expectedResourceVersion: 1,
  });
  expect(converted.nodeId).toBe(folder.nodeId);
  expect(pages.length).toBe(2);
  expect(
    (await adapter.list({ parentNodeId: folder.nodeId })).items[0].resourceId
  ).toBe(page.resourceId);
  expect(
    (
      await adapter.list({
        resourceKind: 'folder',
        resourceId: folder.resourceId,
      })
    ).parent?.kind
  ).toBe('doc');
  await expect(
    command({
      action: 'rename-folder',
      nodeId: folder.nodeId,
      title: 'Stale',
      expectedResourceVersion: 1,
    })
  ).rejects.toThrow();
});
