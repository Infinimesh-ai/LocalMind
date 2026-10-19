/**
 * @vitest-environment happy-dom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as InfraModule from '@toeverything/infra';
import type { PropsWithChildren } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspaceId: null as string | null,
  openAll: vi.fn(),
  openDialog: vi.fn(),
}));

const tokens = vi.hoisted(() => ({
  WorkspaceService: class WorkspaceService {},
  WorkbenchService: class WorkbenchService {},
  WorkspaceDialogService: class WorkspaceDialogService {},
}));

vi.mock('@affine/component', () => ({
  Tooltip: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@affine/component/localmind-logo', () => ({
  LocalMindLogo: () => null,
}));
vi.mock('../root-app-sidebar/user-info', () => ({
  default: () => <button aria-label="Account" />,
}));
vi.mock('@affine/core/modules/dialogs', () => ({
  WorkspaceDialogService: tokens.WorkspaceDialogService,
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: tokens.WorkbenchService,
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: tokens.WorkspaceService,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', async importOriginal => ({
  ...(await importOriginal<typeof InfraModule>()),
  useServiceOptional: (token: unknown) => {
    if (!state.workspaceId) return undefined;
    if (token === tokens.WorkspaceService)
      return { workspace: { id: state.workspaceId } };
    if (token === tokens.WorkbenchService)
      return { workbench: { openAll: state.openAll } };
    if (token === tokens.WorkspaceDialogService)
      return { open: state.openDialog };
    return undefined;
  },
}));

import {
  GlobalRail,
  globalRailActiveItem,
  globalRailTasksPath,
  rememberLastProjectId,
} from './index';

afterEach(() => {
  cleanup();
  localStorage.clear();
  state.workspaceId = null;
  state.openAll.mockReset();
  state.openDialog.mockReset();
});

const CurrentPath = () => {
  const location = useLocation();
  return (
    <output data-testid="current-path">
      {location.pathname + location.search}
    </output>
  );
};

const NAMES = {
  workspace: 'com.affine.localmind.workbench.systemRail.workspace',
  projects: 'com.affine.localmind.workbench.systemRail.projects',
  docs: 'com.affine.localmind.workbench.systemRail.docs',
  reports: 'com.affine.localmind.workbench.systemRail.reports',
  tasks: 'com.affine.localmind.workbench.systemRail.tasks',
  settings: 'com.affine.settingSidebar.title',
};

function mount(path: string, props: Parameters<typeof GlobalRail>[0] = {}) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalRail {...props} />
      <CurrentPath />
    </MemoryRouter>
  );
  const button = (name: string) => screen.getByRole('button', { name });
  return {
    button,
    current: () =>
      Object.entries(NAMES)
        .filter(
          ([, name]) =>
            screen
              .queryByRole('button', { name })
              ?.getAttribute('aria-current') === 'page'
        )
        .map(([key]) => key),
    path: () => screen.getByTestId('current-path').textContent,
  };
}

test('derives the active destination from the location', () => {
  expect(globalRailActiveItem('/workspace/ws/all')).toBe('workspace');
  expect(globalRailActiveItem('/workspace/ws/tasks')).toBe('tasks');
  expect(globalRailActiveItem('/project')).toBe('projects');
  expect(globalRailActiveItem('/project/p1/conversations/s1')).toBe('projects');
  expect(globalRailActiveItem('/project/p1', '?view=files')).toBe('docs');
  expect(globalRailActiveItem('/reports')).toBe('reports');
  expect(globalRailActiveItem('/reports/new', '?handoff=x')).toBe('reports');
  expect(globalRailActiveItem('/tasks')).toBe('tasks');
  expect(globalRailActiveItem('/projects')).toBeNull();
  expect(globalRailActiveItem('/')).toBeNull();
  expect(globalRailTasksPath('/workspace/ws/all')).toBe(
    '/tasks?returnTo=%2Fworkspace%2Fws%2Fall'
  );
  expect(globalRailTasksPath('/project')).toBe('/tasks');
});

test('renders four destinations plus tasks and settings with location-based highlight', () => {
  const rail = mount('/reports/new', { onOpenSettings: vi.fn() });
  for (const name of Object.values(NAMES))
    expect(rail.button(name)).toBeTruthy();
  expect(rail.current()).toEqual(['reports']);
  cleanup();
  expect(mount('/project/p1?view=files').current()).toEqual(['docs']);
});

test('navigates with the app router by default and remembers the last project', () => {
  localStorage.setItem('last_workspace_id', 'ws 1');
  rememberLastProjectId('project /1');
  const rail = mount('/reports');
  fireEvent.click(rail.button(NAMES.docs));
  expect(rail.path()).toBe('/project/project%20%2F1?view=files');
  fireEvent.click(rail.button(NAMES.reports));
  expect(rail.path()).toBe('/reports');
  fireEvent.click(rail.button(NAMES.workspace));
  expect(rail.path()).toBe('/workspace/ws%201');
});

test('hides settings when there is no workspace dialog, handler or last workspace', () => {
  mount('/reports');
  expect(screen.queryByRole('button', { name: NAMES.settings })).toBeNull();
});

test('outside a workspace settings opens the last workspace settings route', () => {
  localStorage.setItem('last_workspace_id', 'ws 1');
  const rail = mount('/reports');
  fireEvent.click(rail.button(NAMES.settings));
  expect(rail.path()).toBe('/workspace/ws%201/settings?tab=appearance');
});

test('inside a workspace it opens the workbench, workspace settings and tasks with returnTo', () => {
  state.workspaceId = 'ws-a';
  const rail = mount('/workspace/ws-a/all');
  expect(rail.current()).toEqual(['workspace']);
  fireEvent.click(rail.button(NAMES.workspace));
  expect(state.openAll).toHaveBeenCalledOnce();
  fireEvent.click(rail.button(NAMES.settings));
  expect(state.openDialog).toHaveBeenCalledWith('setting', {
    activeTab: 'appearance',
  });
  fireEvent.click(rail.button(NAMES.tasks));
  expect(rail.path()).toBe('/tasks?returnTo=%2Fworkspace%2Fws-a%2Fall');
});

test('routes every destination through onNavigate when provided', () => {
  state.workspaceId = 'ws-a';
  const onNavigate = vi.fn();
  const rail = mount('/project', { onNavigate, projectId: 'p1' });
  fireEvent.click(rail.button(NAMES.workspace));
  fireEvent.click(rail.button(NAMES.docs));
  expect(onNavigate.mock.calls.map(([path]) => path)).toEqual([
    '/workspace/ws-a',
    '/project/p1?view=files',
  ]);
  expect(state.openAll).not.toHaveBeenCalled();
});
