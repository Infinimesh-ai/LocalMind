/** @vitest-environment happy-dom */
import type {
  ProjectReportApi,
  ReportState,
} from '@affine/core/modules/project-reports/contracts';
import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
  ReportNodeSchema,
} from '@localmind/office/report';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const stable = vi.hoisted(() => ({
  t: (key: string) => key,
  proof: { tabId: 'tab', leaseId: 'lease', kind: 'user' as const },
}));
vi.mock('@affine/component', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Loading: () => <p>loading</p>,
  Menu: ({ children }: { children: ReactNode }) => children,
  MenuItem: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('./studio-chat', () => ({ ReportChatPane: () => null }));
vi.mock('@affine/core/modules/project-reports/i18n', () => ({
  useReportText: () => stable.t,
}));
vi.mock('@affine/core/modules/project-resources/edit-guard', () => ({
  useProjectEditGuard: () => {},
}));
vi.mock('@affine/core/modules/project-reports/hooks', () => ({
  useReportState: () => ({ state, loading: false, refresh: async () => state }),
  useReportLease: () => ({ proof: stable.proof, refresh: vi.fn() }),
  useReportCollection: () => ({ items: [], hasMore: false, pending: false }),
}));
vi.mock('./output-panel', () => ({ ReportOutputPanel: () => null }));

import { ReportEditor } from './editor';

let state: ReportState;
beforeEach(() => {
  vi.useFakeTimers();
  const document = createReportDocument({
    title: 'Report',
    creator: { actorId: 'creator', label: 'Creator' },
    period: {
      start: '2026-10-01T00:00:00Z',
      end: '2026-10-08T00:00:00Z',
      timeZone: 'UTC',
      weekStartsOn: 1,
    },
    template: BUILTIN_REPORT_TEMPLATES[0].content,
    now: '2026-10-08T00:00:00Z',
  });
  document.chapters[0].nodes = [
    ReportNodeSchema.parse({ id: 'node', type: 'paragraph', text: 'original' }),
  ];
  state = {
    document,
    report: {
      id: 'report',
      projectId: 'project',
      version: 1,
      lifecycle: 'active',
      title: document.title,
      createdByActorId: 'creator',
      creatorLabel: 'Creator',
      responsibility: document.responsibility,
      periodStart: document.period.start,
      periodEnd: document.period.end,
      timeZone: 'UTC',
      draftRevisionId: 'draft',
      latestFinalRevisionId: null,
      updatedAt: '2026-10-08T00:00:00Z',
      templateRevisionId: 'template',
      selection: { kind: 'all' },
    },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function mount() {
  const api: ProjectReportApi = {
    query: vi.fn(async () => state),
    command: vi.fn(async input => ({
      report: { ...state.report!, version: 2 },
      document:
        input.command.operation === 'save'
          ? input.command.document
          : state.document,
    })),
    download: vi.fn(async () => {}),
  };
  render(
    <MemoryRouter>
      <ReportEditor
        api={api}
        projectId="project"
        reportId="report"
        uploadImage={vi.fn(async () => '')}
      />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: /studio\.mode\.edit/ }));
  fireEvent.click(screen.getByRole('button', { name: 'paragraph' }));
  return api;
}
it('waits for IME composition to finish before saving complete Chinese text', async () => {
  const api = mount();
  const input = screen.getByLabelText('content');
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '中文输入完成' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(api.command).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(api.command).toHaveBeenCalledOnce();
  expect(api.command).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedVersion: 1,
      editLease: stable.proof,
      command: expect.objectContaining({
        document: expect.objectContaining({
          chapters: expect.arrayContaining([
            expect.objectContaining({
              nodes: expect.arrayContaining([
                expect.objectContaining({ text: '中文输入完成' }),
              ]),
            }),
          ]),
        }),
      }),
    })
  );
});
it('retains unsaved text after a network failure and allows a successful explicit retry', async () => {
  const api = mount();
  vi.mocked(api.command).mockRejectedValueOnce(
    new Error('Network unavailable')
  );
  fireEvent.change(screen.getByLabelText('content'), {
    target: { value: 'Retained offline edit' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(screen.getByRole('alert')).toBeTruthy();
  expect((screen.getByLabelText('content') as HTMLTextAreaElement).value).toBe(
    'Retained offline edit'
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^save$/ }));
  });
  expect(api.command).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('content') as HTMLTextAreaElement).value).toBe(
    'Retained offline edit'
  );
});
