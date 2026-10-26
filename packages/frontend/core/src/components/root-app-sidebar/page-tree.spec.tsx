/** @vitest-environment happy-dom */
import type { WorkspacePageTreeService } from '@affine/core/modules/organize';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import type { PropsWithChildren, ReactNode } from 'react';
import { of } from 'rxjs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  service: null as unknown,
  toast: vi.fn(),
}));
vi.mock('@affine/component', () => ({
  Button: ({ children }: PropsWithChildren) => <button>{children}</button>,
  MenuItem: () => null,
  MenuSub: () => null,
  Modal: () => null,
  toast: state.toast,
  usePromptModal: () => ({}),
  useConfirmModal: () => ({}),
}));
vi.mock('@affine/core/desktop/components/navigation-panel/tree', () => ({
  NavigationPanelTreeRoot: ({ children }: PropsWithChildren) => children,
  NavigationPanelTreeNode: ({
    children,
    name,
    collapsed,
    rowRef,
    operations,
  }: PropsWithChildren<{
    name: string;
    collapsed: boolean;
    rowRef: (element: HTMLDivElement | null) => void;
    operations: { index: number; inline?: boolean; view: ReactNode }[];
  }>) => (
    <>
      <div data-row={name} ref={rowRef}>
        {name}
      </div>
      <div data-testid={`${name}-inline`}>
        {operations
          .filter(operation => operation.inline)
          .map(operation => (
            <span key={operation.index}>{operation.view}</span>
          ))}
      </div>
      <div data-testid={`${name}-menu`}>
        {operations
          .filter(operation => !operation.inline)
          .map((operation, index) => (
            <span key={index}>{operation.view}</span>
          ))}
      </div>
      {!collapsed && children}
    </>
  ),
}));
vi.mock(
  '@affine/core/desktop/components/navigation-panel/nodes/folder/sort-menu',
  () => ({
    FolderSortButton: () => null,
    FolderSortMenu: ({ onChange }: { onChange: (mode: string) => void }) => (
      <button data-testid="child-sort" onClick={() => onChange('name-asc')}>
        Sort children
      </button>
    ),
  })
);
vi.mock('@affine/core/modules/doc/services/docs', () => ({
  DocsService: class {},
}));
vi.mock('@affine/core/modules/navigation-panel', () => ({
  NavigationPanelService: class {},
  CreatedResourceService: class {},
}));
vi.mock('@affine/core/modules/organize', () => ({
  WorkspacePageTreeService: class {},
}));
vi.mock('@affine/core/modules/organize/stores/folder-sorting', () => ({
  FolderSortingStore: class {},
}));
vi.mock('@affine/core/modules/template-doc/view/template-list-menu', () => ({
  TemplateListMenuContentScrollable: () => null,
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/graphql', () => ({
  WORKSPACE_PAGE_TREE_CONTRACT: 'localmind-page-tree/v2',
  workspaceDocumentTypes: [],
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => state.service,
}));
vi.mock('../native-files/create-menu', () => ({
  WorkspaceCreateMenu: () => null,
}));
vi.mock('../native-files/resource-rows', () => ({
  ResourceTypeIcon: () => null,
}));
vi.mock('../page-tree/created-resource', () => ({
  useCreatedResourceFocus: () => () => {},
  useCreatedResourceNavigation: () => () => {},
}));
vi.mock('../page-tree/load-error', () => ({ PageTreeLoadError: () => null }));

import { LiveData } from '@toeverything/infra';

import { WorkspacePageTree } from './page-tree';

const item = (
  nodeId: string,
  parentNodeId: string | null = null,
  isContainer = true
) => ({
  nodeId,
  resourceId: nodeId,
  title: nodeId,
  parentNodeId,
  isContainer,
  canOrganize: true,
  kind: 'doc',
  documentType: 'doc',
});
const a = item('A'),
  b = item('B'),
  c = item('C', null, false),
  d = item('D');
const child1 = item('child1', 'B', false),
  child2 = item('child2', 'B', false);
const bounds: Record<string, [number, number, number?]> = {
  A: [10, 40],
  B: [42, 72, 142],
  child1: [74, 104],
  child2: [106, 136],
  C: [144, 174],
  D: [176, 206],
};
const execute = vi.fn().mockResolvedValue({}),
  load = vi.fn(),
  setMode = vi.fn();

