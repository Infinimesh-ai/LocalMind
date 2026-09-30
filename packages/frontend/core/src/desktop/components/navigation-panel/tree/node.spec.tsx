/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { NEVER } from 'rxjs';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  title: '',
  openOffice: vi.fn(),
  openNativeFile: vi.fn(),
}));

vi.mock('@affine/component', () => ({
  ContextMenu: ({ children }: PropsWithChildren) => children,
  IconRenderer: ({ fallback }: { fallback: ReactNode }) => fallback,
  useDraggable: () => ({ CustomDragPreview: () => null }),
  useDropTarget: () => ({}),
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
vi.mock('@affine/i18n', () => ({ useI18n: () => ({}) }));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (value: unknown) => value,
  useService: () => ({
    workspace: { id: 'workspace' },
    workbench: state,
    realtime: { subscribe: () => NEVER },
  }),
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: () => ({
    data: { workspaceNativeResource: { title: state.title } },
    mutate: vi.fn(),
  }),
}));
vi.mock('@affine/core/components/native-files/resource-drag', () => ({
  dragNativeResource: vi.fn(),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
