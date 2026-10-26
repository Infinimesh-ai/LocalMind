/** @vitest-environment happy-dom */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type * as ReactRouter from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { apiState } from './__tests__/api-mock';
import { openConfirmModal } from './__tests__/component-mock';
import { mockApi, renderAt, summary } from './__tests__/test-utils';

vi.mock('@affine/component', () => import('./__tests__/component-mock'));
vi.mock(
  '@affine/core/modules/report-decks/i18n',
  () => import('./__tests__/i18n-mock')
);
vi.mock(
  '@affine/core/modules/report-decks/api',
  () => import('./__tests__/api-mock')
);
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigate,
}));

import { HistoryList } from './history-list';

beforeEach(() => navigate.mockReset());
afterEach(() => {
  cleanup();
  apiState.api = null;
});

it('shows an empty state with a create action', async () => {
  apiState.api = mockApi();
  const onCreate = vi.fn();
  renderAt('/reports', '/reports', <HistoryList onCreate={onCreate} />);
  fireEvent.click(await screen.findByRole('button', { name: 'home.create' }));
  expect(screen.getByText('history.emptyTitle')).toBeTruthy();
  expect(onCreate).toHaveBeenCalled();
});

it('lists statuses, modes, source counts and pages with the cursor', async () => {
  const api = mockApi({
    list: vi.fn(async ({ cursor }) =>
      cursor
        ? {
            items: [summary({ id: 'deck-4', title: '旧汇报' })],
            nextCursor: null,
          }
        : {
            items: [
              summary({
                id: 'deck-1',
                status: 'generating',
                title: '',
                progress: { phase: 'extract', done: 1, total: 2 },
              }),
              summary({
                id: 'deck-2',
                mode: 'custom',
                templateKey: null,
                excludedCount: 1,
              }),
              summary({ id: 'deck-3', status: 'failed', errorCode: 'timeout' }),
            ],
            nextCursor: 'next',
          }
    ),
  });
  apiState.api = api;
  renderAt('/reports', '/reports', <HistoryList onCreate={vi.fn()} />);
  const rows = await screen.findAllByTestId('deck-row');
  expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain('untitledGenerating');
  expect(rows[0].textContent).toContain(
    'status.generatingPercent {"percent":35}'
  );
  expect(
    rows[0].querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')
  ).toBe('35');
  expect(rows[1].textContent).toContain('mode.custom');
  expect(rows[1].textContent).toContain(
    'history.sourcesExcluded {"count":3,"excluded":1}'
  );
  expect(rows[2].textContent).toContain('status.failed');
  expect(rows[2].textContent).toContain('mode.template');

  fireEvent.click(screen.getByRole('button', { name: 'history.loadMore' }));
  await waitFor(() =>
    expect(screen.getAllByTestId('deck-row')).toHaveLength(4)
  );
  expect(api.list).toHaveBeenCalledWith({ cursor: 'next', limit: 20 });

  fireEvent.click(rows[1].querySelector('button') as HTMLButtonElement);
  expect(navigate).toHaveBeenCalledWith('/reports/deck-2');
});

it('opens independent configuration for regeneration and deletes from the row actions', async () => {
  const api = mockApi({
    list: vi.fn(async () => ({ items: [summary()], nextCursor: null })),
    command: vi.fn(async input =>
      input.operation === 'regenerate'
        ? { deck: { id: 'deck-new' } as never }
        : { deleted: true }
    ),
  });
  apiState.api = api;
  renderAt('/reports', '/reports', <HistoryList onCreate={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'action.regenerate' })
  );
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith('/reports/new?from=deck-1')
  );
  expect(api.command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'action.delete' }));
  expect(openConfirmModal).toHaveBeenCalled();
  await waitFor(() =>
    expect(api.command).toHaveBeenCalledWith({
      operation: 'delete',
      deckId: 'deck-1',
    })
  );
});
