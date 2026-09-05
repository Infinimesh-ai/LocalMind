import { describe, expect, test } from 'vitest';

import {
  buildCopilotTaskControlInput,
  type CopilotTask,
  filterCopilotTasks,
  getCopilotTaskFilter,
  isCopilotTaskActionDisabled,
} from './utils';

const task = (id: string, status: string, abandoned = false) =>
  ({ id, status, abandoned }) as CopilotTask;

describe('Copilot Tasks utilities', () => {
  test('groups task statuses into product filters', () => {
    const tasks = [
      task('queued', 'queued'),
      task('running', 'running'),
      task('approval', 'waiting_approval'),
      task('completed', 'completed'),
      task('failed', 'failed'),
      task('abandoned', 'cancelled', true),
      task('cancelled', 'cancelled'),
    ];

    expect(filterCopilotTasks(tasks, 'all')).toEqual(tasks);
    expect(filterCopilotTasks(tasks, 'active').map(item => item.id)).toEqual([
      'queued',
      'running',
    ]);
    expect(filterCopilotTasks(tasks, 'approval').map(item => item.id)).toEqual([
      'approval',
    ]);
    expect(filterCopilotTasks(tasks, 'completed').map(item => item.id)).toEqual(
      ['completed', 'abandoned', 'cancelled']
    );
  });

  test('resolves the full-list filter for a linked task status', () => {
    expect(getCopilotTaskFilter(task('running', 'running'))).toBe('active');
    expect(getCopilotTaskFilter(task('approval', 'waiting_approval'))).toBe(
      'approval'
    );
    expect(getCopilotTaskFilter(task('failed', 'failed'))).toBe('all');
    expect(getCopilotTaskFilter(task('abandoned', 'cancelled', true))).toBe(
      'completed'
    );
    expect(getCopilotTaskFilter(task('done', 'completed'))).toBe('completed');
  });

  test('serializes the actor-scoped task control mutation input', () => {
    expect(
      buildCopilotTaskControlInput('workspace-1', 'task-1', 'approve')
    ).toEqual({
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      action: 'approve',
    });
    expect(
      buildCopilotTaskControlInput('workspace-2', 'failed-task', 'abandon')
    ).toEqual({
      workspaceId: 'workspace-2',
      taskId: 'failed-task',
      action: 'abandon',
    });
  });

  test('disables repeated and unavailable controls', () => {
    expect(
      isCopilotTaskActionDisabled({
        action: 'approve',
        availableActions: ['approve'],
        pendingTaskId: 'task-1',
        taskId: 'task-1',
      })
    ).toBe(true);
    expect(
      isCopilotTaskActionDisabled({
        action: 'resume',
        availableActions: ['approve'],
        pendingTaskId: null,
        taskId: 'task-1',
      })
    ).toBe(true);
    expect(
      isCopilotTaskActionDisabled({
        action: 'approve',
        availableActions: ['approve'],
        pendingTaskId: null,
        taskId: 'task-1',
      })
    ).toBe(false);
    expect(
      isCopilotTaskActionDisabled({
        action: 'abandon',
        availableActions: ['resume', 'abandon'],
        pendingTaskId: null,
        taskId: 'failed-task',
      })
    ).toBe(false);
  });
});
