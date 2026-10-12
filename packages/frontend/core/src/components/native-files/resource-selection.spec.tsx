/** @vitest-environment happy-dom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  confirm: vi.fn(),
}));
vi.mock('@affine/core/components/providers/current-server-scope', () => ({
  useCurrentServerService: () => undefined,
}));
vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: class {},
  WorkspaceServerService: class {},
}));
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
  WorkspaceResourcesService: class {},
  WorkspaceResourceTagsService: class {},
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
  useTranslation: () => ({ i18n: { language: 'zh-Hans' } }),
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
  ...(await import('@affine/component/ui/menu')),
  ...(await import('@affine/component/ui/checkbox')),
  Button: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
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
  useConfirmModal: () => ({ openConfirmModal: state.confirm }),
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
import { ResourceListLayout } from './resource-list-layout';
import {
  ResourceInlineTags,
  ResourceMetadata,
  ResourceTime,
} from './resource-metadata';

beforeEach(() => {
  const record$ = new LiveData({
    id: 'page',
    createdBy$: new LiveData('creator'),
    displayUpdate$: new LiveData({ at: 2, actor: 'user', by: 'editor' }),
    primaryMode$: new LiveData('page'),
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
    list: {
      // eslint-disable-next-line rxjs/finnish
      doc$: (id: string) => (id.startsWith('page') ? record$ : absent$),
      docs$: new LiveData([record$.value]),
      isAvailable$: new LiveData(true),
    },
    // eslint-disable-next-line rxjs/finnish
    title$: () => title$,
    // eslint-disable-next-line rxjs/finnish
    icon$: () => icon$,
    workbench: {
      openDoc: vi.fn(),
      openOffice: vi.fn(),
      openNativeFile: vi.fn(),
    },
    tagList: { tagMetas$: new LiveData([]) },
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
    change: vi.fn(async () => true),
    // The mock keeps the production observable method name.
    // eslint-disable-next-line rxjs/finnish
    can$: () => new LiveData(false),
  };
  state.catalog = {
    items: [
      {
        id: 'file',
        workspaceId: 'workspace',
        kind: 'file',
        documentType: 'image',
        mimeType: 'image/png',
        createdBy: 'creator',
        lastUpdatedAt: '2026-09-28',
        lastUpdatedBy: 'editor',
        lastUpdateActor: 'user',
        tags: [],
        canEditTags: false,
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
    service: { online: false, invalidate: vi.fn() },
  };
  state.navigate.mockClear();
  state.confirm.mockClear();
});
afterEach(cleanup);
function mount(trash = false, mixed = false) {
  const context = createDocExplorerContext(
    mixed
      ? {
          resourceProperties: {
            tags: true,
            created: true,
            updated: true,
            documentType: true,
          },
          groupBy: undefined,
        }
      : undefined
  );
  context.groups$.next([{ key: 'today', items: ['page'] }]);
  render(
    <DocExplorerContext.Provider value={context}>
      <WorkspaceResourceExplorer trash={trash} />
    </DocExplorerContext.Provider>
  );
  return context;
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
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.resources.multiSelect',
    })
  );
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
  expect(screen.getByText('selected: 0')).toBeTruthy();
});

test('Trash file, document and folder checkboxes can all be deselected', async () => {
  mount(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.resources.multiSelect',
    })
  );
  await screen.findByRole('button', { name: 'Folder' });
  for (const name of ['Image.png', 'Page', 'Folder']) {
    fireEvent.click(checkbox(name));
    expect(await screen.findByText('selected: 1')).toBeTruthy();
    fireEvent.click(checkbox(name));
    expect(screen.getByText('selected: 0')).toBeTruthy();
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

test('the mixed renderer applies all four property switches equally to documents and native resources', async () => {
  const context = mount(false, true);
  await screen.findByRole('button', { name: 'Image.png' });
  await screen.findByRole('button', { name: 'Page' });
  expect(
    screen.getAllByLabelText(
      'com.affine.localmind.resource-display.created.tip'
    )
  ).toHaveLength(2);
  expect(
    screen.getAllByLabelText(
      'com.affine.localmind.resource-display.updated.tip'
    )
  ).toHaveLength(2);
  for (const key of ['tags', 'created', 'updated', 'documentType'] as const) {
    act(() =>
      context.displayPreference$.next({
        ...context.displayPreference$.value,
        showDocIcon: false,
        resourceProperties: {
          tags: false,
          created: false,
          updated: false,
          documentType: false,
          [key]: true,
        },
      })
    );
    const label =
      key === 'created' || key === 'updated' ? `${key}.tip` : `property.${key}`;
    expect(
      screen.getAllByLabelText(`com.affine.localmind.resource-display.${label}`)
    ).toHaveLength(2);
  }
  expect(state.navigate).not.toHaveBeenCalled();
});

test('compact rows keep named file buttons and type icons without empty tag or duplicate type text', async () => {
  mount(false, true);
  expect(await screen.findByRole('button', { name: 'Image.png' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Page' })).toBeTruthy();
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(
    screen.queryByRole('button', { name: 'com.affine.header.option.add-tag' })
  ).toBeNull();
  expect(
    screen.queryByText('com.affine.localmind.resource-display.noTags')
  ).toBeNull();
  expect(
    screen.queryByLabelText(
      'com.affine.localmind.resource-display.property.documentType'
    )
  ).toBeNull();
});

test('compact timestamps keep a stable numeric format, full accessible dates, and cross-year context', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10));
  try {
    const current = new Date(2026, 9, 9, 22, 22).getTime();
    const previous = new Date(2025, 8, 8, 9, 5).getTime();
    const { container } = render(
      <>
        <ResourceTime value={current} compact />
        <ResourceTime value={previous} compact />
      </>
    );
    const times = container.querySelectorAll('time');
    expect(times[0].textContent).toBe('10-09 22:22');
    expect(times[1].textContent).toBe('2025-09-08 09:05');
    expect(times[0].getAttribute('dateTime')).toBe(
      new Date(current).toISOString()
    );
    expect(times[0].getAttribute('aria-label')).toContain('2026');
  } finally {
    vi.useRealTimers();
  }
});

test('column labels follow enabled metadata and empty tags remain editable beside the title', () => {
  const context = createDocExplorerContext({
    view: 'list',
    resourceProperties: {
      tags: true,
      created: true,
      updated: false,
      documentType: true,
    },
  });
  const editTags = vi.fn();
  const { container } = render(
    <DocExplorerContext.Provider value={context}>
      <ResourceListLayout enabled>
        <ResourceInlineTags empty>
          <button onClick={editTags}>Add tag</button>
        </ResourceInlineTags>
        <ResourceMetadata
          properties={context.displayPreference$.value.resourceProperties!}
          tags={[]}
          createdAt={null}
          updatedAt={null}
          documentType="xlsx"
        />
      </ResourceListLayout>
    </DocExplorerContext.Provider>
  );
  expect(
    screen.getByText('com.affine.page-properties.property.createdBy')
  ).toBeTruthy();
  expect(
    screen.queryByText('com.affine.page-properties.property.updatedBy')
  ).toBeNull();
  expect(container.querySelector('[style*="createdBy"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  expect(editTags).toHaveBeenCalledOnce();
  act(() =>
    context.displayPreference$.next({
      ...context.displayPreference$.value,
      resourceProperties: {
        tags: false,
        created: false,
        updated: true,
        documentType: false,
      },
    })
  );
  expect(
    screen.queryByText('com.affine.page-properties.property.createdBy')
  ).toBeNull();
  expect(
    screen.getByText('com.affine.page-properties.property.updatedBy')
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull();
});

test('selection is opt-in, title clicks select without opening, and Escape exits selection', async () => {
  mount(false, true);
  await screen.findByRole('button', { name: 'Image.png' });
  expect(screen.queryByRole('checkbox', { name: 'Image.png' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Page' })).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.resources.multiSelect',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Image.png' }));
  expect(await screen.findByText('selected: 1')).toBeTruthy();
  expect(checkbox('Image.png').checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Page' }));
  expect(await screen.findByText('selected: 2')).toBeTruthy();
  const toolbar = screen.getByRole('toolbar');
  expect(
    within(toolbar).getByRole('button', {
      name: 'com.affine.localmind.resources.actions',
    })
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Page' }), {
    key: 'Escape',
  });
  expect(screen.queryByRole('checkbox', { name: 'Page' })).toBeNull();
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(state.navigate).not.toHaveBeenCalled();
});

test('partial batch failure keeps only failed resources selected and leaves selection mode open', async () => {
  mount(false, true);
  await screen.findByRole('button', { name: 'Image.png' });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.resources.multiSelect',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Image.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Page' }));
  await screen.findByText('selected: 2');
  fireEvent.keyDown(
    screen.getByRole('button', {
      name: 'com.affine.localmind.resources.actions',
    }),
    { key: 'Enter' }
  );
  const remove = screen.getByRole('menuitem', {
    name: 'com.affine.localmind.resources.moveToTrash',
  });
  await waitFor(() =>
    expect(remove.getAttribute('aria-disabled')).not.toBe('true')
  );
  fireEvent.click(remove);
  await act(async () => {
    await state.confirm.mock.calls[0][0].onConfirm();
  });
  expect(await screen.findByText('selected: 1')).toBeTruthy();
  expect(checkbox('Image.png').checked).toBe(true);
  expect(checkbox('Page').checked).toBe(false);
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
});
