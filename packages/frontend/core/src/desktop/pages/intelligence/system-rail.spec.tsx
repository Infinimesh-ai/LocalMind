/**
 * @vitest-environment happy-dom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/component', () => ({
  Tooltip: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@affine/component/localmind-logo', () => ({
  LocalMindLogo: () => null,
}));
vi.mock('@affine/core/components/root-app-sidebar/user-info', () => ({
  default: () => <button aria-label="Account" />,
}));
vi.mock('@affine/core/modules/dialogs', () => ({
  WorkspaceDialogService: class {},
}));
vi.mock('@affine/core/modules/workbench', () => ({
  WorkbenchService: class {},
}));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));

import { SystemRail } from './system-rail';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mount(projectId?: string | null, documentsView = false) {
  const onNavigate = vi.fn();
  const onOpenSettings = vi.fn();
  render(
    <MemoryRouter initialEntries={['/project']}>
      <SystemRail
        projectId={projectId}
        documentsView={documentsView}
        onNavigate={onNavigate}
        onOpenSettings={onOpenSettings}
      />
    </MemoryRouter>
  );
  const click = (name: string) =>
    fireEvent.click(screen.getByRole('button', { name }));
  return { onNavigate, onOpenSettings, click };
}

test('keeps project documents separate from the Workspace and project overview', () => {
  localStorage.setItem('last_workspace_id', 'ws 1');
  const { onNavigate, click } = mount(null);
  click('com.affine.localmind.workbench.systemRail.workspace');
  click('com.affine.localmind.workbench.systemRail.projects');
  click('com.affine.localmind.workbench.systemRail.docs');
  click('com.affine.localmind.workbench.systemRail.reports');
  click('com.affine.localmind.workbench.systemRail.tasks');
  expect(onNavigate.mock.calls.map(([path]) => path)).toEqual([
    '/workspace/ws%201',
    '/project',
    '/project?view=files',
    '/reports',
    '/tasks',
  ]);
  expect(
    screen
      .getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.projects',
      })
      .getAttribute('aria-current')
  ).toBe('page');
});

test('falls back to the app index without a remembered workspace and opens settings', () => {
  const { onNavigate, onOpenSettings, click } = mount();
  click('com.affine.localmind.workbench.systemRail.workspace');
  click('com.affine.settingSidebar.title');
  expect(onNavigate).toHaveBeenCalledWith('/');
  expect(onOpenSettings).toHaveBeenCalledOnce();
});

test('opens the selected project documents without a Workspace and marks only documents active', () => {
  const { onNavigate, click } = mount('project /1', true);
  click('com.affine.localmind.workbench.systemRail.docs');
  expect(onNavigate).toHaveBeenCalledWith('/project/project%20%2F1?view=files');
  expect(
    screen
      .getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.docs',
      })
      .getAttribute('aria-current')
  ).toBe('page');
  expect(
    screen
      .getByRole('button', {
        name: 'com.affine.localmind.workbench.systemRail.projects',
      })
      .getAttribute('aria-current')
  ).toBeNull();
});
