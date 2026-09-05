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
  revoke: Symbol('revoke'),
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
          workbenchAccessRequests: [
            {
              id: 'request-1',
              beneficiaryType: 'project',
              beneficiaryProjectId: 'project-1',
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
              grantedAt: '2026-09-04T00:00:00.000Z',
              revocable: true,
            },
          ],
        },
      },
    },
    error: undefined,
    isLoading: false,
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
  revokeCopilotProjectGrantMutation: tokens.revoke,
}));

vi.mock('@affine/i18n', () => ({
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
        'com.affine.localmind.share.projectAccess.projectBeneficiary project-1'
      )
    ).not.toBeNull();
    expect(
      screen.getByText(
        'com.affine.localmind.share.projectAccess.requester requester-1'
      )
    ).not.toBeNull();
  });

  test('requires confirmation and restores revoke after a denied mutation', async () => {
    state.gql
      .mockRejectedValueOnce(new Error('Denied'))
      .mockResolvedValueOnce({ revokeCopilotProjectGrant: true });
    render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);

    const revoke = screen.getByRole('button', {
      name: 'com.affine.localmind.share.projectAccess.revoke',
    }) as HTMLButtonElement;
    fireEvent.click(revoke);
    expect(state.gql).not.toHaveBeenCalled();

    await state.confirm.mock.calls[0][0].onConfirm();
    expect(state.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Denied' })
    );
    expect(revoke.disabled).toBe(false);
    expect(state.mutate).not.toHaveBeenCalled();

    fireEvent.click(revoke);
    await state.confirm.mock.calls[1][0].onConfirm();
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
    expect(state.gql).toHaveBeenLastCalledWith({
      query: tokens.revoke,
      variables: { input: { grantId: 'grant-1' } },
    });
    expect(state.notifySuccess).toHaveBeenCalled();
  });

  test('restores source-side decision controls after a denied approval', async () => {
    state.gql.mockRejectedValueOnce(new Error('No longer authorized'));
    render(<ProjectAccess workspaceId="workspace-1" docId="doc-1" />);

    const approve = screen.getByRole('button', {
      name: 'com.affine.localmind.share.projectAccess.approve',
    }) as HTMLButtonElement;
    fireEvent.click(approve);

    await waitFor(() => {
      expect(state.notifyError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No longer authorized' })
      );
      expect(approve.disabled).toBe(false);
    });
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
