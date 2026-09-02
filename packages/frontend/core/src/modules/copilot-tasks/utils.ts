import type {
  CopilotTaskControlInput,
  CopilotTasksGetQuery,
} from '@affine/graphql';

export type CopilotTask = NonNullable<
  CopilotTasksGetQuery['currentUser']
>['copilot']['copilotTasks'][number];

export type CopilotTaskFilter = 'active' | 'approval' | 'completed';
export type CopilotTaskAction = 'approve' | 'cancel' | 'reject' | 'resume';

const activeStatuses = new Set(['queued', 'running']);
const completedStatuses = new Set(['completed', 'failed', 'cancelled']);

export function filterCopilotTasks(
  tasks: CopilotTask[],
  filter: CopilotTaskFilter
) {
  if (filter === 'approval') {
    return tasks.filter(task => task.status === 'waiting_approval');
  }
  if (filter === 'completed') {
    return tasks.filter(task => completedStatuses.has(task.status));
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
