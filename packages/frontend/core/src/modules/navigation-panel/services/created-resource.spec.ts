import type { WorkspacePageTreeQuery } from '@affine/graphql';
import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, expect, test, vi } from 'vitest';

import { CreatedResourceService } from './created-resource';

type TestTreeItem = Pick<
  WorkspacePageTreeQuery['workspacePageTree']['items'][number],
  'kind' | 'resourceId' | 'nodeId' | 'parentNodeId'
>;

const services: CreatedResourceService[] = [];
afterEach(() => services.splice(0).forEach(service => service.dispose()));
const ancestor: TestTreeItem = {
  kind: 'folder',
  resourceId: 'folder-resource',
  nodeId: 'folder-node',
  parentNodeId: null,
};
const child: TestTreeItem = {
  kind: 'file',
  resourceId: 'new-file',
  nodeId: 'new-node',
  parentNodeId: 'folder-node',
};
function setup() {
  const pages = new Map<
    string | null,
    {
      page?: { items: TestTreeItem[]; nextCursor: string | null };
      error?: boolean;
    }
  >();
  pages.set(null, {
    page: { items: [ancestor], nextCursor: null },
  });
  pages.set('folder-node', { page: { items: [], nextCursor: 'next' } });
  const tree = {
    accountGeneration: 0,
    enabled$: new LiveData<boolean | null>(true),
    layers$: new LiveData(
      new Map([
        ['location', { page: { parent: child, ancestors: [ancestor] } }],
      ])
    ),
    resourceKey: () => 'location',
    loadResource: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line rxjs/finnish -- Match the page tree read interface.
    layer$: (parent: string | null) => ({ value: pages.get(parent) ?? {} }),
    load: vi.fn(async (parent: string | null, more?: boolean) => {
      if (more)
        pages.set(parent, { page: { items: [child], nextCursor: null } });
    }),
  };
  const location$ = new LiveData({
    pathname: '/folder/folder-node',
    key: 'start',
  });
  const workbench = {
    location$,
    openTreeResource: vi.fn((item: TestTreeItem) =>
      location$.next({ pathname: `/${item.resourceId}`, key: 'created' })
    ),
    openAll: vi.fn(() => location$.next({ pathname: '/all', key: 'all' })),
  };
  const navigation = { setCollapsed: vi.fn() };
  const framework = new Framework();
  framework.service(
    CreatedResourceService,
    () =>
      new CreatedResourceService(
        tree as never,
        navigation as never,
        { workbench } as never
      )
  );
  const service = framework.provider().get(CreatedResourceService);
  services.push(service);
  return { service, tree, workbench, navigation, pages };
}

test('creation expands only its ancestor path, loads sibling pages and opens the new item', async () => {
  const { service, tree, navigation, workbench } = setup();
  const origin = service.begin();
  expect(await service.reveal([child], origin.isCurrent)).toBe(true);
  expect(tree.load).toHaveBeenCalledWith('folder-node', true);
  expect(navigation.setCollapsed.mock.calls).toEqual([
    [['page-tree', 'folder-node'], false],
  ]);
  expect(workbench.openTreeResource).toHaveBeenCalledWith(child);
  expect(service.reveal$.value?.nodeIds).toEqual(['new-node']);
  expect(service.consumeEditorFocus('file', 'new-file')).toBe(true);
  expect(service.consumeEditorFocus('file', 'new-file')).toBe(false);
});

test('navigation during creation suppresses both reveal and editor focus', async () => {
  const { service, workbench, tree } = setup();
  const origin = service.begin();
  workbench.location$.next({ pathname: '/elsewhere', key: 'other' });
  expect(await service.reveal([child], origin.isCurrent)).toBe(false);
  expect(tree.loadResource).not.toHaveBeenCalled();
  expect(service.editorFocus$.value).toBe(null);
});

test('navigation while locating a committed resource is also respected', async () => {
  const { service, workbench, tree } = setup();
  let resolve!: () => void;
  tree.loadResource.mockImplementationOnce(
    () =>
      new Promise<void>(done => {
        resolve = done;
      })
  );
  const pending = service.reveal([child], service.begin().isCurrent);
  workbench.location$.next({ pathname: '/elsewhere', key: 'other' });
  resolve();
  expect(await pending).toBe(false);
  expect(workbench.openTreeResource).not.toHaveBeenCalled();
});

test('account changes discard the pending UI intent', async () => {
  const { service, tree } = setup();
  const origin = service.begin();
  tree.accountGeneration++;
  tree.enabled$.next(null);
  expect(origin.sameAccount()).toBe(false);
  expect(await service.reveal([child], origin.isCurrent)).toBe(false);
});

test('failed or stalled pagination stops without opening a partial or invented item', async () => {
  const { service, tree, workbench } = setup();
  tree.load.mockResolvedValue(undefined);
  await expect(
    service.reveal([child], service.begin().isCurrent)
  ).rejects.toThrow('not visible');
  expect(tree.load).toHaveBeenCalledTimes(2);
  expect(workbench.openTreeResource).not.toHaveBeenCalled();
});

test('new folders receive sidebar focus without expanding the empty folder', async () => {
  const { service, tree, pages, navigation } = setup();
  const folder = { ...child, kind: 'folder' };
  tree.layers$.next(
    new Map([['location', { page: { parent: folder, ancestors: [ancestor] } }]])
  );
  pages.set('folder-node', { page: { items: [folder], nextCursor: null } });
  await service.reveal([folder], service.begin().isCurrent);
  expect(service.reveal$.value?.focusTree).toBe(true);
  expect(service.consumeEditorFocus('folder', folder.resourceId)).toBe(true);
  expect(navigation.setCollapsed).not.toHaveBeenCalledWith(
    ['page-tree', 'new-node'],
    false
  );
});

test('batch uploads select every new resource and open their parent once', async () => {
  const { service, workbench, pages } = setup();
  const second = { ...child, nodeId: 'second-node', resourceId: 'second-file' };
  pages.set('folder-node', {
    page: { items: [child, second], nextCursor: null },
  });
  await service.reveal([child, second], service.begin().isCurrent, false);
  expect(workbench.openTreeResource.mock.calls).toEqual([[ancestor]]);
  expect(service.reveal$.value).toMatchObject({
    batch: true,
    nodeIds: ['new-node', 'second-node'],
  });
  expect(service.editorFocus$.value).toBe(null);
});

test('a single upload opens for preview without stealing input focus', async () => {
  const { service, workbench } = setup();
  await service.reveal([child], service.begin().isCurrent, false);
  expect(workbench.openTreeResource).toHaveBeenCalledOnce();
  expect(service.editorFocus$.value).toBe(null);
});
