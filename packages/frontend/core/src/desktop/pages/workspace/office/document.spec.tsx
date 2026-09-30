/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  resource: {
    id: 'pdf',
    title: 'report.pdf',
    canEdit: true,
    trashedAt: null as string | null,
  },
  error: null as Error | null,
  capabilities: {} as Record<string, boolean>,
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ artifactId: 'pdf' }),
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: () => ({
    data: { workspaceNativeResource: state.resource },
    error: state.error,
    mutate: async () => {},
  }),
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/storage', () => ({ NbstoreService: class {} }));
vi.mock('@affine/core/modules/workspace', () => ({
  WorkspaceService: class {},
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
  return {
    useService: () => ({
      workspace: { id: 'workspace' },
      workbench: {},
      view: { history: { block: () => () => {} } },
      realtime: { subscribe: () => empty$ },
    }),
  };
});
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/component', () => ({ Button: () => null }));
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
