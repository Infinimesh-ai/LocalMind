import { describe, expect, test } from 'vitest';

import {
  buildCopilotTaskControlInput,
  type CopilotTask,
  filterCopilotTasks,
  isCopilotTaskActionDisabled,
} from './utils';

const task = (id: string, status: string) => ({ id, status }) as CopilotTask;

describe('Copilot Tasks utilities', () => {
  test('groups task statuses into product filters', () => {
    const tasks = [
      task('queued', 'queued'),
      task('running', 'running'),
      task('approval', 'waiting_approval'),
      task('completed', 'completed'),
      task('failed', 'failed'),
      task('cancelled', 'cancelled'),
    ];

    expect(filterCopilotTasks(tasks, 'active').map(item => item.id)).toEqual([
      'queued',
      'running',
    ]);
    expect(filterCopilotTasks(tasks, 'approval').map(item => item.id)).toEqual([
      'approval',
    ]);
    expect(filterCopilotTasks(tasks, 'completed').map(item => item.id)).toEqual(
      ['completed', 'failed', 'cancelled']
    );
  });

  test('serializes the actor-scoped task control mutation input', () => {
    expect(
      buildCopilotTaskControlInput('workspace-1', 'task-1', 'approve')
    ).toEqual({
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      action: 'approve',
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
  });
});
