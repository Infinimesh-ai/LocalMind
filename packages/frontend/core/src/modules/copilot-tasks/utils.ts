import type {
  CopilotTaskControlInput,
  CopilotTasksGetQuery,
} from '@affine/graphql';

export type CopilotTask = NonNullable<
  CopilotTasksGetQuery['currentUser']
>['copilot']['copilotTasks'][number];

export type CopilotTaskFilter = 'all' | 'active' | 'approval' | 'completed';
export type CopilotTaskAction =
  | 'abandon'
  | 'approve'
  | 'cancel'
  | 'reject'
  | 'resume';

const activeStatuses = new Set(['queued', 'running']);
const completedStatuses = new Set(['completed', 'cancelled']);

const isDoneTask = (task: Pick<CopilotTask, 'abandoned' | 'status'>) =>
  task.abandoned || completedStatuses.has(task.status);

export function getCopilotTaskFilter(
  task: Pick<CopilotTask, 'abandoned' | 'status'>
): CopilotTaskFilter {
  if (task.status === 'waiting_approval') {
    return 'approval';
  }
  if (isDoneTask(task)) {
    return 'completed';
  }
  return activeStatuses.has(task.status) ? 'active' : 'all';
}

export function filterCopilotTasks(
  tasks: CopilotTask[],
  filter: CopilotTaskFilter
) {
  if (filter === 'all') {
    return tasks;
  }
  if (filter === 'approval') {
    return tasks.filter(task => task.status === 'waiting_approval');
  }
  if (filter === 'completed') {
    return tasks.filter(isDoneTask);
  }
  return tasks.filter(task => activeStatuses.has(task.status));
}

export function buildCopilotTaskControlInput(
  workspaceId: string,
  taskId: string,
  action: CopilotTaskAction
): CopilotTaskControlInput {
  return { workspaceId, taskId, action };
}

export function isCopilotTaskActionDisabled(input: {
  action: CopilotTaskAction;
  availableActions: string[];
  pendingTaskId: string | null;
  taskId: string;
}) {
  return (
    input.pendingTaskId !== null ||
    !input.availableActions.includes(input.action) ||
    input.pendingTaskId === input.taskId
  );
}
