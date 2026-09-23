/** @vitest-environment happy-dom */
/* eslint-disable rxjs/finnish -- Service mocks keep the production property names. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentType, PropsWithChildren, ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

import { RootAppSidebar } from './index';

const state = vi.hoisted(() => ({
  workbench: {
    location$: {
      selector: (select: (location: { pathname: string }) => boolean) =>
        select({ pathname: '/all' }),
    },
    workspaceSelectorOpen$: false,
    setWorkspaceSelectorOpen: vi.fn(),
  },
  dialogOpen: vi.fn(),
  quickSearchToggle: vi.fn(),
}));

vi.mock('@affine/component', () => ({
  IconButton: ({
    children,
    onClick,
    'aria-label': label,
  }: PropsWithChildren<{
    onClick?: () => void;
    'aria-label'?: string;
  }>) => (
    <button aria-label={label} onClick={onClick}>
      {children}
    </button>
  ),
  Popover: ({
    open,
    onOpenChange,
    content,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    content: ReactNode;
  }) => (
    <div>
      <button aria-label="more" onClick={() => onOpenChange(!open)}>
        More
      </button>
      {open ? content : null}
    </div>
  ),
}));

vi.mock('@affine/core/modules/app-sidebar/views', () => ({
  AppDownloadButton: () => null,
  AppSidebar: ({ children }: PropsWithChildren) => <aside>{children}</aside>,
  MenuItem: ({
    children,
    onClick,
  }: PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick}>{children}</button>
  ),
  MenuLinkItem: ({
    children,
    linkComponent: LinkComponent,
    to,
  }: PropsWithChildren<{
    linkComponent?: ComponentType<
      PropsWithChildren<{ to: string; className?: string }>
    >;
    to: string;
  }>) => {
    const Component =
      LinkComponent ??
      (({ children }: PropsWithChildren<{ to: string }>) => (
        <a href={`/workspace/test${to}`}>{children}</a>
      ));
    return <Component to={to}>{children}</Component>;
  },
  SidebarContainer: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SidebarScrollableContainer: ({ children }: PropsWithChildren) => (
    <div>{children}</div>
  ),
}));

vi.mock(
  '@affine/core/modules/app-sidebar/views/menu-item/external-menu-link-item',
  () => ({ ExternalMenuLinkItem: () => null })
);
vi.mock('@affine/core/modules/cloud', () => ({
  AuthService: 'auth',
  ServerService: 'server',
}));
vi.mock('@affine/core/modules/dialogs', () => ({
  WorkspaceDialogService: 'dialog',
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: 'workspace',
}));
vi.mock('@affine/core/modules/feature-flag', () => ({
  FeatureFlagService: 'feature-flags',
}));
vi.mock('@affine/core/modules/quicksearch/services/cmdk', () => ({
  CMDKQuickSearchService: 'quick-search',
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: 'workbench',
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/track', () => ({
  track: {
    $: {
      navigationPanel: {
        $: { openSettings: vi.fn() },
        importModal: { open: vi.fn() },
      },
    },
  },
}));
vi.mock('@blocksuite/icons/rc', () => ({
  AiOutlineIcon: () => null,
  AllDocsIcon: () => null,
  CheckBoxCheckLinearIcon: () => null,
  CollaborationIcon: () => null,
  HelpIcon: () => null,
  ImportIcon: () => null,
  JournalIcon: () => null,
  MoreHorizontalIcon: () => null,
  SearchIcon: () => null,
  SettingsIcon: () => null,
}));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (value: unknown) => value,
  useService: (service: string) =>
    ({
      dialog: { open: state.dialogOpen },
      workspace: { workspace: { flavour: 'affine-cloud' } },
      'feature-flags': { flags: { enable_ai: { $: true } } },
      server: { server: { features$: { copilot: true } } },
      workbench: { workbench: state.workbench },
    })[service],
  useServices: () => ({
    authService: { session: { status$: 'authenticated' } },
    cMDKQuickSearchService: { toggle: state.quickSearchToggle },
    workbenchService: { workbench: state.workbench },
  }),
}));

vi.mock('../../desktop/components/navigation-panel', () => ({
  NavigationPanelCollections: () => null,
  NavigationPanelFavorites: () => null,
  NavigationPanelMigrationFavorites: () => null,
  NavigationPanelTags: () => null,
}));
vi.mock('../workspace-selector', () => ({ WorkspaceNavigator: () => null }));
vi.mock('./journal-button', () => ({ AppSidebarJournalButton: () => null }));
vi.mock('./notification-button', () => ({ NotificationButton: () => null }));
vi.mock('./shortcut', () => ({ SidebarShortcutLink: () => null }));
vi.mock('./sidebar-audio-player', () => ({ SidebarAudioPlayer: () => null }));
vi.mock('./template-doc-entrance', () => ({ TemplateDocEntrance: () => null }));
vi.mock('./trash-button', () => ({ TrashButton: () => null }));
vi.mock('./updater-button', () => ({ UpdaterButton: () => null }));
vi.mock('./user-info', () => ({ default: () => null }));
vi.mock('./workspaces', () => ({ SidebarWorkspaces: () => null }));

afterEach(cleanup);

const CurrentPath = () => {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
};

test('task navigation leaves the workspace shell without a native reload', async () => {
  render(
    <MemoryRouter initialEntries={['/workspace/test/all']}>
      <RootAppSidebar />
      <CurrentPath />
    </MemoryRouter>
  );

  fireEvent.click(screen.getByRole('button', { name: 'more' }));
  const taskLink = screen.getByRole('link', {
    name: 'com.affine.workspaceSubPath.tasks',
  });
  expect(taskLink.getAttribute('href')).toBe(
    '/tasks?returnTo=%2Fworkspace%2Ftest%2Fall'
  );

  fireEvent.click(taskLink);

  await waitFor(() => {
    expect(screen.getByTestId('current-path').textContent).toBe('/tasks');
    expect(
      screen.queryByRole('link', {
        name: 'com.affine.workspaceSubPath.tasks',
      })
    ).toBeNull();
  });
});

test('inviting members opens member settings and closes the more menu', () => {
  state.dialogOpen.mockClear();
  render(
    <MemoryRouter>
      <RootAppSidebar />
    </MemoryRouter>
  );

  fireEvent.click(screen.getByRole('button', { name: 'more' }));
  fireEvent.click(screen.getByRole('button', { name: 'Invite Members' }));

  expect(state.dialogOpen).toHaveBeenCalledExactlyOnceWith('setting', {
    activeTab: 'workspace:members',
  });
  expect(screen.queryByRole('button', { name: 'Invite Members' })).toBeNull();
});

test('link menus stay mounted through microtasks until click dispatch finishes', async () => {
  vi.useFakeTimers();
  try {
    render(
      <MemoryRouter initialEntries={['/workspace/test/all']}>
        <RootAppSidebar />
        <CurrentPath />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    const taskLink = screen.getByRole('link', {
      name: 'com.affine.workspaceSubPath.tasks',
    });

    // Model the native microtask checkpoint between capture and bubble.
    fireEvent(
      taskLink,
      new MouseEvent('click', { bubbles: false, cancelable: true })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(taskLink.isConnected).toBe(true);

    fireEvent.click(taskLink);
    expect(screen.getByTestId('current-path').textContent).toBe('/tasks');
    await act(async () => {
      vi.runAllTimers();
    });
    expect(taskLink.isConnected).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