beforeEach(() => {
  execute.mockReset().mockResolvedValue({});
  load.mockReset().mockResolvedValue(undefined);
  setMode.mockReset();
  state.toast.mockReset();
  const page = (parent: typeof a | null, items: (typeof a)[]) =>
    new LiveData({
      page: {
        parent,
        items,
        ancestors: [],
        revision: 1,
        authorizationRevision: 'auth',
        nextCursor: null,
      },
      loading: false,
      error: null,
    });
  const layers = new Map([
    [null, page(null, [a, b, c, d])],
    ['A', page(a, [item('childA1', 'A', false), item('childA2', 'A', false)])],
    ['B', page(b, [child1, child2])],
  ]);
  state.service = {
    workspace: { id: 'workspace' },
    workbench: {},
    accountGeneration: 1,
    writeBlocked$: new LiveData(false),
    syncing$: new LiveData(false),
    undo$: new LiveData(null),
    reveal$: new LiveData(null),
    ready$: new LiveData(true),
    ['collapsed$']: (path: string[]) => new LiveData(path[1] !== 'B'),
    setCollapsed: vi.fn(),
    ['layer$']: (parent: string | null) => layers.get(parent) ?? page(null, []),
    observe: () => () => {},
    key: (parent: string | null) => parent ?? 'root',
    watchMode: () => of('manual'),
    setMode,
    execute,
    load,
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const id = this.dataset.row ?? this.dataset.pageTreeNodeId;
      const [top, bottom, subtreeBottom] = bounds[id ?? ''] ?? [0, 220];
      const end = this.dataset.row ? bottom : (subtreeBottom ?? bottom);
      return {
        top,
        bottom: end,
        height: end - top,
        left: 0,
        right: 200,
        width: 200,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function node(id: string) {
  return document.querySelector<HTMLElement>(
    `[data-page-tree-node-id="${id}"]`
  )!;
}
function start(id: string) {
  const dataTransfer = new DataTransfer();
  fireEvent.dragStart(node(id), { dataTransfer });
  return dataTransfer;
}
function over(id: string, clientY: number, dataTransfer: DataTransfer) {
  dragAt(
    node(id).querySelector('[data-row]')!,
    'dragover',
    dataTransfer,
    clientY
  );
}
function dragAt(
  target: Element,
  type: 'dragenter' | 'dragover' | 'drop',
  dataTransfer: DataTransfer,
  clientY: number
) {
  // happy-dom's DragEvent omits MouseEvent coordinates.
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
  });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  fireEvent(target, event);
}
function activeTargets() {
  return document.querySelectorAll('[data-page-tree-drop-placement]');
}

test('containers with at least two children sort from their menu; empty containers and leaves do not', () => {
  render(<WorkspacePageTree />);
  for (const id of ['A', 'B']) {
    expect(
      screen
        .getByTestId(`${id}-inline`)
        .querySelector('[data-testid="child-sort"]')
    ).toBeNull();
    expect(
      screen
        .getByTestId(`${id}-menu`)
        .querySelector('[data-testid="child-sort"]')
    ).not.toBeNull();
  }
  for (const id of ['C', 'D']) {
    expect(
      screen
        .getByTestId(`${id}-menu`)
        .querySelector('[data-testid="child-sort"]')
    ).toBeNull();
  }
  fireEvent.click(screen.getByTestId('B-menu').querySelector('button')!);
  expect(setMode).toHaveBeenCalledWith('B', 'name-asc');
  expect(execute).not.toHaveBeenCalled();
});

test('child sorting appears at two children and hides below two while the container stays collapsed', () => {
  const layer$ = (state.service as WorkspacePageTreeService).layer$('A');
  const loaded = layer$.value;
  layer$.next({ loading: true, error: false });
  render(<WorkspacePageTree />);
  const entry = () =>
    screen.getByTestId('A-menu').querySelector('[data-testid="child-sort"]');
  expect(entry()).toBeNull();
  act(() => layer$.next(loaded));
  expect(entry()).not.toBeNull();
  act(() =>
    layer$.next({
      ...loaded,
      page: { ...loaded.page!, items: loaded.page!.items.slice(0, 1) },
    })
  );
  expect(entry()).toBeNull();
  act(() => layer$.next({ ...loaded, page: { ...loaded.page!, items: [] } }));
  expect(entry()).toBeNull();
  act(() => layer$.next(loaded));
  expect(entry()).not.toBeNull();
  act(() => layer$.next({ ...loaded, error: true }));
  expect(entry()).toBeNull();
});

test('only one target survives switching rows and entering an expanded child', () => {
  render(<WorkspacePageTree />);
  const transfer = start('C');
  over('A', 39, transfer);
  expect(node('B').dataset.pageTreeDropPlacement).toBe('before');
  over('B', 60, transfer);
  expect(activeTargets()).toHaveLength(1);
  expect(node('B').dataset.pageTreeDropPlacement).toBe('inside');
  over('child1', 75, transfer);
  // The old parent can receive dragleave after its child's dragover.
  fireEvent(
    node('B'),
    new MouseEvent('dragleave', {
      bubbles: true,
      relatedTarget: node('child1'),
    })
  );
  expect(activeTargets()).toHaveLength(1);
  expect(node('child1').dataset.pageTreeDropPlacement).toBe('before');
});

test('self, original slot and root whitespace drops do not refresh, write or switch sorting', () => {
  render(<WorkspacePageTree />);
  const root = screen.getByTestId('page-tree-root-drop');
  const transfer = start('C');
  for (let index = 0; index < 5; index++) {
    over('C', 173, transfer);
    fireEvent.dragOver(root, { dataTransfer: transfer });
    expect(root.dataset.active).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
  }
  over('D', 177, transfer);
  expect(activeTargets()).toHaveLength(0);
  dragAt(node('D'), 'drop', transfer, 177);
  expect(load).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(setMode).not.toHaveBeenCalled();
});

test('root hint stays in the reserved footer and clears when entering a row', async () => {
  render(<WorkspacePageTree />);
  const root = screen.getByTestId('page-tree-root-drop');
  const transfer = start('child1');
  fireEvent.dragOver(root, { dataTransfer: transfer });
  expect(root.dataset.active).toBe('true');
  expect(root.contains(screen.getByRole('status'))).toBe(true);
  expect(root.parentElement?.lastElementChild).toBe(root);
  over('A', 25, transfer);
  expect(root.dataset.active).toBe('false');
  expect(node('A').dataset.pageTreeDropPlacement).toBe('inside');
  fireEvent.dragOver(root, { dataTransfer: transfer });
  expect(activeTargets()).toHaveLength(0);
  fireEvent.drop(root, { dataTransfer: transfer });
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith({
      action: 'move',
      nodeId: 'child1',
      parentNodeId: null,
    })
  );
  expect(root.dataset.active).toBe('false');
});

test('sweeping the last child, parent tail and next row keeps the same root insertion', async () => {
  render(<WorkspacePageTree />);
  const transfer = start('A');
  for (let y = 131; y < 150; y++) {
    // Native events can target the last child, an ancestor or the next sibling.
    const target = y <= 136 ? node('child2') : y <= 142 ? node('B') : node('C');
    dragAt(target, y % 2 ? 'dragenter' : 'dragover', transfer, y);
    expect(activeTargets()).toHaveLength(1);
    expect(node('C').dataset.pageTreeDropPlacement).toBe('before');
    fireEvent(
      target,
      new MouseEvent('dragleave', {
        bubbles: true,
        relatedTarget: node('C'),
      })
    );
    expect(node('C').dataset.pageTreeDropPlacement).toBe('before');
  }
  dragAt(node('B'), 'drop', transfer, 141);
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith(
      {
        action: 'move',
        nodeId: 'A',
        parentNodeId: null,
        siblingOrder: ['B', 'A', 'C', 'D'],
      },
      { revision: 1, authorizationRevision: 'auth' }
    )
  );
});

