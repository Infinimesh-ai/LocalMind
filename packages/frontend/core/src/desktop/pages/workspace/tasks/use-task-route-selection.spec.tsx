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
import { type PropsWithChildren, useState } from 'react';
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from 'react-router-dom';
import { afterEach, describe, expect, test } from 'vitest';

import type { CopilotTask } from '../../../../modules/copilot-tasks/utils';
import { useTaskRouteSelection } from './use-task-route-selection';

const task = (id: string, status: string) => ({ id, status }) as CopilotTask;

afterEach(cleanup);

const Harness = ({
  children,
  ready = true,
}: PropsWithChildren<{ ready?: boolean }>) => {
  const tasks = [
    task('queued-task', 'queued'),
    task('approval-task', 'waiting_approval'),
    task('failed-task', 'failed'),
  ];
  const location = useLocation();
  const { filter, selectedTask, selectFilter, selectTask } =
    useTaskRouteSelection(tasks, ready);

  return (
    <>
      <output data-testid="filter">{filter}</output>
      <output data-testid="selected">{selectedTask?.id ?? 'none'}</output>
      <output data-testid="search">{location.search}</output>
      <button type="button" onClick={() => selectTask('failed-task')}>
        Select failed
      </button>
      <button type="button" onClick={() => selectFilter('approval')}>
        Show approvals
      </button>
      <button type="button" onClick={() => selectFilter('all')}>
        Show all
      </button>
      {children}
    </>
  );
};

const DeferredHarness = () => {
  const [ready, setReady] = useState(false);
  return (
    <Harness ready={ready}>
      <button type="button" onClick={() => setReady(true)}>
        Finish loading
      </button>
    </Harness>
  );
};

describe('useTaskRouteSelection', () => {
  test('opens a deep-linked task in the filter that contains it', async () => {
    const router = createMemoryRouter(
      [{ path: '/tasks', element: <Harness /> }],
      { initialEntries: ['/tasks?source=workbench&taskId=failed-task'] }
    );
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId('filter').textContent).toBe('all');
      expect(screen.getByTestId('selected').textContent).toBe('failed-task');
    });
    expect(screen.getByTestId('search').textContent).toContain(
      'source=workbench'
    );
  });

  test('keeps URL, filter, and selection synchronized', async () => {
    const router = createMemoryRouter(
      [{ path: '/tasks', element: <Harness /> }],
      { initialEntries: ['/tasks?source=workbench&taskId=queued-task'] }
    );
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select failed' }));
    await waitFor(() => {
      expect(screen.getByTestId('filter').textContent).toBe('all');
      expect(screen.getByTestId('selected').textContent).toBe('failed-task');
      expect(screen.getByTestId('search').textContent).toContain(
        'taskId=failed-task'
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show approvals' }));
    await waitFor(() => {
      expect(screen.getByTestId('filter').textContent).toBe('approval');
      expect(screen.getByTestId('selected').textContent).toBe('approval-task');
      expect(screen.getByTestId('search').textContent).toContain(
        'taskId=approval-task'
      );
    });
    expect(screen.getByTestId('search').textContent).toContain(
      'source=workbench'
    );

    await router.navigate('/tasks?taskId=failed-task');
    await waitFor(() => {
      expect(screen.getByTestId('filter').textContent).toBe('all');
      expect(screen.getByTestId('selected').textContent).toBe('failed-task');
    });
  });

  test('keeps a cross-workspace history deep link in the all filter', async () => {
    const router = createMemoryRouter(
      [{ path: '/tasks', element: <Harness /> }],
      { initialEntries: ['/tasks?filter=all&taskId=failed-task'] }
    );
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId('filter').textContent).toBe('all');
      expect(screen.getByTestId('selected').textContent).toBe('failed-task');
    });
    expect(screen.getByTestId('search').textContent).toContain('filter=all');
  });

  test('replaces an unknown task link when task data is ready', async () => {
    const router = createMemoryRouter(
      [{ path: '/tasks', element: <DeferredHarness /> }],
      { initialEntries: ['/tasks?taskId=missing'] }
    );
    render(<RouterProvider router={router} />);

    expect(screen.getByTestId('selected').textContent).toBe('none');
    expect(screen.getByTestId('search').textContent).toContain(
      'taskId=missing'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Finish loading' }));

    await waitFor(() => {
      expect(screen.getByTestId('selected').textContent).toBe('queued-task');
      expect(screen.getByTestId('search').textContent).toContain(
        'taskId=queued-task'
      );
    });
  });
});
