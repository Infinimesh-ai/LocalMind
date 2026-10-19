/** @vitest-environment happy-dom */
import {
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
  KeyboardEventHandler,
  PropsWithChildren,
  ReactNode,
} from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  gql: vi.fn(),
  confirm: vi.fn(),
  confirmUnsaved: vi.fn(async () => true),
  folders: new Map<string, unknown[]>(),
  paths: new Map<string, unknown[]>(),
}));
vi.mock('@affine/core/components/report-deck-entry', () => ({
  useReportDeckEntryAvailable: () => true,
  useOpenReportDeck: () => vi.fn(),
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
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: (request?: { variables: { resourceId: string } }) => ({
    data: request
      ? {
          projectResourcePath:
            mock.paths.get(request.variables.resourceId) ?? [],
        }
      : undefined,
    mutate: vi.fn(),
  }),
}));
vi.mock('../project-files-data', () => ({
  uploadProjectFile: vi.fn(),
  useProjectFolder: ({
    projectId,
    parentId,
    trash,
  }: {
    projectId: string;
    parentId: string | null;
    trash?: boolean;
  }) => ({
    items:
      mock.folders.get(
        `${projectId}:${trash ? 'trash' : (parentId ?? 'root')}`
      ) ?? [],
    isLoading: false,
    hasMore: false,
    error: null,
    retry: vi.fn(),
    loadMore: vi.fn(),
  }),
}));
vi.mock('../project-workspace-import', () => ({
  ProjectWorkspaceImportStatus: () => null,
  ProjectWorkspaceImportPicker: () => <div data-testid="workspace-picker" />,
}));
vi.mock('../project-resource-preview', () => ({
  ProjectResourcePreview: ({ resourceId }: { resourceId: string }) => (
    <div data-testid="resource-preview">{resourceId}</div>
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
    ...props
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={props['aria-pressed']}
    >
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
      aria-pressed={props['aria-pressed']}
    >
      {icon}
    </button>
  ),
  Input: ({
    onChange,
    value,
    onKeyDown,
    ...props
  }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (value: string) => void;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  }) => (
    <input
      aria-label={props['aria-label']}
      value={value}
      onKeyDown={onKeyDown}
      onChange={event => onChange(event.target.value)}
    />
  ),
  Menu: ({ children }: PropsWithChildren) => children,
  ContextMenu: ({ children }: PropsWithChildren) => children,
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

import { searchProjectResourcesQuery } from '@affine/graphql';

import type { WorkbenchProject } from '../types';
import { ProjectBrowser } from './index';
import {
  readRecentProjectFiles,
  RECENT_LIMIT,
  recordRecentProjectFile,
} from './recent';
import { ProjectBrowserSidebar } from './sidebar';
import {
  BROWSER_PREFS_KEY,
  type BrowserLocation,
  sortProjectFiles,
  useProjectBrowserState,
} from './use-browser-state';

const file = (
  id: string,
  kind = 'page',
  parentId: string | null = null,
  updatedAt = '2026-10-01T00:00:00.000Z',
  projectId = 'project-1'
) => ({
  id,
  title: id,
  projectId,
  parentId,
  kind,
  version: 1,
  contentVersion: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt,
});
const project = (id: string, name: string, status = 'active') =>
  ({ id, name, status }) as WorkbenchProject;
const projects = [
  project('project-1', 'Alpha project'),
  project('project-2', 'Beta project'),
];
const onOpen = vi.fn();

const initialLocation: BrowserLocation = {
  projectId: 'project-1',
  folderId: null,
};

function Harness({
  initial = initialLocation,
  list = projects,
  loading = false,
  error,
}: {
  initial?: BrowserLocation;
  list?: WorkbenchProject[];
  loading?: boolean;
  error?: string;
}) {
  const [location, setLocation] = useState(initial);
  const state = useProjectBrowserState({ location, onNavigate: setLocation });
  return (
    <>
      <ProjectBrowser
        projects={list.filter(item => item.status === 'active')}
        projectsLoading={loading}
        projectsError={error}
        onRetryProjects={vi.fn()}
        projectId={location.projectId}
        folderId={location.folderId}
        state={state}
        onOpen={onOpen}
      />
      <output data-testid="location">
        {`${location.projectId ?? '-'}/${location.folderId ?? 'root'}`}
      </output>
    </>
  );
}

const options = (name: string) =>
  within(screen.getByRole('listbox', { name }))
    .getAllByRole('option')
    .map(option => option.getAttribute('title'));
const option = (title: string) =>
  screen
    .getAllByRole('option')
    .find(element => element.getAttribute('title') === title) as HTMLElement;
const view = (mode: string) =>
  `com.affine.localmind.project-browser.view.${mode}`;

beforeEach(() => {
  vi.clearAllMocks();
  mock.confirmUnsaved.mockResolvedValue(true);
  window.localStorage.clear();
  mock.folders.clear();
  mock.paths.clear();
  mock.folders.set('project-1:root', [
    file('beta.md', 'file', null, '2026-10-03T00:00:00.000Z'),
    file('Reports', 'folder', null, '2026-10-01T00:00:00.000Z'),
    file('alpha', 'page', null, '2026-10-02T00:00:00.000Z'),
  ]);
  mock.folders.set('project-1:Reports', [
    file('Q3 report', 'page', 'Reports'),
    file('Q4 report', 'edgeless', 'Reports'),
  ]);
  mock.folders.set('project-1:trash', [file('Old draft')]);
  mock.paths.set('Reports', [file('Reports', 'folder')]);
});
afterEach(cleanup);

describe('Project browser', () => {
  test('persists the view mode and sort across mounts', () => {
    const first = render(<Harness />);
    expect(screen.getByRole('listbox', { name: view('icons') })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: view('list') }));
    expect(
      screen
        .getByRole('button', { name: view('list') })
        .getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.click(
      screen.getByRole('columnheader', {
        name: 'com.affine.localmind.project-browser.sort.modified',
      })
    );
    expect(JSON.parse(window.localStorage.getItem(BROWSER_PREFS_KEY)!)).toEqual(
      { viewMode: 'list', sort: { key: 'modified', direction: 'asc' } }
    );
    first.unmount();
    render(<Harness />);
    expect(screen.getByRole('listbox', { name: view('list') })).not.toBeNull();
    expect(options(view('list'))).toEqual(['Reports', 'alpha', 'beta.md']);
  });

  test('sorts the list by its column headers with folders first and expands folders inline', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: view('list') }));
    // Manual order keeps the server order.
    expect(options(view('list'))).toEqual(['beta.md', 'Reports', 'alpha']);
    const name = screen.getByRole('columnheader', {
      name: 'com.affine.localmind.project-browser.sort.name',
    });
    fireEvent.click(name);
    expect(name.getAttribute('aria-sort')).toBe('ascending');
    expect(options(view('list'))).toEqual(['Reports', 'alpha', 'beta.md']);
    fireEvent.click(name);
    expect(name.getAttribute('aria-sort')).toBe('descending');
    expect(options(view('list'))).toEqual(['Reports', 'beta.md', 'alpha']);
    fireEvent.click(
      within(option('Reports')).getByRole('button', { name: 'Reports' })
    );
    expect(options(view('list'))).toEqual([
      'Reports',
      'Q4 report',
      'Q3 report',
      'beta.md',
      'alpha',
    ]);
    // Expanding inline does not navigate.
    expect(screen.getByTestId('location').textContent).toBe('project-1/root');
  });

  test('selects with click, Cmd-click and Shift-click and offers batch actions', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: view('list') }));
    fireEvent.click(option('beta.md'));
    expect(option('beta.md').getAttribute('aria-selected')).toBe('true');
    expect(
      screen.queryByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.batchMove',
      })
    ).toBeNull();
    fireEvent.click(option('alpha'), { metaKey: true });
    expect(option('beta.md').getAttribute('aria-selected')).toBe('true');
    expect(option('alpha').getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByRole('button', {
        name: 'com.affine.localmind.workbench.fusion.batchMove',
      })
    ).not.toBeNull();
    fireEvent.click(option('alpha'));
    fireEvent.click(option('beta.md'), { shiftKey: true });
    expect(
      ['beta.md', 'Reports', 'alpha'].map(title =>
        option(title).getAttribute('aria-selected')
      )
    ).toEqual(['true', 'true', 'true']);
  });

  test('moves the selection with arrow keys, opens with Enter and quick-looks with Space', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: view('list') }));
    fireEvent.click(option('beta.md'));
    fireEvent.keyDown(option('beta.md'), { key: 'ArrowDown' });
    expect(option('Reports').getAttribute('aria-selected')).toBe('true');
    expect(option('beta.md').getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(option('Reports'), { key: 'ArrowDown' });
    expect(option('alpha').getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(option('alpha'), { key: ' ' });
    expect(
      within(screen.getByTestId('project-browser-quick-look')).getByTestId(
        'resource-preview'
      ).textContent
    ).toBe('alpha');
    fireEvent.keyDown(option('alpha'), { key: ' ' });
    expect(screen.queryByTestId('project-browser-quick-look')).toBeNull();
    fireEvent.keyDown(option('alpha'), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('project-1', 'alpha');
  });

  test('double click enters folders and back/forward walk the browser history', () => {
    render(<Harness />);
    const back = screen.getByRole('button', {
      name: 'com.affine.localmind.project-browser.back',
    });
    const forward = screen.getByRole('button', {
      name: 'com.affine.localmind.project-browser.forward',
    });
    expect(back).toHaveProperty('disabled', true);
    fireEvent.doubleClick(option('Reports'));
    expect(screen.getByTestId('location').textContent).toBe(
      'project-1/Reports'
    );
    expect(options(view('icons'))).toEqual(['Q3 report', 'Q4 report']);
    const path = screen.getByRole('navigation', {
      name: 'com.affine.localmind.project-browser.path',
    });
    expect(
      within(path)
        .getAllByRole('button')
        .map(crumb => crumb.textContent)
    ).toEqual([
      'com.affine.localmind.project-browser.allProjects',
      'Alpha project',
      'Reports',
    ]);
    fireEvent.click(back);
    expect(screen.getByTestId('location').textContent).toBe('project-1/root');
    expect(forward).toHaveProperty('disabled', false);
    fireEvent.click(forward);
    expect(screen.getByTestId('location').textContent).toBe(
      'project-1/Reports'
    );
    fireEvent.click(
      within(path).getByRole('button', { name: 'Alpha project' })
    );
    expect(screen.getByTestId('location').textContent).toBe('project-1/root');
  });

  test('navigates Miller columns and previews the selected file in the last column', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: view('columns') }));
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    fireEvent.click(option('Reports'));
    expect(screen.getByTestId('location').textContent).toBe(
      'project-1/Reports'
    );
    const columns = screen.getAllByRole('listbox');
    expect(columns).toHaveLength(2);
    expect(option('Reports').dataset.open).toBe('true');
    expect(within(columns[1]).getAllByRole('option')).toHaveLength(2);
    fireEvent.click(option('Q3 report'));
    expect(screen.getByTestId('resource-preview').textContent).toBe(
      'Q3 report'
    );
    fireEvent.keyDown(option('Q3 report'), { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getByTestId('resource-preview').textContent).toBe(
        'Q4 report'
      )
    );
    expect(mock.confirmUnsaved).toHaveBeenCalled();
    fireEvent.keyDown(option('Q4 report'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('location').textContent).toBe('project-1/root');
    await waitFor(() =>
      expect(option('Reports').getAttribute('aria-selected')).toBe('true')
    );
    expect(screen.queryByTestId('resource-preview')).toBeNull();
  });

  test('shows the selected item large in the gallery and moves with arrow keys', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: view('gallery') }));
    // The first item is on stage right away.
    expect(screen.getByTestId('resource-preview').textContent).toBe('beta.md');
    fireEvent.keyDown(option('beta.md'), { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getByTestId('browser-item-summary').textContent).toContain(
        'Reports'
      )
    );
    fireEvent.keyDown(option('Reports'), { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getByTestId('resource-preview').textContent).toBe('alpha')
    );
    fireEvent.doubleClick(option('alpha'));
    expect(onOpen).toHaveBeenCalledWith('project-1', 'alpha');
  });

  test('shows the project trash with restore actions instead of the folder', () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.project-files.trash',
      })
    );
    expect(options(view('icons'))).toEqual(['Old draft']);
    fireEvent.doubleClick(option('Old draft'));
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', {
        name: 'com.affine.localmind.project-files.upload',
      })
    ).toHaveProperty('disabled', true);
  });

  test('searches all projects by default, groups results and narrows to the current project', async () => {
    mock.gql.mockImplementation(
      async ({
        query,
        variables,
      }: {
        query: unknown;
        variables: { projectId: string; limit: number };
      }) => {
        if (query !== searchProjectResourcesQuery)
          throw new Error('unexpected');
        return {
          searchProjectResources: {
            nextCursor: null,
            items: [
              {
                id: `${variables.projectId}-hit`,
                projectId: variables.projectId,
                title: `Report for ${variables.projectId}`,
                kind: 'page',
                contentVersion: 1,
                snippet: 'Quarterly report draft',
                path: [
                  { id: 'Reports', title: 'Reports' },
                  {
                    id: `${variables.projectId}-hit`,
                    title: `Report for ${variables.projectId}`,
                  },
                ],
              },
            ],
          },
        };
      }
    );
    render(<Harness />);
    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'com.affine.localmind.project-browser.search.placeholder',
      }),
      { target: { value: 'report' } }
    );
    const alpha = await screen.findByRole('region', { name: 'Alpha project' });
    const beta = screen.getByRole('region', { name: 'Beta project' });
    expect(mock.gql).toHaveBeenCalledTimes(2);
    expect(mock.gql.mock.calls.map(([call]) => call.variables)).toEqual([
      { projectId: 'project-1', query: 'report', limit: 20 },
      { projectId: 'project-2', query: 'report', limit: 20 },
    ]);
    expect(within(alpha).getByText('Alpha project / Reports')).not.toBeNull();
    expect(
      within(beta)
        .getAllByText('report')
        .every(match => match.tagName === 'MARK')
    ).toBe(true);
    fireEvent.doubleClick(
      within(beta).getByRole('button', { name: /Report for project-2/ })
    );
    expect(onOpen).toHaveBeenCalledWith('project-2', 'project-2-hit');

    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.project-browser.search.currentProject',
      })
    );
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Beta project' })).toBeNull()
    );
    expect(
      screen.getByRole('region', { name: 'Alpha project' })
    ).not.toBeNull();

    mock.folders.set('project-1:Reports', [
      file('project-1-hit', 'page', 'Reports'),
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: /Report for project-1/ })
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        'project-1/Reports'
      )
    );
    await waitFor(() =>
      expect(option('project-1-hit').getAttribute('aria-selected')).toBe('true')
    );
    // Revealing leaves the search.
    expect(
      screen.getByRole<HTMLInputElement>('textbox', {
        name: 'com.affine.localmind.project-browser.search.placeholder',
      }).value
    ).toBe('');
  });

  test('Escape clears the search field', async () => {
    mock.gql.mockResolvedValue({
      searchProjectResources: { nextCursor: null, items: [] },
    });
    render(<Harness />);
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'com.affine.localmind.project-browser.search.placeholder',
    });
    fireEvent.change(input, { target: { value: 'nothing' } });
    expect(
      await screen.findByText(
        'com.affine.localmind.workbench.fusion.fileSearchEmpty'
      )
    ).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(screen.getByRole('listbox', { name: view('icons') })).not.toBeNull();
  });

  test.each(['loading', 'error', 'empty'] as const)(
    'shows the %s state of the projects overview',
    status => {
      render(
        <Harness
          initial={{ projectId: null, folderId: null }}
          list={status === 'empty' ? [] : projects}
          loading={status === 'loading'}
          error={status === 'error' ? 'Network unavailable' : undefined}
        />
      );
      if (status === 'loading')
        expect(screen.getByText('Loading')).not.toBeNull();
      else if (status === 'error')
        expect(screen.getByRole('alert').textContent).toContain(
          'Network unavailable'
        );
      else
        expect(
          screen.getByText('com.affine.localmind.workbench.projects.emptyTitle')
        ).not.toBeNull();
    }
  );

  test('lists projects as folders and opens one with double click or Enter', () => {
    render(<Harness initial={{ projectId: null, folderId: null }} />);
    const grid = screen.getByRole('listbox', {
      name: 'com.affine.localmind.project-browser.sidebar.projects',
    });
    const tiles = within(grid).getAllByRole('option');
    expect(tiles.map(tile => tile.textContent)).toEqual([
      'Alpha project',
      'Beta project',
    ]);
    fireEvent.click(tiles[1]);
    expect(tiles[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('location').textContent).toBe('-/root');
    fireEvent.keyDown(tiles[1], { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('project-2/root');
  });
});

describe('Project browser helpers', () => {
  test('sorts by kind and modification time with folders first', () => {
    const items = [
      file('b', 'pdf', null, '2026-10-01T00:00:00.000Z'),
      file('a', 'page', null, '2026-10-03T00:00:00.000Z'),
      file('z', 'folder', null, '2026-10-02T00:00:00.000Z'),
    ] as Parameters<typeof sortProjectFiles>[0];
    const titles = (key: 'kind' | 'modified', direction: 'asc' | 'desc') =>
      sortProjectFiles(items, { key, direction }).map(item => item.title);
    expect(titles('kind', 'asc')).toEqual(['z', 'a', 'b']);
    expect(titles('modified', 'desc')).toEqual(['z', 'a', 'b']);
    expect(titles('modified', 'asc')).toEqual(['z', 'b', 'a']);
  });

  test('records recent files newest first, de-duplicated, capped and per user', () => {
    for (let index = 0; index < RECENT_LIMIT + 5; index++)
      recordRecentProjectFile('user-1', {
        projectId: 'project-1',
        projectName: 'Alpha project',
        resourceId: `doc-${index}`,
        parentId: null,
        title: `Doc ${index}`,
        kind: 'page' as never,
        openedAt: index,
      });
    recordRecentProjectFile('user-1', {
      projectId: 'project-1',
      projectName: 'Alpha project',
      resourceId: 'doc-10',
      parentId: null,
      title: 'Doc 10',
      kind: 'page' as never,
    });
    const recent = readRecentProjectFiles('user-1');
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0].resourceId).toBe('doc-10');
    expect(recent[1].resourceId).toBe(`doc-${RECENT_LIMIT + 4}`);
    expect(recent.filter(entry => entry.resourceId === 'doc-10')).toHaveLength(
      1
    );
    expect(readRecentProjectFiles('user-2')).toEqual([]);
  });
});

