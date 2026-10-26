/** @vitest-environment happy-dom */
import { DNDContext } from '@affine/component/ui/dnd';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { NEVER } from 'rxjs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  title: '',
  kind: 'office' as 'office' | 'file',
  visible: true,
  trashed: false,
  loading: false,
  error: false,
  invalidate: vi.fn(),
  openOffice: vi.fn(),
  openNativeFile: vi.fn(),
  dragOptions: [] as unknown[],
}));

vi.mock('@affine/component', async () => ({
  ContextMenu: ({ children }: PropsWithChildren) => children,
  IconRenderer: ({ fallback }: { fallback: ReactNode }) => fallback,
  useDraggable: (options: () => unknown) => {
    state.dragOptions.push(options());
    return { CustomDragPreview: () => null };
  },
  // Keep the real hook and adapters: a false callback still registers native
  // external drags, whereas a literal false must leave no DOM registration.
  useDropTarget: (await import('@affine/component/ui/dnd')).useDropTarget,
  DropIndicator: ({ instruction }: { instruction: { type: string } }) => (
    <div data-testid="drop-indicator" data-type={instruction.type} />
  ),
}));
vi.mock('@affine/core/components/guard', () => ({ Guard: () => null }));
vi.mock('@affine/core/modules/app-sidebar', () => ({
  AppSidebarService: class {},
}));
vi.mock('@affine/core/modules/explorer-icon/services/explorer-icon', () => ({
  ExplorerIconService: class {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/core/modules/storage', () => ({ NbstoreService: class {} }));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
  WorkbenchLink: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@affine/core/utils', () => ({ extractEmojiIcon: vi.fn() }));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (value: unknown) => value,
  useService: () => ({
    workspace: { id: 'workspace' },
    workbench: state,
    realtime: { subscribe: () => NEVER },
  }),
}));
vi.mock('@affine/core/modules/workspace-resources/use-resources', () => ({
  useWorkspaceResources: () => ({
    items: state.visible
      ? [
          {
            id: 'resource',
            kind: state.kind,
            title: state.title,
            canMove: true,
            trashedAt: state.trashed ? '2026-10-08T00:00:00Z' : null,
          },
        ]
      : [],
    loading: state.loading,
    error: state.error,
    service: { invalidate: state.invalidate },
  }),
}));
vi.mock('@affine/core/components/native-files/resource-drag', () => ({
  dragNativeResource: vi.fn(),
  nativeResourceDirectoryDragData: () => ({
    'application/x-localmind-directory-node': 'true',
  }),
}));
vi.mock('@affine/core/components/native-files/workspace-actions', () => ({
  WorkspaceNativeActions: () => <button>Manage file</button>,
}));
vi.mock('@affine/core/desktop/components/navigation-panel', async () => ({
  ...(await import('./context')),
}));
vi.mock('@affine/core/mobile/components/swipe-menu', () => ({
  SwipeMenu: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@affine/core/mobile/components/navigation/menu-host', () => ({
  useMobileNavigationMenuHost: () => ({ open: vi.fn() }),
  MobileNavigationMenuItems: () => null,
}));

import { NavigationPanelTreeNode as MobileTreeNode } from '@affine/core/mobile/components/navigation/tree/node';

import { NavigationPanelNativeFileNode } from '../nodes/folder/native-file';
import { NavigationPanelTreeNode as DesktopTreeNode } from './node';
import * as styles from './node.css';

const externalDnd = { fromExternalData: () => ({}) };

test('native tree drops measure the title row, reuse its indicator and disable the second drop handler', () => {
  const ref = vi.fn();
  render(
    <DesktopTreeNode
      name="Parent"
      collapsed={false}
      setCollapsed={vi.fn()}
      rowRef={ref}
      dropInstruction={{
        type: 'make-child',
        currentLevel: 0,
        indentPerLevel: 20,
      }}
    >
      <span>Child subtree</span>
    </DesktopTreeNode>,
    {
      wrapper: ({ children }) => (
        <DNDContext.Provider value={externalDnd}>
          {children}
        </DNDContext.Provider>
      ),
    }
  );
  const row = ref.mock.calls.find(
    ([element]) => element
  )?.[0] as HTMLDivElement;
  expect(row.textContent).toContain('Parent');
  expect(row.textContent).not.toContain('Child subtree');
  expect(screen.getByTestId('drop-indicator').dataset.type).toBe('make-child');
  expect(Object.hasOwn(row.dataset, 'dropTargetForElement')).toBe(false);
  expect(Object.hasOwn(row.dataset, 'dropTargetForExternal')).toBe(false);
  expect(row.classList.contains(styles.draggedOverEffect)).toBe(false);
});

test('switching from legacy to controlled drops unregisters both real adapters', () => {
  const ref = vi.fn();
  const props = {
    name: 'Folder',
    collapsed: true,
    setCollapsed: vi.fn(),
    rowRef: ref,
  };
  const view = render(<DesktopTreeNode {...props} />, {
    wrapper: ({ children }) => (
      <DNDContext.Provider value={externalDnd}>{children}</DNDContext.Provider>
    ),
  });
  const row = ref.mock.calls.find(
    ([element]) => element
  )?.[0] as HTMLDivElement;
  expect(Object.hasOwn(row.dataset, 'dropTargetForElement')).toBe(true);
  expect(Object.hasOwn(row.dataset, 'dropTargetForExternal')).toBe(true);
  view.rerender(<DesktopTreeNode {...props} dropInstruction={null} />);
  expect(Object.hasOwn(row.dataset, 'dropTargetForElement')).toBe(false);
  expect(Object.hasOwn(row.dataset, 'dropTargetForExternal')).toBe(false);
  expect(row.classList.contains(styles.draggedOverEffect)).toBe(false);
  view.rerender(<DesktopTreeNode {...props} />);
  expect(Object.hasOwn(row.dataset, 'dropTargetForElement')).toBe(true);
  expect(row.classList.contains(styles.draggedOverEffect)).toBe(true);
});

test('container drops highlight the row without rendering a rectangular insertion outline', () => {
  const view = render(
    <DesktopTreeNode
      name="Parent"
      collapsed
      setCollapsed={vi.fn()}
      dropInsideLabel="Move into Parent"
      dropInstruction={{
        type: 'make-child',
        currentLevel: 0,
        indentPerLevel: 20,
      }}
    />
  );
  expect(screen.queryByTestId('drop-indicator')).toBeNull();
  expect(
    view.container.querySelector('[data-drop-inside="true"]')
  ).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Move into Parent');
});

test('a controlled below indicator is anchored after the subtree, not under the title', () => {
  const ref = vi.fn();
  render(
    <DesktopTreeNode
      name="Parent"
      collapsed={false}
      setCollapsed={vi.fn()}
      rowRef={ref}
      dropInstruction={{
        type: 'reorder-below',
        currentLevel: 0,
        indentPerLevel: 20,
      }}
    >
      <span>Child subtree</span>
    </DesktopTreeNode>
  );
  const indicator = screen.getByTestId('drop-indicator');
  const row = ref.mock.calls.find(
    ([element]) => element
  )?.[0] as HTMLDivElement;
  expect(row.contains(indicator)).toBe(false);
  expect(
    indicator.parentElement?.previousElementSibling?.textContent
  ).toContain('Child subtree');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  state.kind = 'office';
  state.visible = true;
  state.trashed = false;
  state.loading = false;
  state.error = false;
});

test.each([
  ['office', 'document.docx'],
  ['office', 'table.xlsx'],
  ['office', 'slides.pptx'],
  ['office', 'document.pdf'],
  ['file', 'notes.txt'],
  ['file', 'notes.md'],
  ['file', 'data.csv'],
  ['file', 'data.json'],
  ['file', 'image.png'],
  ['file', 'audio.mp3'],
  ['file', 'video.mp4'],
  ['file', 'archive.zip'],
] as const)(
  '%s resource %s opens without a reference expander',
  (kind, title) => {
    state.kind = kind;
    state.title = title;
    render(<NavigationPanelNativeFileNode resourceId="resource" kind={kind} />);
    expect(
      screen.queryByTestId('navigation-panel-collapsed-button')
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'Manage file' })).toBeTruthy();
    fireEvent.click(screen.getByText(title));
    expect(
      kind === 'office' ? state.openOffice : state.openNativeFile
    ).toHaveBeenCalledWith('resource');
  }
);

