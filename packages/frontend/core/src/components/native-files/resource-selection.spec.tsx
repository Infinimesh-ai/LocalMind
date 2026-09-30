/** @vitest-environment happy-dom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type * as Infra from '@toeverything/infra';
import type { ComponentProps, ReactNode } from 'react';
import { useContext } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  service: null as unknown,
  catalog: null as unknown,
  navigate: vi.fn(),
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/doc', () => ({ DocsService: class {} }));
vi.mock('@affine/core/modules/doc-display-meta', () => ({
  DocDisplayMetaService: class {},
}));
vi.mock('@affine/core/modules/docs-search', () => ({
  DocsSearchService: class {},
}));
vi.mock('@affine/core/modules/permissions', () => ({ GuardService: class {} }));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/core/modules/workspace-resources', () => ({
  WorkspaceLifecycleService: class {},
}));
vi.mock('@affine/core/modules/workspace-resources/use-resources', () => ({
  useWorkspaceResources: () => state.catalog,
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
  WorkbenchLink: ({
    to,
    onClick,
    ...props
  }: ComponentProps<'a'> & { to: string }) => (
    <a
      href={to}
      {...props}
      onClick={event => {
        onClick?.(event);
        if (!event.defaultPrevented) state.navigate();
      }}
    />
  ),
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof Infra>()),
  useService: () => state.service,
  useServiceOptional: () => undefined,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_, key) => (args?: { count?: string }) =>
          args?.count ? `selected: ${args.count}` : String(key),
      }
    ),
}));
vi.mock('@affine/component', async () => ({
  ...(await import('@affine/component/ui/checkbox')),
  Button: ({ children, disabled, onClick }: ComponentProps<'button'>) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    ...props
  }: Omit<ComponentProps<'input'>, 'onChange'> & {
    onChange: (value: string) => void;
  }) => (
    <input {...props} value={value} onChange={e => onChange(e.target.value)} />
  ),
  Modal: () => null,
  useConfirmModal: () => ({ openConfirmModal: vi.fn() }),
  ContextMenu: ({ children }: { children: ReactNode }) => children,
  Tooltip: ({ children }: { children: ReactNode }) => children,
  DragHandle: () => null,
  useDraggable: () => ({ dragRef: null, CustomDragPreview: () => null }),
}));
vi.mock('../explorer/docs-view/docs-list', () => ({
  DocsExplorer: ({
    renderItem,
    toolbar,
  }: {
    renderItem: (id: string, group: string) => ReactNode;
    toolbar: ReactNode;
  }) => {
    const context = useContext(DocExplorerContext);
    const groups = useLiveData(context.groups$);
    return (
      <>
        {groups.flatMap(group =>
          group.items.map(id => <div key={id}>{renderItem(id, group.key)}</div>)
        )}
        {toolbar}
      </>
    );
  },
}));
vi.mock('../explorer/docs-view/more-menu', () => ({
  MoreMenuButton: () => null,
  MoreMenuContent: () => null,
}));
vi.mock('../explorer/docs-view/properties', () => ({
  CardViewProperties: () => null,
  ListViewProperties: () => null,
}));
vi.mock('../explorer/quick-actions.constants', () => ({ quickActions: [] }));
vi.mock('../explorer/docs-view/quick-actions', () => ({
  QuickDeletePermanently: () => null,
  QuickRestore: () => null,
}));
vi.mock('../page-list/page-content-preview', () => ({
  PagePreview: () => null,
}));
vi.mock('./create-menu', () => ({ WorkspaceCreateMenu: () => null }));
vi.mock('./lifecycle-actions', () => ({ LifecycleActions: () => null }));
vi.mock('./workspace-actions', () => ({ WorkspaceNativeActions: () => null }));
vi.mock('./resource-drag', () => ({
  dragNativeResource: () => {},
  NativeResourceDropTarget: ({ children }: { children: ReactNode }) => children,
}));

import { LiveData, useLiveData } from '@toeverything/infra';

import {
  createDocExplorerContext,
  DocExplorerContext,
} from '../explorer/context';
import { DocListItem } from '../explorer/docs-view/doc-list-item';
import { WorkspaceResourceExplorer } from './resource-explorer';

beforeEach(() => {
  const record$ = new LiveData({
    title$: new LiveData('Page'),
    meta$: new LiveData({ title: 'Page' }),
    createdAt$: new LiveData(1),
    updatedAt$: new LiveData(1),
  });
  const absent$ = new LiveData(undefined);
  const title$ = new LiveData('Page');
  const icon$ = new LiveData(() => null);
  state.service = {
    workspace: { id: 'workspace', flavour: 'affine-cloud', docCollection: {} },
    // eslint-disable-next-line rxjs/finnish
    list: { doc$: (id: string) => (id.startsWith('page') ? record$ : absent$) },
    // eslint-disable-next-line rxjs/finnish
    title$: () => title$,
    // eslint-disable-next-line rxjs/finnish
    icon$: () => icon$,
    workbench: {
      openDoc: vi.fn(),
      openOffice: vi.fn(),
      openNativeFile: vi.fn(),
    },
    online: true,
    changes$: new LiveData(0),
    folders: async () => [
      {
        id: 'folder',
        title: 'Folder',
        trashedAt: '2026-09-28',
        children: [],
        canRestore: true,
        canDeletePermanently: true,
      },
    ],
    get: async () => ({ originalPaths: ['Root'] }),
    can: async () => true,
  };
  state.catalog = {
    items: [
      {
        id: 'file',
        workspaceId: 'workspace',
        kind: 'file',
        fileName: 'Image.png',
        title: 'Image.png',
        folderPaths: ['Root'],
        createdAt: '2026-09-28',
        updatedAt: '2026-09-28',
        canTrash: true,
        canRestore: true,
        canDeletePermanently: true,
      },
    ],
    ready: true,
    loading: false,
    service: { online: false },
  };
  state.navigate.mockClear();
});
afterEach(cleanup);
function mount(trash = false) {
  const context = createDocExplorerContext();
  context.groups$.next([{ key: 'today', items: ['page'] }]);
  render(
    <DocExplorerContext.Provider value={context}>
      <WorkspaceResourceExplorer trash={trash} />
    </DocExplorerContext.Provider>
  );
}
function checkbox(name: string) {
  return screen.getByRole('checkbox', { name }).querySelector('input')!;
}
function pageCheckbox() {
  return screen.getByTestId('doc-list-item-select').querySelector('input')!;
}

test('mixed selection retains earlier files and toggles each item without duplicates or navigation', async () => {
  mount();
  await screen.findByRole('button', { name: 'Image.png' });
  fireEvent.click(checkbox('Image.png'));
  expect(await screen.findByText('selected: 1')).toBeTruthy();
  fireEvent.click(pageCheckbox(), { detail: 0 });
  expect(await screen.findByText('selected: 2')).toBeTruthy();
  expect(state.navigate).not.toHaveBeenCalled();
  fireEvent.click(checkbox('Image.png'));
  expect(await screen.findByText('selected: 1')).toBeTruthy();
  fireEvent.click(checkbox('Image.png'));
  expect(await screen.findByText('selected: 2')).toBeTruthy();
  fireEvent.click(pageCheckbox());
  expect(await screen.findByText('selected: 1')).toBeTruthy();
  fireEvent.click(checkbox('Image.png'));
  expect(screen.queryByText(/selected:/)).toBeNull();
});

test('Trash file, document and folder checkboxes can all be deselected', async () => {
  mount(true);
  await screen.findByRole('button', { name: 'Folder' });
  for (const name of ['Image.png', 'Page', 'Folder']) {
    fireEvent.click(checkbox(name));
    expect(await screen.findByText('selected: 1')).toBeTruthy();
    fireEvent.click(checkbox(name));
    expect(screen.queryByText(/selected:/)).toBeNull();
  }
});

test('document checkbox shift selection preserves the existing range behavior', () => {
  const context = createDocExplorerContext();
  context.groups$.next([
    { key: 'group', items: ['page-a', 'native:file', 'page-b'] },
  ]);
  render(
    <DocExplorerContext.Provider value={context}>
      <DocListItem docId="page-a" groupId="group" />
      <DocListItem docId="page-b" groupId="group" />
    </DocExplorerContext.Provider>
  );
  const rows = screen.getAllByTestId('doc-list-item');
  fireEvent.click(within(rows[0]).getByTestId('affine-checkbox'));
  fireEvent.click(within(rows[1]).getByTestId('affine-checkbox'), {
    shiftKey: true,
  });
  expect(context.selectedDocIds$.value).toEqual([
    'page-a',
    'native:file',
    'page-b',
  ]);
  expect(state.navigate).not.toHaveBeenCalled();
});
