/**
 * @vitest-environment happy-dom
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  memorySources: [] as Array<{
    grantId: string;
    projectName: string;
    status: string;
    revision: number;
  }>,
  queryError: undefined as Error | undefined,
  queryLoading: false,
  confirm: vi.fn(),
  gql: vi.fn(),
  mutate: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const tokens = vi.hoisted(() => ({
  GraphQLService: class GraphQLService {},
  approve: Symbol('approve'),
  query: Symbol('query'),
  reject: Symbol('reject'),
  memory: Symbol('memory'),
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    loading: _loading,
    size: _size,
    variant: _variant,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      size?: string;
      variant?: string;
    }
  >) => <button {...props}>{children}</button>,
  Loading: () => <div data-testid="loading" />,
  notify: { error: state.notifyError, success: state.notifySuccess },
  useConfirmModal: () => ({ openConfirmModal: state.confirm }),
}));

vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: () => ({
    data: {
      currentUser: {
        copilot: {
          workbenchMemorySourceAuthorizations: state.memorySources,
          workbenchAccessRequests: [
            {
              id: 'request-1',
              beneficiaryType: 'project',
              beneficiaryProjectId: 'project-1',
              projectName: 'Planning',
              requesterName: 'Requester',
              requesterEmail: 'requester@example.com',
              beneficiaryName: null,
              beneficiaryUserId: null,
              requesterUserId: 'requester-1',
              requestedTitle: 'Quarterly plan',
              requestedLevel: 'read',
              createdAt: '2026-09-04T00:00:00.000Z',
            },
          ],
          workbenchProjectGrantsForSource: [
            {
              id: 'grant-1',
              projectName: 'Planning',
              level: 'read',
              source: 'direct',
              grantedByUserId: 'owner-1',
              grantedByName: 'Owner',
              grantedAt: '2026-09-04T00:00:00.000Z',
            },
          ],
        },
      },
    },
    error: state.queryError,
    isLoading: state.queryLoading,
    mutate: state.mutate,
  }),
}));

vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: tokens.GraphQLService,
}));

vi.mock('@affine/error', () => ({
  UserFriendlyError: { fromAny: (error: Error) => error },
}));

vi.mock('@affine/graphql', () => ({
  approveCopilotAccessRequestMutation: tokens.approve,
  copilotWorkbenchSourceAuthorizationGetQuery: tokens.query,
  rejectCopilotAccessRequestMutation: tokens.reject,
  setCopilotMemorySourceAuthorizationMutation: tokens.memory,
}));

vi.mock('@affine/i18n', () => ({
  getOrCreateI18n: () => ({ t: (key: string) => key }),
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => (values?: Record<string, unknown>) =>
          values
            ? `${String(key)} ${Object.values(values).join(' ')}`
            : String(key),
      }
    ),
}));

vi.mock('@toeverything/infra', () => ({
  useService: (token: unknown) => {
    if (token === tokens.GraphQLService) return { gql: state.gql };
    throw new Error('Unexpected service token');
  },
}));

import { ProjectAccess } from './project-access';

describe('ProjectAccess', () => {
  beforeEach(() => {
    state.memorySources = [];
    state.queryError = undefined;
    state.queryLoading = false;
    state.confirm.mockReset();
    state.gql.mockReset();
    state.mutate.mockReset();
    state.notifyError.mockReset();
    state.notifySuccess.mockReset();
  });

  afterEach(cleanup);

  test('identifies the beneficiary and requester before source-side approval', () => {
    render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);

    expect(
      screen.getByText(
        'com.affine.localmind.share.projectAccess.projectBeneficiary Planning'
      )
    ).not.toBeNull();
    expect(
      screen.getByText(
        'com.affine.localmind.share.projectAccess.requester Requester requester@example.com'
      )
    ).not.toBeNull();
  });

  test('keeps approval records without an action to revoke approved copies', () => {
    render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);

    expect(screen.getByText('Planning')).not.toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'com.affine.localmind.share.projectAccess.revoke',
      })
    ).toBeNull();
    expect(state.gql).not.toHaveBeenCalled();
  });

  test('restores source-side decision controls after a denied approval', async () => {
    state.gql.mockRejectedValueOnce(new Error('No longer authorized'));
    render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);

    const approve = screen.getByRole('button', {
      name: 'com.affine.localmind.share.projectAccess.approve',
    }) as HTMLButtonElement;
    fireEvent.click(approve);
    expect(state.gql).not.toHaveBeenCalled();
    const confirmation = state.confirm.mock.calls[0][0];
    expect(confirmation.description).toContain('Planning');
    expect(confirmation.description).not.toContain('project-1');
    await confirmation.onConfirm();

    await waitFor(() => {
      expect(state.notifyError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'com.affine.localmind.project-error.failed',
        })
      );
      expect(approve.disabled).toBe(false);
    });
    expect(state.mutate).not.toHaveBeenCalled();
  });

  test('confirms rejection without presenting copy approval terms', () => {
    render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.share.projectAccess.reject',
      })
    );
    expect(state.confirm.mock.calls[0][0].description).toBe('Quarterly plan');
    expect(state.gql).not.toHaveBeenCalled();
  });
});

const memoryKey = 'com.affine.localmind.share.projectMemory.';

test('memory reauthorization confirms scope, prevents duplicate submits and reports partial restoration', async () => {
  state.memorySources = [
    {
      grantId: 'memory-grant',
      projectName: '共享项目',
      status: 'revoked',
      revision: 4,
    },
  ];
  state.gql.mockReset();
  state.mutate.mockResolvedValue(undefined);
  let resolve!: (value: unknown) => void;
  state.gql.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);
  fireEvent.click(screen.getByRole('button', { name: memoryKey + 'allow' }));
  const options = state.confirm.mock.calls.at(-1)![0];
  expect(options.description).toContain(memoryKey + 'allowDescription');
  const first = options.onConfirm();
  await options.onConfirm();
  expect(state.gql).toHaveBeenCalledTimes(1);
  expect(state.gql.mock.calls[0][0]).toMatchObject({
    query: tokens.memory,
    variables: {
      input: { grantId: 'memory-grant', enabled: true, expectedRevision: 4 },
    },
  });
  resolve({
    setCopilotMemorySourceAuthorization: { restoredCount: 2, deferredCount: 1 },
  });
  await first;
  expect(state.notifySuccess).toHaveBeenCalledWith({
    title: memoryKey + 'saved',
    message: memoryKey + 'restored 2 1',
  });
  cleanup();
});

test('memory consent retry retains the request identity after unknown response and refreshes current state', async () => {
  state.memorySources = [
    {
      grantId: 'memory-grant',
      projectName: 'Project',
      status: 'active',
      revision: 5,
    },
  ];
  state.gql.mockReset();
  state.mutate.mockReset().mockResolvedValue(undefined);
  state.notifyError.mockReset();
  state.gql.mockRejectedValue(new TypeError('Network failed'));
  render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);
  fireEvent.click(screen.getByRole('button', { name: memoryKey + 'revoke' }));
  const options = state.confirm.mock.calls.at(-1)![0];
  await options.onConfirm();
  await options.onConfirm();
  expect(state.gql).toHaveBeenCalledTimes(2);
  expect(state.gql.mock.calls[0][0].variables.input.requestKey).toBe(
    state.gql.mock.calls[1][0].variables.input.requestKey
  );
  expect(state.mutate).toHaveBeenCalledTimes(2);
  expect(state.notifyError).toHaveBeenCalledTimes(2);
  cleanup();
});

test('source authorization has loading and retryable error states', async () => {
  state.memorySources = [];
  state.queryLoading = true;
  const rendered = render(
    <ProjectAccess workspaceId="workspace-1" docId="doc-1" />
  );
  expect(screen.getByTestId('loading')).not.toBeNull();
  state.queryLoading = false;
  state.queryError = new Error('unavailable');
  rendered.rerender(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);
  expect(screen.getByRole('alert')).not.toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'com.affine.localmind.workbench.retry' })
  );
  await waitFor(() => expect(state.mutate).toHaveBeenCalled());
  state.queryError = undefined;
  cleanup();
});

test('stale consent versions show a specific conflict and reload source permissions', async () => {
  state.memorySources = [
    {
      grantId: 'memory-grant',
      projectName: 'Project',
      status: 'active',
      revision: 5,
    },
  ];
  state.gql
    .mockReset()
    .mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }));
  state.mutate.mockReset().mockResolvedValue(undefined);
  state.notifyError.mockReset();
  render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);
  fireEvent.click(screen.getByRole('button', { name: memoryKey + 'revoke' }));
  await state.confirm.mock.calls.at(-1)![0].onConfirm();
  expect(state.notifyError).toHaveBeenCalledWith({
    title: 'com.affine.localmind.share.projectAccess.actionFailed',
    message: memoryKey + 'conflict',
  });
  expect(state.mutate).toHaveBeenCalledTimes(1);
  cleanup();
});
