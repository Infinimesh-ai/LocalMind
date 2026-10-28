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
  refresh: vi.fn(),
  query: vi.fn(),
  gql: vi.fn(),
  mutate: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
}));
const tokens = vi.hoisted(() => ({
  undo: Symbol('undo'),
  update: Symbol('update'),
}));
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
vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: state.refresh,
}));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  reportProjectError: state.error,
  projectErrorMessage: () => 'Unavailable',
}));
vi.mock('@affine/graphql', () => ({
  copilotContextMemoryDeleteMutation: Symbol('delete'),
  copilotContextMemoryUpdateMutation: tokens.update,
  CopilotContextMemoryMutableStatusInput: {
    active: 'active',
    disabled: 'disabled',
  },
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

test('an open memory dashboard refreshes on committed Project invalidation', async () => {
  const view = render(
    <ProjectShellSettings open projectId="project-1" onOpenChange={vi.fn()} />
  );
  const subscription = state.refresh.mock.calls.at(-1)!;
  expect(subscription.slice(0, 2)).toEqual([null, 'list']);
  await act(async () => {
    await subscription[2]();
  });
  expect(state.mutate).toHaveBeenCalledTimes(1);
  view.rerender(
    <ProjectShellSettings
      open={false}
      projectId="project-1"
      onOpenChange={vi.fn()}
    />
  );
  await act(async () => {
    await state.refresh.mock.calls.at(-1)![2]();
  });
  expect(state.mutate).toHaveBeenCalledTimes(1);
});

const recallLabel = (paused = false) =>
  `com.affine.localmind.project-memory.${paused ? 'resume' : 'pause'}`;
function setMemories(status = 'active', canManage = true) {
  const dashboard = state.query.getMockImplementation()!();
  dashboard.data.currentUser.copilot.contextMemories = [
    {
      id: 'memory-1',
      projectId: 'project-1',
      content: 'A shared fact',
      kind: 'auto_memory',
      status,
      canManage,
      revision: 7,
      contributorUserIds: ['me'],
      contributorCount: 1,
    },
  ];
}

test.each(['active', 'disabled'])(
  'recall transition from %s confirms and submits the displayed revision',
  async status => {
    setMemories(status);
    state.gql.mockResolvedValue({});
    render(
      <ProjectShellSettings open projectId="project-1" onOpenChange={vi.fn()} />
    );
    fireEvent.click(
      screen.getByRole('button', { name: recallLabel(status === 'disabled') })
    );
    expect(state.gql).not.toHaveBeenCalled();
    await act(() => state.confirm.mock.calls[0][0].onConfirm());
    expect(state.gql).toHaveBeenCalledWith({
      query: tokens.update,
      variables: {
        input: {
          id: 'memory-1',
          expectedRevision: 7,
          status: status === 'active' ? 'disabled' : 'active',
        },
      },
    });
    expect(state.mutate).toHaveBeenCalledOnce();
  }
);

test('duplicate confirmation is ignored while recall update is pending', async () => {
  setMemories();
  let resolve!: (result: object) => void;
  state.gql.mockReturnValue(
    new Promise(done => {
      resolve = done;
    })
  );
  render(
    <ProjectShellSettings open projectId="project-1" onOpenChange={vi.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: recallLabel() }));
  const confirm = state.confirm.mock.calls[0][0].onConfirm;
  let pending!: Promise<void>;
  act(() => {
    pending = confirm();
  });
  expect(
    screen.getByRole('button', { name: recallLabel() }).hasAttribute('disabled')
  ).toBe(true);
  await act(() => confirm());
  expect(state.gql).toHaveBeenCalledOnce();
  await act(async () => {
    resolve({});
    await pending;
  });
});

test('failed recall update reports the error and keeps the prior state available', async () => {
  setMemories('disabled');
  const error = new Error('Source revoked or revision changed');
  state.gql.mockRejectedValue(error);
  render(
    <ProjectShellSettings open projectId="project-1" onOpenChange={vi.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: recallLabel(true) }));
  await act(() => state.confirm.mock.calls[0][0].onConfirm());
  expect(state.error).toHaveBeenCalledWith(error);
  expect(state.mutate).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole('button', { name: recallLabel(true) })
      .hasAttribute('disabled')
  ).toBe(false);
});

test.each([
  ['active', false],
  ['deleted', true],
  ['superseded', true],
])(
  'recall controls are absent for %s and canManage=%s',
  (status, canManage) => {
    setMemories(status as string, canManage as boolean);
    render(
      <ProjectShellSettings open projectId="project-1" onOpenChange={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: recallLabel() })).toBeNull();
    expect(
      screen.queryByRole('button', { name: recallLabel(true) })
    ).toBeNull();
  }
);

test('a confirmation from a previous Project cannot change its memory', async () => {
  setMemories();
  const view = render(
    <ProjectShellSettings open projectId="project-1" onOpenChange={vi.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: recallLabel() }));
  view.rerender(
    <ProjectShellSettings open projectId="project-2" onOpenChange={vi.fn()} />
  );
  await act(() => state.confirm.mock.calls[0][0].onConfirm());
  expect(state.gql).not.toHaveBeenCalled();
});
