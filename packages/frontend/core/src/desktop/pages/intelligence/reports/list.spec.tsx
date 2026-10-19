/** @vitest-environment happy-dom */
import type {
  ProjectReportApi,
  ReportState,
} from '@affine/core/modules/project-reports/contracts';
import { BUILTIN_REPORT_TEMPLATES } from '@localmind/office/report';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import type * as TemplateGalleryModule from './template-gallery';

vi.mock('./access', () => ({
  ReportAccessDenied: () => <div data-testid="report-access-denied" />,
}));
vi.mock('@affine/component', () => ({
  Button: ({
    children,
    loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
  IconButton: () => null,
  Menu: ({ children }: PropsWithChildren) => children,
  MenuItem: () => null,
  Modal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
    open ? <div role="dialog">{children}</div> : null,
  Loading: () => <p role="status">loading</p>,
  useConfirmModal: () => ({ openConfirmModal: vi.fn() }),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
const flags = vi.hoisted(() => ({ legacyReports: false }));
vi.mock('@affine/core/components/report-deck-entry', () => ({
  useLegacyProjectReportsEnabled: () => flags.legacyReports,
}));
vi.mock('./template-gallery', async importOriginal => ({
  ...(await importOriginal<typeof TemplateGalleryModule>()),
  TemplateImport: () => <button type="button">template-import</button>,
}));
vi.mock('@affine/core/modules/project-reports/i18n', () => ({
  useReportText: () => (key: string) => key,
}));

import { ReportList } from './list';

function client(): ProjectReportApi {
  return {
    query: vi.fn(async () => ({ reports: { items: [], nextCursor: 'next' } })),
    command: vi.fn(async () => ({})),
    download: vi.fn(async () => {}),
  };
}
function creationOptions(): ReportState {
  return {
    templates: BUILTIN_REPORT_TEMPLATES.map((item, index) => ({
      id: `template-${index}`,
      name: `Template ${index}`,
      version: 1,
      builtinKey: null,
      status: 'active',
      current: { id: `revision-${index}`, content: item.content },
    })),
    resources: [
      { id: 'folder', title: 'Folder', kind: 'folder' },
      { id: 'document', title: 'Document', kind: 'doc' },
    ],
    members: [{ id: 'member', name: 'Member' }],
    capabilities: {
      canEdit: true,
      canSchedule: true,
      canShare: true,
      allowAnonymous: false,
      emailConfigured: false,
    },
  };
}
async function mount(api: ProjectReportApi) {
  vi.useFakeTimers();
  await act(async () => {
    render(<ReportList api={api} projectId="project" />);
  });
}
afterEach(() => {
  cleanup();
  flags.legacyReports = false;
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('coalesces typing into one search without reloading creation options', async () => {
  const api = client();
  await mount(api);
  expect(api.query).toHaveBeenCalledTimes(2);
  const input = screen.getByLabelText('search');
  for (const value of ['r', 're', 'report']) {
    fireEvent.change(input, { target: { value } });
    await act(async () => vi.advanceTimersByTime(50));
  }
  expect(api.query).toHaveBeenCalledTimes(2);
  expect((input as HTMLInputElement).value).toBe('report');
  await act(async () => vi.advanceTimersByTime(150));
  expect(api.query).toHaveBeenCalledTimes(3);
  expect(api.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'list_results', search: 'report' }),
    expect.any(AbortSignal)
  );
  expect(
    vi
      .mocked(api.query)
      .mock.calls.filter(([query]) => query.view === 'list_options')
  ).toHaveLength(1);
});

it('waits for IME composition and resets pagination with the final search', async () => {
  const api = client();
  await mount(api);
  await act(async () => fireEvent.click(screen.getByText('nextPage')));
  expect(api.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'next' }),
    expect.any(AbortSignal)
  );
  const input = screen.getByLabelText('search');
  const calls = vi.mocked(api.query).mock.calls.length;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'hui' } });
  await act(async () => vi.advanceTimersByTime(500));
  expect(api.query).toHaveBeenCalledTimes(calls);
  fireEvent.change(input, { target: { value: '汇报' } });
  fireEvent.compositionEnd(input);
  await act(async () => vi.advanceTimersByTime(200));
  expect(api.query).toHaveBeenCalledTimes(calls + 1);
  expect(api.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ search: '汇报', cursor: undefined }),
    expect.any(AbortSignal)
  );
});

it('shows search results while creation options are still loading', async () => {
  const api = client();
  api.query = vi.fn(query =>
    query.view === 'list_options'
      ? new Promise<ReportState>(() => {})
      : Promise.resolve({ reports: { items: [], nextCursor: null } })
  );
  await mount(api);
  expect(screen.getByText('emptyTitle')).toBeTruthy();
  expect(screen.queryByText('loading')).toBeNull();
  expect(screen.getByText('createReport').hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('search'), {
    target: { value: 'report' },
  });
  await act(async () => vi.advanceTimersByTime(200));
  expect(api.query).toHaveBeenLastCalledWith(
    expect.objectContaining({ view: 'list_results', search: 'report' }),
    expect.any(AbortSignal)
  );
  expect(screen.queryByText('loading')).toBeNull();
});

it('does not hide successful search results when creation options time out', async () => {
  const api = client();
  api.query = vi.fn(async query => {
    if (query.view === 'list_options') throw new Error('timeout');
    return { reports: { items: [], nextCursor: 'next' } };
  });
  await mount(api);
  expect(screen.getByText('nextPage').hasAttribute('disabled')).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('home.optionsFailed');
  expect(screen.getByText('home.documents').closest('li')?.textContent).toBe(
    'home.documents—'
  );
  await act(async () => vi.advanceTimersByTime(30000));
  expect(
    vi
      .mocked(api.query)
      .mock.calls.filter(([query]) => query.view === 'list_options')
  ).toHaveLength(1);
});

