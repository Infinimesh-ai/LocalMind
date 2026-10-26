/** @vitest-environment happy-dom */
import { uploadProjectBlobWithProgress } from '@affine/core/modules/project-resources/upload';
import { UserFriendlyError } from '@affine/error';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  gql: vi.fn(),
  confirm: vi.fn(),
  confirmUnsaved: vi.fn(async () => true),
  upload: vi.fn(),
  folders: new Map<string | null, unknown[]>(),
  reportDeckAvailable: false,
  openReportDeck: vi.fn(),
}));
vi.mock('@affine/core/components/report-deck-entry', () => ({
  useReportDeckEntryAvailable: () => mock.reportDeckAvailable,
  useOpenReportDeck: () => mock.openReportDeck,
}));
vi.mock('@affine/core/modules/cloud', () => ({
  GraphQLService: class {},
  ServerService: class {},
}));
vi.mock('@affine/core/modules/project-resources/edit-guard', () => ({
  useProjectUnsavedConfirmation: () => mock.confirmUnsaved,
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => ({
    gql: mock.gql,
    server: { serverMetadata: { baseUrl: 'http://localhost' } },
  }),
}));
vi.mock('@affine/i18n', () => ({
  getOrCreateI18n: () => ({ t: (key: string) => key }),
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@affine/core/modules/project-resources/upload', () => ({
  uploadProjectBlobWithProgress: vi.fn(async () => 'blob-key'),
}));
vi.mock('./project-files-data', () => ({
  uploadProjectFile: (...args: unknown[]) => mock.upload(...args),
  useProjectFolder: ({ parentId }: { parentId: string | null }) => ({
    items: mock.folders.get(parentId) ?? [],
    isLoading: false,
    hasMore: false,
    error: null,
  }),
}));
vi.mock('./project-workspace-import', () => ({
  ProjectWorkspaceImportStatus: () => null,
  ProjectWorkspaceImportPicker: ({
    projectId,
    parentId,
  }: {
    projectId: string;
    parentId: string | null;
  }) => (
    <div data-testid="workspace-picker">
      {projectId}:{parentId}
    </div>
  ),
}));
vi.mock('@affine/component', () => ({
  useConfirmModal: () => ({ openConfirmModal: mock.confirm }),
  notify: { error: vi.fn() },
  Loading: () => <span>Loading</span>,
  Button: ({
    children,
    onClick,
    disabled,
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  IconButton: ({
    icon,
    onClick,
    disabled,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={props['aria-label']}
      aria-expanded={props['aria-expanded']}
      aria-pressed={props['aria-pressed']}
    >
      {icon}
    </button>
  ),
  Input: ({
    onChange,
    value,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={props['aria-label']}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  ),
  Menu: ({ children, items }: PropsWithChildren<{ items: ReactNode }>) => (
    <>
      {children}
      {items}
    </>
  ),
  MenuItem: ({
    children,
    onClick,
    disabled,
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Modal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? <div role="dialog">{children}</div> : null,
  useDraggable: () => ({ dragRef: { current: null }, dragging: false }),
  useDropTarget: () => ({
    dropTargetRef: { current: null },
    draggedOver: false,
  }),
}));

import {
  acquireProjectResourceEditLeaseMutation,
  changeProjectResourceMutation,
  createProjectResourceMutation,
  permanentlyDeleteProjectResourceMutation,
  projectResourcePathQuery,
  releaseProjectResourceEditLeaseMutation,
} from '@affine/graphql';

import { ProjectFiles, ProjectFileSelectionTree } from './project-files';

const file = (id: string, kind = 'page', parentId: string | null = null) => ({
  id,
  title: id,
  projectId: 'project-1',
  parentId,
  kind,
  version: 1,
  contentVersion: 1,
});
beforeEach(() => {
  mock.confirmUnsaved.mockReset().mockResolvedValue(true);
  vi.clearAllMocks();
  mock.reportDeckAvailable = false;
  mock.folders.clear();
  mock.folders.set(null, [
    file('Alpha'),
    file('Beta'),
    file('Reports', 'folder'),
  ]);
  mock.folders.set('Reports', [file('Report', 'page', 'Reports')]);
});
afterEach(cleanup);

describe('Project file tree', () => {
  test('cancelling the active editor decision prevents batch writes and retains selection', async () => {
    mock.confirmUnsaved.mockResolvedValue(false);
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.selectResources',
      })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.batchTrash',
      })
    );
    await act(() => mock.confirm.mock.calls.at(-1)![0].onConfirm());
    expect(mock.gql).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Alpha' }).checked
    ).toBe(true);
  });

  test('batch trash keeps failed selections and reuses their request keys on retry', async () => {
    let failBeta = true;
    mock.gql.mockImplementation(async request => {
      if (request.query === projectResourcePathQuery)
        return {
          projectResourcePath: [
            {
              id: request.variables.resourceId,
              title: request.variables.resourceId,
            },
          ],
        };
      if (
        request.query === changeProjectResourceMutation &&
        request.variables.input.resourceId === 'Beta' &&
        failBeta
      )
        throw new Error('conflict');
      return {
        changeProjectResource: file(request.variables.input?.resourceId ?? ''),
      };
    });
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.selectResources',
      })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.batchTrash',
      })
    );
    await act(() => mock.confirm.mock.calls.at(-1)![0].onConfirm());
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Alpha' }).checked
    ).toBe(false);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Beta' }).checked
    ).toBe(true);
    const firstKey = mock.gql.mock.calls.find(
      ([request]) =>
        request.query === changeProjectResourceMutation &&
        request.variables.input.resourceId === 'Beta'
    )![0].variables.input.requestKey;
    failBeta = false;
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.batchTrash',
      })
    );
    await act(() => mock.confirm.mock.calls.at(-1)![0].onConfirm());
    const betaWrites = mock.gql.mock.calls.filter(
      ([request]) =>
        request.query === changeProjectResourceMutation &&
        request.variables.input.resourceId === 'Beta'
    );
    expect(betaWrites).toHaveLength(2);
    expect(betaWrites[1][0].variables.input.requestKey).toBe(firstKey);
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Beta' }).checked
    ).toBe(false);
  });

  test('a selected folder covers its selected descendants without issuing duplicate writes', async () => {
    mock.gql.mockImplementation(async request =>
      request.query === projectResourcePathQuery
        ? {
            projectResourcePath:
              request.variables.resourceId === 'Report'
                ? [{ id: 'Reports' }, { id: 'Report' }]
                : [{ id: 'Reports' }],
          }
        : { changeProjectResource: file('Reports', 'folder') }
    );
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.selectResources',
      })
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reports' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Reports' })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Report' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.batchTrash',
      })
    );
    await act(() => mock.confirm.mock.calls.at(-1)![0].onConfirm());
    const writes = mock.gql.mock.calls.filter(
      ([request]) => request.query === changeProjectResourceMutation
    );
    expect(writes).toHaveLength(1);
    expect(writes[0][0].variables.input).toMatchObject({
      resourceId: 'Reports',
      expectedVersion: 1,
      trash: true,
    });
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Reports' })
        .checked
    ).toBe(false);
  });

  test('presents selected project resources as a report deck after the unsaved check', async () => {
    mock.reportDeckAvailable = true;
    mock.folders.set(null, [
      file('Alpha'),
      file('Sheet', 'workbook'),
      file('Reports', 'folder'),
    ]);
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.selectResources',
      })
    );
    const present = screen.getByRole('button', {
      name: 'com.affine.localmind.reportDeck.entry',
    });
    expect(present.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sheet' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reports' }));
    mock.confirmUnsaved.mockResolvedValueOnce(false);
    await act(async () => fireEvent.click(present));
    expect(mock.openReportDeck).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(present));
    expect(mock.openReportDeck).toHaveBeenCalledExactlyOnceWith(
      ['Alpha', 'Sheet', 'Reports'].map((id, index) => ({
        scopeKind: 'project',
        scopeId: 'project-1',
        kind: ['doc', 'file', 'folder'][index],
        resourceId: id,
        title: id,
      }))
    );
  });

  test('hides the report deck entry without AI', () => {
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.selectResources',
      })
    );
    expect(
      screen.queryByRole('button', {
        name: 'com.affine.localmind.reportDeck.entry',
      })
    ).toBeNull();
  });

  test('renaming an existing document obtains proof and releases it after the write', async () => {
    mock.gql.mockImplementation(async ({ query }) =>
      query === acquireProjectResourceEditLeaseMutation
        ? {
            acquireProjectResourceEditLease: {
              acquired: true,
              lease: {
                owned: true,
                leaseId: 'rename-lease',
                expiresAt: new Date(Date.now() + 60000).toISOString(),
              },
            },
          }
        : query === releaseProjectResourceEditLeaseMutation
          ? { releaseProjectResourceEditLease: true }
          : {}
    );
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    const alpha = screen.getByRole('button', { name: 'Alpha' }).closest('li')!;
    fireEvent.click(
      within(alpha).getByText('com.affine.localmind.project-files.rename')
    );
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), {
      target: { value: 'Renamed document' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.project-files.save',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const write = mock.gql.mock.calls.find(
      ([request]) => request.query === changeProjectResourceMutation
    )![0];
    expect(write.variables.input).toMatchObject({
      resourceId: 'Alpha',
      title: 'Renamed document',
      editLease: { leaseId: 'rename-lease', tabId: expect.any(String) },
    });
    expect(mock.gql.mock.calls.at(-1)![0].query).toBe(
      releaseProjectResourceEditLeaseMutation
    );
  });

  test('permanent deletion is only available in trash and requires explicit destructive confirmation', async () => {
    mock.gql.mockResolvedValue({ permanentlyDeleteProjectResource: true });
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    expect(
      screen.queryByText('com.affine.localmind.project-files.permanentlyDelete')
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.project-files.trash',
      })
    );
    fireEvent.click(
      screen.getAllByText(
        'com.affine.localmind.project-files.permanentlyDelete'
      )[0]
    );
    expect(mock.gql).not.toHaveBeenCalled();
    const confirmation = mock.confirm.mock.calls[0][0];
    expect(confirmation.confirmButtonOptions.variant).toBe('error');
    await act(() => confirmation.onConfirm());
    expect(mock.gql).toHaveBeenCalledWith(
      expect.objectContaining({
        query: permanentlyDeleteProjectResourceMutation,
        variables: {
          input: expect.objectContaining({
            projectId: 'project-1',
            resourceId: 'Alpha',
            expectedVersion: 1,
          }),
        },
      })
    );
  });
  test('create immediately opens an untitled resource and does not show a naming form', async () => {
    const open = vi.fn();
    mock.gql.mockResolvedValue({
      createProjectResource: { id: 'created', kind: 'page' },
    });
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={open}
      />
    );
    fireEvent.click(
      screen.getAllByText('com.affine.localmind.project-files.newDocument')[0]
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(open).toHaveBeenCalledWith('created'));
    expect(mock.gql).toHaveBeenCalledWith({
      query: createProjectResourceMutation,
      variables: {
        input: expect.objectContaining({
          projectId: 'project-1',
          title: 'Untitled',
          parentId: null,
        }),
      },
    });
  });

  test('pending changes only disable the affected row and reject repeated submissions', async () => {
    const pending = Promise.withResolvers<void>();
    mock.gql.mockReturnValue(pending.promise);
    render(
      <ProjectFiles
        projectId="project-1"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    const alpha = screen.getByRole('button', { name: 'Alpha' }).closest('li')!;
    const beta = screen.getByRole('button', { name: 'Beta' }).closest('li')!;
    fireEvent.click(
      within(alpha).getByText('com.affine.localmind.project-files.delete')
    );
    expect(
      within(alpha)
        .getByText('com.affine.localmind.project-files.delete')
        .hasAttribute('disabled')
    ).toBe(true);
    expect(
      within(beta)
        .getByText('com.affine.localmind.project-files.delete')
        .hasAttribute('disabled')
    ).toBe(false);
    fireEvent.click(
      within(alpha).getByText('com.affine.localmind.project-files.delete')
    );
    fireEvent.click(
      within(beta).getByText('com.affine.localmind.project-files.delete')
    );
    expect(mock.gql).toHaveBeenCalledTimes(2);
    expect(mock.gql.mock.calls[0][0]).toMatchObject({
      query: changeProjectResourceMutation,
      variables: {
        input: { resourceId: 'Alpha', trash: true, expectedVersion: 1 },
      },
    });
    await act(() => {
      pending.resolve();
      return pending.promise;
    });
  });

  test('folder expansion and multiselect issue no write mutations', () => {
    const toggle = vi.fn();
    render(
      <ProjectFileSelectionTree
        projectId="project-1"
        selected={new Set(['Alpha'])}
        disabled={false}
        onToggle={toggle}
      />
    );
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Alpha' }).checked
    ).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reports' })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Report' }));
    expect(toggle).toHaveBeenCalledWith('Report');
    expect(
      screen.queryByText('com.affine.localmind.project-files.delete')
    ).toBeNull();
    expect(mock.gql).not.toHaveBeenCalled();
  });

  test('multiple files are queued into the current directory without blocking existing items', async () => {
    const pending = Promise.withResolvers<void>();
    mock.upload.mockReturnValue(pending.promise);
    const { container } = render(
      <ProjectFiles
        projectId="project-1"
        parentId="Reports"
        selectedResourceId={null}
        onOpen={vi.fn()}
      />
    );
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.pdf')];
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files },
    });
    expect(mock.upload).toHaveBeenCalledTimes(2);
    expect(mock.upload.mock.calls.map(([, input]) => input.parentId)).toEqual([
      'Reports',
      'Reports',
    ]);
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Report' }).hasAttribute('disabled')
    ).toBe(false);
    await act(() => {
      pending.resolve();
      return pending.promise;
    });
    expect(
      screen.getAllByText('com.affine.localmind.project-files.upload.completed')
    ).toHaveLength(2);
  });

  test('rate-limited imports wait visibly and reuse the uploaded blob and request key', async () => {
    vi.useFakeTimers();
    try {
      const throttled = new UserFriendlyError({
        status: 429,
        name: 'TOO_MANY_REQUEST',
        code: 'too_many_requests',
        type: 'too_many_request',
        message: 'Too many requests',
        retryAfterMs: 1000,
      });
      mock.upload
        .mockImplementationOnce(async (_graphql, input) => {
          await input.uploadBlob(input.file);
          throw throttled;
        })
        .mockImplementationOnce(async (_graphql, input) => {
          await input.uploadBlob(input.file);
          return 'imported-file';
        });
      const { container } = render(
        <ProjectFiles
          projectId="project-1"
          parentId="Reports"
          selectedResourceId={null}
          onOpen={vi.fn()}
        />
      );
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: { files: [new File(['pdf'], 'test.pdf')] },
      });
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(
        screen.queryByText(
          'com.affine.localmind.project-files.upload.waitingForLimit'
        )
      ).not.toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(
        screen.queryByText(
          'com.affine.localmind.project-files.upload.completed'
        )
      ).not.toBeNull();
      expect(mock.upload).toHaveBeenCalledTimes(2);
      expect(mock.upload.mock.calls[0][1].requestKey).toBe(
        mock.upload.mock.calls[1][1].requestKey
      );
      expect(uploadProjectBlobWithProgress).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

test('workspace import entry opens the picker for the current Project folder', () => {
  render(
    <ProjectFiles
      projectId="project-1"
      parentId="Reports"
      selectedResourceId={null}
      onOpen={vi.fn()}
    />
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.workspace-import.title',
    })
  );
  expect(screen.getByTestId('workspace-picker').textContent).toBe(
    'project-1:Reports'
  );
});