describe('Project browser sidebar', () => {
  test('shows recents, projects with archived ones and the trash hint without a project', () => {
    const onSelectProject = vi.fn();
    const onOpenRecent = vi.fn();
    const onOpenTrash = vi.fn();
    const onRestoreProject = vi.fn();
    const recent = Array.from({ length: 8 }, (_, index) => ({
      projectId: 'project-1',
      projectName: 'Alpha project',
      resourceId: `doc-${index}`,
      parentId: null,
      title: `Doc ${index}`,
      kind: 'page' as never,
      openedAt: index,
    }));
    const archived = project('project-3', 'Old project', 'archived');
    const view = render(
      <ProjectBrowserSidebar
        projects={[...projects, archived]}
        selectedProjectId={null}
        loading={false}
        onRetry={vi.fn()}
        onSelectProject={onSelectProject}
        recent={recent}
        onOpenRecent={onOpenRecent}
        trash
        onOpenTrash={onOpenTrash}
        onRestoreProject={onRestoreProject}
      />
    );
    const recentList = screen.getByRole('list', {
      name: 'com.affine.localmind.project-browser.sidebar.recent',
    });
    expect(within(recentList).getAllByRole('button')).toHaveLength(6);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.project-browser.sidebar.showAll',
      })
    );
    expect(within(recentList).getAllByRole('button')).toHaveLength(8);
    fireEvent.click(within(recentList).getByRole('button', { name: 'Doc 3' }));
    expect(onOpenRecent).toHaveBeenCalledWith(recent[3]);
    const projectList = screen.getByRole('list', {
      name: 'com.affine.localmind.project-browser.sidebar.projects',
    });
    expect(
      within(projectList)
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual(['Alpha project', 'Beta project']);
    fireEvent.click(
      within(projectList).getByRole('button', { name: 'Beta project' })
    );
    expect(onSelectProject).toHaveBeenCalledWith('project-2');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'com.affine.localmind.project-files.restore',
      })
    );
    expect(onRestoreProject).toHaveBeenCalledWith(archived);
    expect(screen.getByRole('note').textContent).toBe(
      'com.affine.localmind.project-browser.sidebar.trashHint'
    );
    view.rerender(
      <ProjectBrowserSidebar
        projects={projects}
        selectedProjectId="project-1"
        loading={false}
        onRetry={vi.fn()}
        onSelectProject={onSelectProject}
        recent={[]}
        onOpenRecent={onOpenRecent}
        trash
        onOpenTrash={onOpenTrash}
      />
    );
    expect(screen.queryByRole('note')).toBeNull();
    expect(
      screen
        .getByRole('button', {
          name: 'com.affine.localmind.project-browser.sidebar.trash',
        })
        .getAttribute('aria-current')
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'Alpha project' })
        .getAttribute('aria-current')
    ).toBe('false');
  });
});

test('search snippets drop Markdown block markers', async () => {
  const { cleanSnippet } = await import('./search-results');
  expect(
    cleanSnippet(
      '<!-- block_id=QWnZ flavour=affine:paragraph -->  Hello  world'
    )
  ).toBe('Hello world');
  expect(cleanSnippet('<!-- block_id=x')).toBe('');
});
