/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { SidebarWorkspaces, WorkspaceRootDocs } from './workspaces';

const state = vi.hoisted(() => ({
  current: { id: 'one', flavour: 'local' },
  list: [
    { id: 'one', flavour: 'local' },
    { id: 'two', flavour: 'local' },
  ],
  docs: ['loose', 'filed', 'restricted'],
  linked: new Set(['filed']),
  ready: true,
  loading: false,
  jump: vi.fn(),
  close: vi.fn(),
  revalidate: vi.fn(),
  beginSwitch: vi.fn(),
  switchState: { phase: 'idle' } as
    | { phase: 'idle' }
    | {
        phase: 'preparing';
        switchId: string;
        targetWorkspaceId: string;
      },
  selector: vi.fn(),
  activeView: { id: 'active' },
  inactiveView: { id: 'inactive' },
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    onClick,
  }: PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
  IconButton: ({
    children,
    onClick,
    'aria-label': label,
  }: PropsWithChildren<{ onClick?: () => void; 'aria-label'?: string }>) => (
    <button aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
  Skeleton: () => <span>Loading</span>,
}));
vi.mock('@affine/core/modules/doc', () => ({ DocsService: 'docs' }));
vi.mock('@affine/core/modules/organize', () => ({
  OrganizeService: 'organize',
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: 'workspace',
  WorkspaceSwitchService: 'workspace-switch',
  WorkspacesService: 'workspaces',
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: 'workbench',
}));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (value: unknown) => value,
  useService: (
    service:
      | 'docs'
      | 'organize'
      | 'workspace'
      | 'workspace-switch'
      | 'workspaces'
      | 'workbench'
  ) =>
    ({
      docs: {
        list: {
          ['nonTrashDocsIds$']: state.docs,
          ['isReady$']: state.ready,
        },
      },
      organize: {
        folderTree: {
          ['linkedDocIds$']: state.linked,
          ['isLoading$']: state.loading,
        },
      },
      workspace: { workspace: state.current },
      'workspace-switch': {
        ['state$']: state.switchState,
        begin: state.beginSwitch,
        isPending: (workspaceId: string) =>
          state.switchState.phase === 'preparing' &&
          state.switchState.targetWorkspaceId === workspaceId,
      },
      workspaces: {
        list: { ['workspaces$']: state.list, revalidate: state.revalidate },
      },
      workbench: {
        workbench: {
          ['views$']: { value: [state.activeView, state.inactiveView] },
          ['activeView$']: { value: state.activeView },
          close: state.close,
          setWorkspaceSelectorOpen: state.selector,
        },
      },
    })[service],
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('../hooks/use-workspace-info', () => ({
  useWorkspaceInfo: (meta: { id: string }) => ({
    name: `Workspace ${meta.id}`,
  }),
}));
vi.mock('../hooks/use-navigate-helper', () => ({
  useNavigateHelper: () => ({ jumpToPage: state.jump }),
}));
vi.mock('../workspace-avatar', () => ({ WorkspaceAvatar: () => null }));
vi.mock('../guard', () => ({
  Guard: ({
    docId,
    children,
  }: {
    docId: string;
    children: (canRead: boolean) => React.ReactNode;
  }) => children(docId !== 'restricted'),
}));
vi.mock('@affine/core/modules/app-sidebar/views', () => ({
  AddPageButton: () => <button>Add document</button>,
}));
vi.mock('@affine/core/desktop/components/navigation-panel', () => ({
  NavigationPanelOrganize: ({ children }: PropsWithChildren) => (
    <div data-testid="files">{children}</div>
  ),
}));
vi.mock('@affine/core/desktop/components/navigation-panel/nodes/doc', () => ({
  NavigationPanelDocNode: ({ docId }: { docId: string }) => (
    <a href={`/${docId}`}>{docId}</a>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.current = { id: 'one', flavour: 'local' };
  state.docs = ['loose', 'filed', 'restricted'];
  state.linked = new Set(['filed']);
  state.ready = true;
  state.loading = false;
  state.switchState = { phase: 'idle' };
  state.beginSwitch.mockImplementation((workspaceId: string) => {
    state.switchState = {
      phase: 'preparing',
      switchId: `switch-${workspaceId}`,
      targetWorkspaceId: workspaceId,
    };
    return `switch-${workspaceId}`;
  });
});

describe('workspace sidebar', () => {
  test('shows the active tree, collapses it, and switches workspace through the existing route', () => {
    const view = render(<SidebarWorkspaces />);
    expect(screen.getAllByTestId('files')).toHaveLength(1);
    const current = screen.getByRole('button', { name: 'Workspace one' });
    fireEvent.click(current);
    expect(current.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('files')).toBeNull();
    fireEvent.click(current);
    expect(screen.getByTestId('files')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Workspace two' }));
    expect(state.beginSwitch).toHaveBeenCalledWith('two');
    expect(state.jump).toHaveBeenCalledWith('two', 'all');
    expect(state.close).not.toHaveBeenCalled();
    state.current = { id: 'two', flavour: 'local' };
    state.switchState = { phase: 'idle' };
    view.rerender(<SidebarWorkspaces />);
    expect(
      screen
        .getByRole('button', { name: 'Workspace two' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(current.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByTestId('files')).toHaveLength(1);
  });

  test('does not refresh the workspace list when the sidebar mounts', () => {
    render(<SidebarWorkspaces />);
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  test('highlights a pending target and prevents duplicate submission', () => {
    state.switchState = {
      phase: 'preparing',
      switchId: 'switch-two',
      targetWorkspaceId: 'two',
    };
    render(<SidebarWorkspaces />);

    const pending = screen.getByRole('button', {
      name: 'Workspace two, com.affine.loading',
    });
    expect(pending.getAttribute('aria-current')).toBe('true');
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    expect(state.jump).not.toHaveBeenCalled();
  });

  test('keeps workspace management reachable', () => {
    render(<SidebarWorkspaces />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.rootAppSidebar.manage-workspaces',
      })
    );
    expect(state.selector).toHaveBeenCalledWith(true);
  });

  test('shows unfiled readable documents and reacts to folder changes', () => {
    const view = render(<WorkspaceRootDocs />);
    expect(screen.getByRole('link', { name: 'loose' })).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'filed' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'restricted' })).toBeNull();
    state.linked = new Set(['loose']);
    view.rerender(<WorkspaceRootDocs />);
    expect(screen.queryByRole('link', { name: 'loose' })).toBeNull();
    expect(screen.getByRole('link', { name: 'filed' })).not.toBeNull();
  });

  test('distinguishes loading from an empty workspace', () => {
    state.ready = false;
    const view = render(<WorkspaceRootDocs />);
    expect(screen.getByRole('status')).not.toBeNull();
    state.ready = true;
    state.docs = [];
    view.rerender(<WorkspaceRootDocs />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.getByText('com.affine.rootAppSidebar.no-documents')
    ).not.toBeNull();
  });

  test('bounds the initial document tree and keeps remaining documents reachable', () => {
    state.docs = Array.from({ length: 51 }, (_, index) => `doc-${index}`);
    render(<WorkspaceRootDocs />);
    expect(screen.getAllByRole('link')).toHaveLength(50);
    fireEvent.click(
      screen.getByRole('button', { name: 'com.affine.quicksearch.load-more' })
    );
    expect(screen.getAllByRole('link')).toHaveLength(51);
  });
});
