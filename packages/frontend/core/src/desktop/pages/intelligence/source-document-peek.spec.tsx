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
import type {
  ButtonHTMLAttributes,
  PropsWithChildren,
  ReactElement,
} from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  canRead: undefined as boolean | undefined,
  rootReady: false,
  docReady: false,
  openedRefs: [] as Array<{
    workspaceId: string;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  navigate: vi.fn(),
  open: vi.fn(),
  previewRender: vi.fn(),
  useGuard: vi.fn(),
  revalidateCan: vi.fn(),
  addPriority: vi.fn(),
  createWorkerOptions: vi.fn(),
  workerOptions: { local: {}, remotes: {} },
  server: {
    id: 'server-a',
    baseUrl: 'https://localmind.example',
    // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the server LiveData API.
    config$: { value: { type: 'Selfhosted' } },
  },
}));

const tokens = vi.hoisted(() => ({
  WorkspacesService: class WorkspacesService {},
  ServerService: class ServerService {},
  GuardService: class GuardService {},
  /* eslint-disable rxjs/finnish -- Symbols identify mocked observable sources. */
  rootReady$: Symbol('rootReady$'),
  docReady$: Symbol('docReady$'),
  /* eslint-enable rxjs/finnish */
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    prefix,
    contentClassName: _contentClassName,
    ...props
  }: PropsWithChildren<
    ButtonHTMLAttributes<HTMLButtonElement> & {
      prefix?: ReactElement;
      contentClassName?: string;
    }
  >) => (
    <button {...props}>
      {prefix}
      {children}
    </button>
  ),
  IconButton: ({
    icon,
    size: _size,
    tooltip: _tooltip,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactElement;
    size?: string;
    tooltip?: string;
  }) => <button {...props}>{icon}</button>,
}));

vi.mock('@affine/component/page-detail-skeleton', () => ({
  PageDetailLoading: () => <div data-testid="peek-loading" />,
}));

vi.mock('@affine/core/components/guard', () => ({
  useGuard: (...args: unknown[]) => {
    testState.useGuard(...args);
    return testState.canRead;
  },
}));

vi.mock('@affine/core/desktop/pages/404', () => ({
  PageNotFound: ({ noPermission }: { noPermission?: boolean }) => (
    <div data-testid="peek-not-found" data-no-permission={noPermission} />
  ),
}));

vi.mock('@affine/core/modules/cloud', () => ({
  ServerService: tokens.ServerService,
}));

vi.mock('@affine/core/modules/peek-view/view/doc-preview', () => ({
  DocPeekPreview: (props: { docRef: { docId: string } }) => {
    testState.previewRender(props);
    return (
      <div data-testid="doc-peek-preview" data-doc-id={props.docRef.docId} />
    );
  },
}));

vi.mock('@affine/core/modules/permissions', () => ({
  GuardService: tokens.GuardService,
}));

vi.mock('@affine/core/modules/workspace', () => ({
  WorkspacesService: tokens.WorkspacesService,
}));

vi.mock('@affine/core/modules/workspace-engine', () => ({
  createDocumentScopedWorkerInitOptions: (...args: unknown[]) => {
    testState.createWorkerOptions(...args);
    return testState.workerOptions;
  },
}));

vi.mock('@affine/graphql', () => ({
  ServerDeploymentType: { Selfhosted: 'Selfhosted' },
}));

vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => () => {
          if (key === 'com.affine.localmind.workbench.openInWorkspace') {
            return 'Open in workspace';
          }
          if (key === 'com.affine.localmind.workbench.closePreview') {
            return 'Close preview';
          }
          if (key === 'com.affine.localmind.workbench.documentPreview') {
            return 'Document preview';
          }
          return String(key);
        },
      }
    ),
}));

vi.mock('@blocksuite/icons/rc', () => ({
  CloseIcon: () => <svg aria-hidden="true" />,
  OpenInNewIcon: () => <svg aria-hidden="true" />,
}));