test('native rows retain the last authorized catalog during a refresh and disappear with its removal', () => {
  state.title = 'shared.docx';
  const view = render(
    <NavigationPanelNativeFileNode resourceId="resource" kind="office" />
  );
  state.loading = true;
  view.rerender(
    <NavigationPanelNativeFileNode resourceId="resource" kind="office" />
  );
  expect(screen.getByText(state.title)).toBeTruthy();
  state.visible = false;
  view.rerender(
    <NavigationPanelNativeFileNode resourceId="resource" kind="office" />
  );
  expect(screen.queryByText(state.title)).toBeNull();
});

test('native rows fail closed for catalog denial, trash and another resource kind', () => {
  state.title = 'shared.docx';
  const node = (
    <NavigationPanelNativeFileNode resourceId="resource" kind="office" />
  );
  const view = render(node);
  for (const denial of ['error', 'trashed', 'kind'] as const) {
    state.error = denial === 'error';
    state.trashed = denial === 'trashed';
    state.kind = denial === 'kind' ? 'file' : 'office';
    view.rerender(
      <NavigationPanelNativeFileNode resourceId="resource" kind="office" />
    );
    expect(screen.queryByText(state.title)).toBeNull();
  }
});

test.each([
  ['desktop', DesktopTreeNode],
  ['mobile', MobileTreeNode],
] as const)(
  '%s hides leaf disclosure and preserves expandable nodes',
  (_, TreeNode) => {
    const collapse = vi.fn();
    const open = vi.fn();
    const view = render(
      <TreeNode
        name="Leaf"
        collapsed
        collapsible={false}
        setCollapsed={collapse}
        onClick={open}
      />
    );
    expect(
      screen.queryByTestId('navigation-panel-collapsed-button')
    ).toBeNull();
    fireEvent.click(screen.getByText('Leaf'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(collapse).not.toHaveBeenCalled();
    view.rerender(<TreeNode name="Folder" collapsed setCollapsed={collapse} />);
    fireEvent.click(screen.getByTestId('navigation-panel-collapsed-button'));
    expect(collapse).toHaveBeenCalledWith(false);
  }
);

test('native folder rows carry both resource identity and directory node identity for reordering', () => {
  state.dragOptions.length = 0;
  render(
    <NavigationPanelNativeFileNode
      resourceId="resource"
      kind="office"
      location={{
        at: 'navigation-panel:organize:folder-node',
        nodeId: 'placement',
      }}
      reorderable
    />
  );
  expect(state.dragOptions.at(-1)).toEqual(
    expect.objectContaining({
      canDrag: true,
      data: expect.objectContaining({
        entity: { type: 'doc', id: 'resource' },
        from: {
          at: 'navigation-panel:organize:folder-node',
          nodeId: 'placement',
        },
        nativeResource: {
          workspaceId: 'workspace',
          resourceId: 'resource',
          kind: 'office',
        },
      }),
    })
  );
});

test('reserved action space opens the row while action buttons do not', () => {
  const open = vi.fn();
  const manage = vi.fn();
  const view = render(
    <DesktopTreeNode
      name="Document"
      collapsed
      collapsible={false}
      setCollapsed={vi.fn()}
      onClick={open}
      operations={[
        {
          index: 0,
          inline: true,
          view: <button onClick={manage}>Manage</button>,
        },
      ]}
    />
  );

  const actionSpace = view.container.querySelector(`.${styles.postfix}`);
  expect(actionSpace).not.toBeNull();
  fireEvent.click(actionSpace!);
  expect(open).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
  expect(manage).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});
