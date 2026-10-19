/**
 * @vitest-environment happy-dom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  useI18n: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => () => String(key),
      }
    ),
}));

vi.mock('@blocksuite/icons/rc', () => ({
  ArrowRightSmallIcon: () => <svg />,
  CloseIcon: () => <svg data-testid="failed-icon" />,
  DoneIcon: () => <svg data-testid="done-icon" />,
}));

import { ExecutionPath, findSessionRun } from './execution-path';
import type { WorkbenchRun, WorkbenchTask } from './types';

afterEach(cleanup);

const label = (key: string) =>
  `com.affine.localmind.workbench.executionPath.${key}`;

const step = (
  id: string,
  order: number,
  status: string,
  extra: Partial<WorkbenchRun['steps'][number]> = {}
): WorkbenchRun['steps'][number] => ({
  id,
  key: `key-${id}`,
  type: 'tool',
  status,
  title: `Step ${id}`,
  order,
  startedAt: null,
  completedAt: null,
  ...extra,
});

const run = (overrides: Partial<WorkbenchRun> = {}): WorkbenchRun =>
  ({
    id: 'run-1',
    sessionId: 'session-1',
    status: 'running',
    updatedAt: '2026-10-13T08:00:00.000Z',
    approval: null,
    steps: [],
    ...overrides,
  }) as WorkbenchRun;

const task = (taskRun: WorkbenchRun | null) =>
  ({ id: `task-${taskRun?.id ?? 'none'}`, run: taskRun }) as WorkbenchTask;

describe('ExecutionPath', () => {
  test('renders every step status with the mapped label in order', () => {
    render(
      <ExecutionPath
        run={run({
          approval: {
            stepId: 'approve',
            status: 'pending',
            title: 'Publish to workspace',
            decidedAt: null,
          },
          steps: [
            step('skip', 6, 'skipped'),
            step('done', 1, 'completed', {
              startedAt: '2026-10-13T08:00:00.000Z',
              completedAt: '2026-10-13T08:00:12.000Z',
            }),
            step('run', 2, 'running'),
            step('approve', 3, 'waiting_approval'),
            step('fail', 4, 'failed'),
            step('queue', 5, 'pending'),
          ],
        })}
      />
    );

    expect(screen.getByText(label('title'))).not.toBeNull();
    expect(screen.getByText('1/6')).not.toBeNull();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map(row => row.dataset.status)).toEqual([
      'completed',
      'running',
      'waiting_approval',
      'failed',
      'pending',
      'skipped',
    ]);
    expect(rows[0].textContent).toContain(label('completed'));
    expect(rows[0].textContent).toContain('12s');
    expect(rows[1].textContent).toContain(label('running'));
    expect(rows[2].textContent).toContain(
      `${label('waitingApproval')} · Publish to workspace`
    );
    expect(rows[3].textContent).toContain(label('failed'));
    expect(rows[4].textContent).toContain(label('pending'));
    expect(rows[4].textContent).toContain('5');
    expect(rows[5].textContent).toContain(label('skipped'));
    expect(screen.getByTestId('done-icon')).not.toBeNull();
    expect(screen.getByTestId('failed-icon')).not.toBeNull();
  });

  test('collapses and expands the step list', () => {
    render(<ExecutionPath run={run({ steps: [step('a', 1, 'pending')] })} />);
    const toggle = screen.getByRole('button', { name: /executionPath\.title/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  test('renders nothing without a run or without steps', () => {
    const { container, rerender } = render(<ExecutionPath run={null} />);
    expect(container.innerHTML).toBe('');
    rerender(<ExecutionPath run={run()} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('findSessionRun', () => {
  test('only returns runs bound to the current session, preferring active runs', () => {
    const other = run({
      id: 'other',
      sessionId: 'session-2',
      steps: [step('a', 1, 'running')],
    });
    const finished = run({
      id: 'finished',
      status: 'completed',
      updatedAt: '2026-10-13T09:00:00.000Z',
      steps: [step('b', 1, 'completed')],
    });
    const active = run({
      id: 'active',
      status: 'waiting_approval',
      updatedAt: '2026-10-13T07:00:00.000Z',
      steps: [step('c', 1, 'waiting_approval')],
    });
    const tasks = [task(other), task(finished), task(active), task(null)];

    expect(findSessionRun(tasks, 'session-1')?.id).toBe('active');
    expect(findSessionRun([task(other), task(finished)], 'session-1')?.id).toBe(
      'finished'
    );
    expect(findSessionRun(tasks, 'session-3')).toBeNull();
    expect(findSessionRun(tasks, null)).toBeNull();
  });
});