vi.mock('@toeverything/infra', () => ({
  FrameworkScope: ({
    children,
    scope,
  }: PropsWithChildren<{ scope: unknown }>) => (
    <div data-testid="source-workspace-scope" data-scope={String(scope)}>
      {children}
    </div>
  ),
  LiveData: { from: (source: unknown) => source },
  useLiveData: (source: unknown) => {
    if (source === tokens.rootReady$) return testState.rootReady;
    if (source === tokens.docReady$) return testState.docReady;
    return undefined;
  },
  useService: (token: unknown) => {
    if (token === tokens.WorkspacesService) return { open: testState.open };
    if (token === tokens.ServerService) return { server: testState.server };
    if (token === tokens.GuardService) {
      return { revalidateCan: testState.revalidateCan };
    }
    throw new Error('Unexpected service token');
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => testState.navigate,
}));

import { SourceDocumentPeek } from './source-document-peek';

const renderPeek = (
  props: Partial<Parameters<typeof SourceDocumentPeek>[0]> = {}
) =>
  render(
    <SourceDocumentPeek
      workspaceId="workspace-a"
      docId="doc-a"
      requestedLevel="read"
      {...props}
    />
  );

describe('SourceDocumentPeek', () => {
  beforeEach(() => {
    testState.canRead = undefined;
    testState.rootReady = false;
    testState.docReady = false;
    testState.openedRefs.length = 0;
    testState.navigate.mockReset();
    testState.open.mockReset();
    testState.previewRender.mockReset();
    testState.useGuard.mockReset();
    testState.revalidateCan.mockReset();
    testState.addPriority.mockReset();
    testState.createWorkerOptions.mockReset();
    testState.open.mockImplementation(
      ({ metadata }: { metadata: { id: string } }) => {
        const dispose = vi.fn();
        testState.openedRefs.push({ workspaceId: metadata.id, dispose });
        // eslint-disable-next-line rxjs/finnish -- Mock preserves the document observable factory API.
        const docState$ = (docId: string) => ({
          pipe: () =>
            docId === metadata.id ? tokens.rootReady$ : tokens.docReady$,
        });
        return {
          workspace: {
            id: metadata.id,
            scope: `scope:${metadata.id}`,
            engine: {
              // eslint-disable-next-line rxjs/finnish -- Mock key mirrors the document engine API.
              doc: { docState$, addPriority: testState.addPriority },
            },
          },
          dispose,
        };
      }
    );
  });

  afterEach(cleanup);

  test('opens an isolated scoped workspace without consulting workspace membership', async () => {
    testState.canRead = true;
    testState.rootReady = true;
    testState.docReady = true;
    renderPeek();

    await screen.findByTestId('doc-peek-preview');
    expect(testState.createWorkerOptions).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      docId: 'doc-a',
      access: 'read',
      serverBaseUrl: 'https://localmind.example',
      isSelfHosted: true,
    });
    expect(testState.open).toHaveBeenCalledWith(
      {
        metadata: { id: 'workspace-a', flavour: 'server-a' },
        docScopeId: 'doc-a',
        docScopeAccess: 'read',
      },
      testState.workerOptions
    );
    expect(testState.useGuard).toHaveBeenCalledWith('Doc_Read', 'doc-a');
    expect(testState.addPriority).toHaveBeenCalledWith('doc-a', 10);
  });

  test('waits for both the synthetic root and target doc before rendering', async () => {
    testState.canRead = true;
    const { rerender } = renderPeek();

    expect(screen.getByTestId('peek-loading')).not.toBeNull();
    expect(screen.queryByTestId('doc-peek-preview')).toBeNull();

    testState.rootReady = true;
    rerender(
      <SourceDocumentPeek
        workspaceId="workspace-a"
        docId="doc-a"
        requestedLevel="read"
      />
    );
    expect(screen.queryByTestId('doc-peek-preview')).toBeNull();

    testState.docReady = true;
    rerender(
      <SourceDocumentPeek
        workspaceId="workspace-a"
        docId="doc-a"
        requestedLevel="read"
      />
    );
    expect(await screen.findByTestId('doc-peek-preview')).not.toBeNull();
  });

  test('closes and disposes when a live read grant is revoked', async () => {
    testState.canRead = true;
    testState.rootReady = true;
    testState.docReady = true;
    const onClose = vi.fn();
    const { rerender } = renderPeek({ onClose });
    await screen.findByTestId('doc-peek-preview');
    const ref = testState.openedRefs[0];

    testState.canRead = false;
    rerender(
      <SourceDocumentPeek
        workspaceId="workspace-a"
        docId="doc-a"
        requestedLevel="read"
        onClose={onClose}
      />
    );

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(ref.dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Document preview')).toBeNull();
  });

  test('opens the full route with a matching server, scope, and access cap', async () => {
    testState.canRead = true;
    testState.rootReady = true;
    testState.docReady = true;
    renderPeek({ requestedLevel: 'write', title: 'A source document' });

    await screen.findByTestId('doc-peek-preview');
    fireEvent.click(screen.getByRole('button', { name: 'Open in workspace' }));

    expect(testState.navigate).toHaveBeenCalledWith(
      '/workspace/workspace-a/doc-a?server=https%3A%2F%2Flocalmind.example&docScope=doc-a&access=write'
    );
  });

  test('disposes scoped workspace refs on selection change, close, and unmount', async () => {
    testState.canRead = true;
    testState.rootReady = true;
    testState.docReady = true;
    const onClose = vi.fn();
    const { rerender, unmount } = renderPeek({ onClose });
    await screen.findByTestId('doc-peek-preview');
    const firstRef = testState.openedRefs[0];

    rerender(
      <SourceDocumentPeek
        workspaceId="workspace-b"
        docId="doc-b"
        requestedLevel="read"
        onClose={onClose}
      />
    );

    await waitFor(() => expect(testState.open).toHaveBeenCalledTimes(2));
    expect(firstRef.dispose).toHaveBeenCalledTimes(1);
    const secondRef = testState.openedRefs[1];

    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(secondRef.dispose).toHaveBeenCalledTimes(1);

    unmount();
    expect(secondRef.dispose).toHaveBeenCalledTimes(1);
  });

  test('fails closed when the scoped workspace cannot be opened', async () => {
    testState.open.mockImplementationOnce(() => {
      throw new Error('open failed');
    });
    renderPeek();

    await screen.findByTestId('peek-not-found');
    expect(testState.useGuard).not.toHaveBeenCalled();
    expect(testState.previewRender).not.toHaveBeenCalled();
  });
});
