/** @vitest-environment happy-dom */
import {
  BUILTIN_REPORT_TEMPLATES,
  createReportDocument,
  projectReportAudience,
  ReportNodeSchema,
} from '@localmind/office/report';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@affine/component', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Loading: () => <p>loading</p>,
}));
vi.mock('@affine/core/modules/project-reports/i18n', () => ({
  useReportText: () => (key: string) => key,
}));
vi.mock('@affine/core/modules/project-reports/hooks', () => ({
  useReportState: () => ({ state: { projection }, loading: false }),
}));
vi.mock('./render', () => ({
  ReportSlide: ({ page }: { page: { title: string } }) => <h2>{page.title}</h2>,
}));

import { ReportPresentation } from './presentation';

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
document.chapters = ['first', 'second'].map(id => ({
  id,
  title: id,
  hidden: false,
  locked: false,
  notes: 'PRIVATE NOTES',
  layout: 'content',
  nodes: [
    ReportNodeSchema.parse({ id: `${id}-node`, type: 'paragraph', text: id }),
  ],
}));
const projection = projectReportAudience(document, {
  kind: 'external',
  chapterIds: ['first', 'second'],
  includeNotes: false,
  includeSources: false,
});
const opener = { postMessage: vi.fn() };
const expected = { reportId: 'report', revisionId: 'revision', nonce: 'nonce' };
function mount() {
  Object.defineProperty(window, 'opener', {
    value: opener,
    configurable: true,
  });
  return render(
    <MemoryRouter initialEntries={['/present?revision=revision&nonce=nonce']}>
      <ReportPresentation
        api={{ query: vi.fn(), command: vi.fn(), download: vi.fn() }}
        projectId="project"
        reportId="report"
        presenter={false}
      />
    </MemoryRouter>
  );
}
function message(
  data: unknown,
  origin = window.location.origin,
  source = opener
) {
  fireEvent(
    window,
    new MessageEvent('message', {
      origin,
      source: source as unknown as Window,
      data,
    })
  );
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'opener', { value: null, configurable: true });
  vi.clearAllMocks();
});
it('synchronizes page, laser and black screen from the bound presenter without exposing notes', () => {
  const { container } = mount();
  message({
    kind: 'report-present',
    ...expected,
    page: 1,
    black: false,
    laser: true,
    pointer: { x: 25, y: 60 },
  });
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('second');
  const pointer = container.querySelector<HTMLElement>(
    'span[aria-hidden="true"]'
  );
  expect(pointer?.style.left).toBe('25%');
  expect(pointer?.style.top).toBe('60%');
  expect(container.textContent).not.toContain('PRIVATE NOTES');
  message({
    kind: 'report-present',
    ...expected,
    page: 1,
    black: true,
    laser: true,
    pointer: { x: 25, y: 60 },
  });
  expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
  expect(screen.getByLabelText('blackScreen')).toBeTruthy();
});
it('ignores forged origins, windows, snapshots and invalid pointer payloads', () => {
  const { container } = mount();
  const valid = {
    kind: 'report-present',
    ...expected,
    page: 1,
    black: false,
    laser: true,
    pointer: { x: 25, y: 60 },
  };
  message(valid, 'https://untrusted.example');
  message(valid, window.location.origin, { postMessage: vi.fn() });
  message({ ...valid, nonce: 'another-session' });
  message({ ...valid, revisionId: 'another-revision' });
  message({ ...valid, pointer: null });
  message({ ...valid, pointer: { x: Infinity, y: 60 } });
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('first');
  expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
});
