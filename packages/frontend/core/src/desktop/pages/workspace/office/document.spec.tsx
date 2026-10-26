/** @vitest-environment happy-dom */
import type { UseQueryConfig } from '@affine/core/components/hooks/use-query';

type ResourceQueryConfig = Pick<
  UseQueryConfig,
  'errorRetryCount' | 'errorRetryInterval'
> & {
  shouldRetryOnError: (error: unknown) => boolean;
};
import { UserFriendlyError } from '@affine/error';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  resource: {
    id: 'pdf',
    title: 'report.pdf',
    canEdit: true,
    trashedAt: null as string | null,
  },
  error: null as Error | null,
  capabilities: {} as Record<string, boolean>,
  mutate: vi.fn<() => Promise<unknown>>(),
  queryConfig: undefined as ResourceQueryConfig | undefined,
  refreshing: false,
  catalogVisible: true,
  catalogError: false,
  catalogLoading: false,
  refreshCatalog: vi.fn<() => Promise<void>>(),
  resourceEvents$: undefined as Subject<{ changed: true }> | undefined,
  accessEvents$: undefined as Subject<{ changed: true }> | undefined,
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ artifactId: 'pdf' }),
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: (_input: unknown, config: ResourceQueryConfig) => {
    state.queryConfig = config;
    return {
      data: { workspaceNativeResource: state.resource },
      error: state.error,
      mutate: state.mutate,
      isValidating: state.refreshing,
    };
  },
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/components/page-tree/created-resource', () => ({
  useCreatedResourceFocus: () => undefined,
}));
vi.mock('@affine/core/components/page-tree/children', () => ({
  PageTreeBreadcrumbs: () => null,
}));
vi.mock('@affine/core/modules/storage', () => ({ NbstoreService: class {} }));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
}));
vi.mock('@affine/core/modules/workspace-resources/use-resources', () => ({
  useWorkspaceResources: () => ({
    ready: true,
    error: state.catalogError,
    loading: state.catalogLoading,
    service: { refresh: state.refreshCatalog },
    items: state.catalogVisible ? [{ id: 'pdf', kind: 'office' }] : [],
  }),
}));
vi.mock('@affine/core/modules/workbench', () => ({
  ViewService: class {},
  WorkbenchService: class {},
  ViewBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ViewHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ViewTitle: () => null,
  ViewIcon: () => null,
  ViewSidebarTab: () => null,
}));
vi.mock('@toeverything/infra', async () => {
  const { EMPTY: empty$ } = await import('rxjs');
  const service = {
    workspace: { id: 'workspace' },
    workbench: {},
    view: { history: { block: () => () => {} } },
    realtime: {
      subscribe: (topic: string) =>
        topic === 'workspace.nativeResources.changed'
          ? state.resourceEvents$!
          : topic === 'workspace.access.changed'
            ? state.accessEvents$!
            : empty$,
    },
  };
  return {
    useService: () => service,
  };
});
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('@affine/core/components/native-files/workspace-actions', () => ({
  WorkspaceNativeActions: () => null,
}));
vi.mock('@affine/core/components/office/comments', () => ({
  OfficeCommentsPanel: () => null,
}));
vi.mock('@affine/core/components/office/resource-adapter', () => ({
  createOfficeResourceAdapter: () => ({}),
}));
vi.mock('@affine/core/components/office/resource-session', () => ({
  useOfficeResourceSession: () => ({
    artifact: null,
    revision: null,
    unsaved: true,
    dirty: () => true,
    confirmUnsaved: async () => false,
  }),
}));
vi.mock('@affine/core/components/office/document-editor', () => ({
  DocumentEditor: () => null,
}));
vi.mock('@affine/core/components/office/revision-history', () => ({
  revisionCompareChanges: () => null,
}));
vi.mock('./chat', () => ({ OfficeChatPanel: () => null }));
vi.mock('@affine/core/components/office/resource-surface', () => ({
  OfficeResourceSurface: ({
    capabilities,
    children,
  }: {
    capabilities: Record<string, boolean>;
    children: (parts: {
      header: ReactNode;
      body: ReactNode;
      overlays: ReactNode;
    }) => ReactNode;
  }) => {
    state.capabilities = capabilities;
    return children({
      header: null,
      body: <input aria-label="Local Office draft" defaultValue="" />,
      overlays: null,
    });
  },
}));

import { Component } from './document';
beforeEach(() => {
  state.resource = {
    id: 'pdf',
    title: 'report.pdf',
    canEdit: true,
    trashedAt: null,
  };
  state.error = null;
  state.refreshing = false;
  state.catalogVisible = true;
  state.catalogError = false;
  state.catalogLoading = false;
  state.refreshCatalog.mockReset().mockResolvedValue(undefined);
  state.mutate.mockReset().mockResolvedValue(undefined);
  state.resourceEvents$ = new Subject();
  state.accessEvents$ = new Subject();
});
afterEach(cleanup);
test('remote trash and revocation preserve a mounted draft while hiding content and disabling all writes', () => {
  const view = render(<Component />);
  fireEvent.change(screen.getByLabelText('Local Office draft'), {
    target: { value: 'Unsaved changes' },
  });
  state.resource = { ...state.resource, trashedAt: '2026-09-28T00:00:00Z' };
  view.rerender(<Component />);
  expect(
    screen.getByLabelText<HTMLInputElement>('Local Office draft').value
  ).toBe('Unsaved changes');
  expect(
    screen.getByLabelText('Local Office draft').closest('[hidden]')
  ).not.toBeNull();
  expect(state.capabilities.canEdit).toBe(false);
  expect(state.capabilities.canUseAI).toBe(false);
  expect(state.capabilities.canComment).toBe(false);
  state.resource = { ...state.resource, trashedAt: null };
  state.error = new Error('Access revoked');
  view.rerender(<Component />);
  expect(
    screen.getByLabelText<HTMLInputElement>('Local Office draft').value
  ).toBe('Unsaved changes');
  expect(state.capabilities.canDownload).toBe(false);
  state.error = null;
  view.rerender(<Component />);
  expect(
    screen.getByLabelText('Local Office draft').closest('[hidden]')
  ).toBeNull();
  expect(
    screen.getByLabelText<HTMLInputElement>('Local Office draft').value
  ).toBe('Unsaved changes');
});