it('retries failed templates and sources without reloading the report list', async () => {
  const api = client();
  let failOptions = true;
  api.query = vi.fn(async query => {
    if (query.view === 'list_options') {
      if (failOptions) throw new Error('timeout');
      return creationOptions();
    }
    return { reports: { items: [], nextCursor: null } };
  });
  await mount(api);
  expect(screen.getByText('createReport').hasAttribute('disabled')).toBe(true);
  failOptions = false;
  await act(async () => fireEvent.click(screen.getByText('retry')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('createReport').hasAttribute('disabled')).toBe(false);
  expect(screen.getByText('home.documents').closest('li')?.textContent).toBe(
    'home.documents1'
  );
  expect(
    vi.mocked(api.query).mock.calls.filter(([q]) => q.view === 'list_results')
  ).toHaveLength(1);
});

it('shows every active template in the gallery and preselects the chosen one', async () => {
  const api = client();
  api.query = vi.fn(async query =>
    query.view === 'list_options'
      ? creationOptions()
      : { reports: { items: [], nextCursor: null } }
  );
  await mount(api);
  expect(screen.getAllByRole('button', { name: /^Template / })).toHaveLength(
    BUILTIN_REPORT_TEMPLATES.length
  );
  expect(screen.queryByText('nextPage')).toBeNull();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: /^Template 1 / }))
  );
  const selector = screen.getByLabelText('template') as HTMLSelectElement;
  expect(selector.value).toBe('revision-1');
  expect(selector.options).toHaveLength(BUILTIN_REPORT_TEMPLATES.length);
  fireEvent.change(selector, { target: { value: 'revision-4' } });
  await act(async () => fireEvent.click(screen.getByText('createBlank')));
  expect(api.command).toHaveBeenCalledWith(
    expect.objectContaining({
      command: expect.objectContaining({
        operation: 'create',
        templateRevisionId: 'revision-4',
        generate: false,
      }),
    })
  );
  expect(
    vi
      .mocked(api.query)
      .mock.calls.every(
        ([q]) => q.view === 'list_options' || q.view === 'list_results'
      )
  ).toBe(true);
});

it('previews templates with their real cover, or an imported thumbnail', async () => {
  const api = client();
  const options = creationOptions();
  const imported = options.templates![1];
  imported.current.content = {
    ...imported.current.content,
    previewAssetId: 'thumb',
    assets: [
      { id: 'thumb', blobKey: 'thumb-key', mimeType: 'image/png', alt: 'x' },
    ],
  };
  api.query = vi.fn(async query =>
    query.view === 'list_options'
      ? options
      : { reports: { items: [], nextCursor: null } }
  );
  await mount(api);
  const [rendered, thumbnail] = screen.getAllByRole('button', {
    name: /^Template /,
  });
  // A rendered cover slide in the template's own theme, plus chapter slides.
  const cover = rendered.querySelector('article');
  expect(cover?.textContent).toContain(
    BUILTIN_REPORT_TEMPLATES[0].content.name
  );
  expect(cover?.getAttribute('style')).toContain(
    BUILTIN_REPORT_TEMPLATES[0].content.theme.background
  );
  expect(rendered.querySelectorAll('article').length).toBeGreaterThan(1);
  expect(thumbnail.querySelector('img')?.getAttribute('src')).toBe(
    '/api/projects/project/blobs/thumb-key'
  );
});

it('does not show an empty list message when fetching reports fails', async () => {
  const api = client();
  api.query = vi.fn(async query => {
    if (query.view === 'list_options') return creationOptions();
    throw new Error('timeout');
  });
  await mount(api);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('emptyTitle')).toBeNull();
  expect(screen.queryByText('home.noMatches')).toBeNull();
});

it('disables creation without active templates and links to template management', async () => {
  const api = client();
  const options = creationOptions();
  options.templates = options.templates?.map(item => ({
    ...item,
    status: 'archived',
  }));
  api.query = vi.fn(async query =>
    query.view === 'list_options'
      ? options
      : { reports: { items: [], nextCursor: null } }
  );
  await mount(api);
  expect(screen.getByText('home.noTemplates')).toBeTruthy();
  expect(screen.getByText('createReport').hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('button', { name: /^Template / })).toBeNull();
  fireEvent.click(screen.getByText('home.manageTemplates'));
  expect(navigate).toHaveBeenCalledWith('/project/project/report-templates');
});

it('clears successful results when creation options report lost project access', async () => {
  const api = client();
  api.query = vi.fn(async query => {
    if (query.view === 'list_options')
      throw {
        status: 403,
        type: 'Forbidden',
        name: 'ACCESS_DENIED',
        message: 'Access denied',
      };
    return { reports: { items: [], nextCursor: 'next' } };
  });
  await mount(api);
  expect(screen.getByTestId('report-access-denied')).toBeTruthy();
  expect(screen.queryByText('nextPage')).toBeNull();
});

it('offers PPTX template import only while the legacy report studio is enabled', async () => {
  const uploadImage = vi.fn(async () => 'asset');
  vi.useFakeTimers();
  await act(async () => {
    render(
      <ReportList
        api={client()}
        projectId="project"
        uploadImage={uploadImage}
      />
    );
  });
  expect(screen.queryByText('template-import')).toBeNull();
  cleanup();
  flags.legacyReports = true;
  await act(async () => {
    render(
      <ReportList
        api={client()}
        projectId="project"
        uploadImage={uploadImage}
      />
    );
  });
  expect(screen.getByText('template-import')).toBeTruthy();
});
