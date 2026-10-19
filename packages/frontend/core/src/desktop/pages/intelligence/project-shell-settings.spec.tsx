/** @vitest-environment happy-dom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  gql: vi.fn(),
  mutate: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
}));
const tokens = vi.hoisted(() => ({ undo: Symbol('undo') }));
vi.mock('./project-publications', () => ({
  ProjectPublications: () => <div data-testid="project-publications" />,
}));
vi.mock('@affine/component', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  Loading: () => <span>Loading</span>,
  Modal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? <div role="dialog">{children}</div> : null,
  RadioGroup: () => null,
  Switch: () => null,
  useConfirmModal: () => ({ openConfirmModal: state.confirm }),
}));
vi.mock('@affine/core/components/affine/language-menu', () => ({
  LanguageMenu: () => null,
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: state.query,
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  reportProjectError: state.error,
  projectErrorMessage: () => 'Unavailable',
}));
vi.mock('@affine/graphql', () => ({
  copilotContextMemoryDeleteMutation: Symbol('delete'),
  copilotProjectContextDashboardGetQuery: Symbol('dashboard'),
  copilotProjectContextSettingsUpdateMutation: Symbol('settings'),
  copilotProjectMemoryConflictResolveMutation: Symbol('conflict'),
  undoCopilotProjectContextMemoryEventMutation: tokens.undo,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => ({ gql: state.gql }),
}));
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('./project-collaboration', () => ({
  ProjectCollaborationContent: () => null,
}));
import { ProjectShellSettings } from './project-shell-settings';

beforeEach(() => {
  vi.clearAllMocks();
  state.query.mockReturnValue({
    mutate: state.mutate,
    data: {
      currentUser: {
        id: 'me',
        copilot: {
          contextProject: { id: 'project-1', canManage: false, members: [] },
          contextMemories: [],
          projectMemoryConflicts: [],
          projectContextSettings: { revision: 1, autoMemoryEnabled: false },
          projectContextMemoryEvents: [
            {
              id: 'mine',
              operation: 'ADD',
              createdAt: '2026-10-12T00:00:00Z',
              canUndo: true,
            },
            {
              id: 'other',
              operation: 'UPDATE',
              createdAt: '2026-10-12T00:00:00Z',
              canUndo: false,
            },
          ],
        },
      },
    },
  });
});
afterEach(cleanup);

test('undo is offered only for allowed events and requires confirmation in the selected Project', async () => {
  state.gql.mockResolvedValue({});
  render(
    <ProjectShellSettings open onOpenChange={vi.fn()} projectId="project-1" />
  );
  expect(
    screen.getAllByRole('button', {
      name: 'com.affine.localmind.workbench.fusion.undoContribution',
    })
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.workbench.fusion.undoContribution',
    })
  );
  expect(state.gql).not.toHaveBeenCalled();
  await act(() => state.confirm.mock.calls[0][0].onConfirm());
  expect(state.gql).toHaveBeenCalledWith({
    query: tokens.undo,
    variables: { projectId: 'project-1', eventId: 'mine' },
  });
  expect(state.mutate).toHaveBeenCalledOnce();
});

test('a rejected or stale undo reports the failure and keeps the available record', async () => {
  const error = new Error('Contribution changed');
  state.gql.mockRejectedValue(error);
  render(
    <ProjectShellSettings open onOpenChange={vi.fn()} projectId="project-1" />
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.workbench.fusion.undoContribution',
    })
  );
  await act(() => state.confirm.mock.calls[0][0].onConfirm());
  expect(state.error).toHaveBeenCalledWith(error);
  expect(state.mutate).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.undoContribution',
      })
      .hasAttribute('disabled')
  ).toBe(false);
});