test('a failed refresh has a retry control and preserves the draft through recovery', () => {
  const view = render(<Component />);
  fireEvent.change(screen.getByLabelText('Local Office draft'), {
    target: { value: 'Draft survives a temporary server failure' },
  });
  state.error = new UserFriendlyError({
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    type: 'INTERNAL_SERVER_ERROR',
    name: 'INTERNAL_SERVER_ERROR',
    message: 'An internal error occurred.',
  });
  view.rerender(<Component />);
  expect(screen.getByRole('alert').textContent).toContain(
    'com.affine.error.unexpected-error.title'
  );
  const retry = screen.getByRole('button', { name: 'com.affine.error.retry' });
  fireEvent.click(retry);
  expect(state.mutate).toHaveBeenCalledOnce();
  state.refreshing = true;
  view.rerender(<Component />);
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  state.error = null;
  state.refreshing = false;
  view.rerender(<Component />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByLabelText<HTMLInputElement>('Local Office draft').value
  ).toBe('Draft survives a temporary server failure');
  expect(
    screen.getByLabelText('Local Office draft').closest('[hidden]')
  ).toBeNull();
});

test('catalog refresh failures offer a complete retry without misreporting deletion or losing drafts', () => {
  const view = render(<Component />);
  const draft = screen.getByLabelText('Local Office draft') as HTMLInputElement;
  fireEvent.change(draft, { target: { value: 'Keep this draft' } });
  state.catalogError = true;
  view.rerender(<Component />);
  expect(screen.getByRole('alert').textContent).toContain(
    'com.affine.error.unexpected-error.title'
  );
  expect(screen.getByRole('alert').textContent).not.toContain(
    'com.affine.localmind.resources.unavailable'
  );
  expect(state.capabilities.canEdit).toBe(false);
  expect(draft.closest('[hidden]')).toBeTruthy();
  const retry = screen.getByRole('button', {
    name: 'com.affine.error.retry',
  }) as HTMLButtonElement;
  fireEvent.click(retry);
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(state.refreshCatalog).toHaveBeenCalledOnce();
  state.catalogLoading = true;
  view.rerender(<Component />);
  expect(retry.disabled).toBe(true);
  state.catalogError = false;
  state.catalogLoading = false;
  view.rerender(<Component />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(state.capabilities.canEdit).toBe(true);
  expect(draft.value).toBe('Keep this draft');
  expect(draft.closest('[hidden]')).toBeNull();
});

test('only typed temporary failures permit bounded automatic retries', () => {
  render(<Component />);
  const shouldRetry = state.queryConfig?.shouldRetryOnError;
  expect(state.queryConfig?.errorRetryCount).toBe(2);
  expect(typeof shouldRetry).toBe('function');
  if (typeof shouldRetry !== 'function')
    throw new Error('Missing retry policy');
  const error = (name: 'NETWORK_ERROR' | 'ACCESS_DENIED') =>
    new UserFriendlyError({
      status: name === 'NETWORK_ERROR' ? 499 : 403,
      code: name,
      type: name,
      name,
      message: name,
    });
  expect(shouldRetry(error('NETWORK_ERROR'))).toBe(true);
  expect(shouldRetry(error('ACCESS_DENIED'))).toBe(false);
  expect(shouldRetry(new Error('Unknown permission failure'))).toBe(false);
});

test('catalog removal hides an open editor and refreshes lifecycle without discarding its draft', () => {
  const view = render(<Component />);
  const draft = screen.getByLabelText('Local Office draft') as HTMLInputElement;
  fireEvent.change(draft, { target: { value: 'Keep my local draft' } });
  state.catalogVisible = false;
  view.rerender(<Component />);
  expect(state.mutate).toHaveBeenCalledOnce();
  expect(state.capabilities.canEdit).toBe(false);
  expect(draft.closest('[hidden]')).toBeTruthy();
  expect(draft.value).toBe('Keep my local draft');
  state.catalogVisible = true;
  view.rerender(<Component />);
  expect(draft.closest('[hidden]')).toBeNull();
  expect(draft.value).toBe('Keep my local draft');
});

test('resource broadcasts coalesce and permission changes still revalidate immediately', async () => {
  const pending = Promise.withResolvers<unknown>();
  state.mutate.mockReturnValueOnce(pending.promise);
  const view = render(<Component />);
  act(() => {
    for (let index = 0; index < 20; index++)
      state.resourceEvents$!.next({ changed: true });
  });
  expect(state.mutate).toHaveBeenCalledOnce();
  await act(async () => pending.resolve(undefined));
  await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(2));
  const slow = Promise.withResolvers<unknown>();
  state.mutate.mockReturnValueOnce(slow.promise);
  act(() => state.resourceEvents$!.next({ changed: true }));
  act(() => state.accessEvents$!.next({ changed: true }));
  expect(state.mutate).toHaveBeenCalledTimes(4);
  view.unmount();
  await act(async () => slow.resolve(undefined));
  expect(state.mutate).toHaveBeenCalledTimes(4);
});