test('container centers move inside and leaf centers cannot accept children', async () => {
  render(<WorkspacePageTree />);
  const transfer = start('D');
  over('C', 160, transfer);
  expect(activeTargets()).toHaveLength(0);
  over('A', 25, transfer);
  dragAt(node('A'), 'drop', transfer, 25);
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith({
      action: 'move',
      nodeId: 'D',
      parentNodeId: 'A',
    })
  );
  expect(activeTargets()).toHaveLength(0);
});

test('a parent cannot move into its descendants', () => {
  render(<WorkspacePageTree />);
  const transfer = start('B');
  over('child1', 75, transfer);
  expect(activeTargets()).toHaveLength(0);
});

test('inside moves still reach the authority when the cached source parent matches', async () => {
  render(<WorkspacePageTree />);
  const transfer = start('child1');
  over('B', 60, transfer);
  dragAt(node('B'), 'drop', transfer, 60);
  await waitFor(() =>
    expect(execute).toHaveBeenCalledWith({
      action: 'move',
      nodeId: 'child1',
      parentNodeId: 'B',
    })
  );
});

test.each(['Escape', 'blur', 'dragend'])(
  '%s clears all drag feedback',
  event => {
    render(<WorkspacePageTree />);
    const transfer = start('C');
    over('A', 25, transfer);
    expect(activeTargets()).toHaveLength(1);
    if (event === 'Escape') fireEvent.keyDown(window, { key: event });
    else fireEvent(window, new Event(event));
    expect(activeTargets()).toHaveLength(0);
    over('A', 25, transfer);
    expect(activeTargets()).toHaveLength(0);
  }
);

test('failed moves report an error and leave no stale drop target', async () => {
  execute.mockRejectedValueOnce(new Error('Permission changed'));
  render(<WorkspacePageTree />);
  const transfer = start('C');
  over('A', 25, transfer);
  dragAt(node('A'), 'drop', transfer, 25);
  await waitFor(() => expect(state.toast).toHaveBeenCalledTimes(1));
  expect(activeTargets()).toHaveLength(0);
});
