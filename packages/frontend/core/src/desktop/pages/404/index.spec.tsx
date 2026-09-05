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
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gql: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

const tokens = vi.hoisted(() => ({
  DesktopApiService: class DesktopApiService {},
  GraphQLService: class GraphQLService {},
  ServersService: class ServersService {},
  requestMutation: Symbol('requestMutation'),
  // eslint-disable-next-line rxjs/finnish -- Symbol identifies the mocked observable source.
  servers$: Symbol('servers$'),
}));

vi.mock('@affine/component', () => ({
  notify: { error: state.notifyError, success: state.notifySuccess },
}));

vi.mock('@affine/component/not-found-page', () => ({
  NoPermissionOrNotFound: ({
    requestAccess,
  }: {
    requestAccess?: {
      pending: boolean;
      requested: boolean;
      onRequest: () => void;
    };
  }) => (
    <button
      type="button"
      data-testid="request-access"
      data-pending={String(requestAccess?.pending)}
      data-requested={String(requestAccess?.requested)}
      disabled={requestAccess?.pending || requestAccess?.requested}
      onClick={requestAccess?.onRequest}
    >
      Request access
    </button>
  ),
  NotFoundPage: () => <div />,
}));

vi.mock('@affine/core/components/hooks/affine/use-sign-out', () => ({
  useSignOut: () => vi.fn(),
}));

vi.mock('@affine/core/components/hooks/use-navigate-helper', () => ({
  RouteLogic: { REPLACE: 'replace' },
  useNavigateHelper: () => ({ jumpToIndex: vi.fn() }),
}));

vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: tokens.GraphQLService,
  ServersService: tokens.ServersService,
}));

vi.mock('@affine/core/modules/desktop-api', () => ({
  DesktopApiService: tokens.DesktopApiService,
}));

vi.mock('@affine/error', () => ({
  UserFriendlyError: { fromAny: (error: Error) => error },
}));

vi.mock('@affine/graphql', () => ({
  requestCopilotDocumentAccessMutation: tokens.requestMutation,
}));

vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => String(key) }),
}));

vi.mock('@toeverything/infra', () => ({
  FrameworkScope: ({ children }: PropsWithChildren) => children,
  useLiveData: () => [
    { account: { id: 'user-1' }, server: { scope: 'server-scope' } },
  ],
  useService: (token: unknown) => {
    if (token === tokens.ServersService) {
      // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the ServersService API.
      return { serversWithAccount$: tokens.servers$ };
    }
    throw new Error('Unexpected service token');
  },
  useServiceOptional: (token: unknown) => {
    if (token === tokens.GraphQLService) return { gql: state.gql };
    if (token === tokens.DesktopApiService) return undefined;
    return undefined;
  },
}));

vi.mock('../auth/sign-in', () => ({ SignIn: () => <div /> }));

import { PageNotFound } from './index';

describe('PageNotFound personal access request', () => {
  beforeEach(() => {
    state.gql.mockReset();
    state.notifyError.mockReset();
    state.notifySuccess.mockReset();
  });

  afterEach(cleanup);

  test('fails recoverably and requests personal read access without a project', async () => {
    state.gql
      .mockRejectedValueOnce(new Error('Request denied'))
      .mockResolvedValueOnce({ requestCopilotDocumentAccess: { id: 'r-1' } });
    render(
      <PageNotFound
        noPermission
        accessRequest={{
          workspaceId: 'workspace-1',
          docId: 'doc-1',
          requestedTitle: 'Known title',
        }}
      />
    );

    const request = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Request access',
    });
    fireEvent.click(request);
    await waitFor(() => {
      expect(state.notifyError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Request denied' })
      );
      expect(request.disabled).toBe(false);
      expect(request.dataset.requested).toBe('false');
    });

    fireEvent.click(request);
    await waitFor(() => {
      expect(request.dataset.requested).toBe('true');
      expect(request.disabled).toBe(true);
    });
    expect(state.gql).toHaveBeenLastCalledWith({
      query: tokens.requestMutation,
      variables: {
        input: {
          workspaceId: 'workspace-1',
          docId: 'doc-1',
          requestedLevel: 'read',
          requestedTitle: 'Known title',
        },
      },
    });
    expect(state.notifySuccess).toHaveBeenCalled();
  });
});
