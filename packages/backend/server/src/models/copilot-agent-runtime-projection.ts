export const AI_ACTION_RUN_AGENT_RUNTIME_PROJECTION_SOURCE =
  'ai_action_run_agent_runtime_projection/v1';

export const AGENT_RUNTIME_TARGET_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
  'retrying',
  'rollback_running',
  'archived',
] as const;

export type AgentRuntimeRunStatus =
  (typeof AGENT_RUNTIME_TARGET_RUN_STATUSES)[number];

export const AI_ACTION_RUN_AGENT_RUNTIME_PROJECTED_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly AgentRuntimeRunStatus[];

export const AGENT_RUNTIME_TARGET_STEP_TYPES = [
  'model',
  'tool',
  'approval',
  'handoff',
  'codex',
  'mcp',
] as const;

export type AgentRuntimeStepType =
  (typeof AGENT_RUNTIME_TARGET_STEP_TYPES)[number];

export const AI_ACTION_RUN_AGENT_RUNTIME_PROJECTED_STEP_TYPES = [
  'model',
] as const satisfies readonly AgentRuntimeStepType[];

export function mapActionRunStatusToAgentRuntimeStatus(status: string) {
  switch (status) {
    case 'created':
      return 'queued';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'aborted':
      return 'cancelled';
    default:
      return 'failed';
  }
}

export function mapActionRunStatusToAgentRuntimeStepStatus(status: string) {
  switch (status) {
    case 'created':
      return 'pending';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'aborted':
      return 'skipped';
    default:
      return 'failed';
  }
}

export function getActionRunAgentRuntimeProjectedStepTypes() {
  return [...AI_ACTION_RUN_AGENT_RUNTIME_PROJECTED_STEP_TYPES];
}

export function getActionRunAgentRuntimeProjectedRunStatuses() {
  return [...AI_ACTION_RUN_AGENT_RUNTIME_PROJECTED_RUN_STATUSES];
}

export function getAgentRuntimeTargetStepTypes() {
  return [...AGENT_RUNTIME_TARGET_STEP_TYPES];
}

export function getAgentRuntimeTargetRunStatuses() {
  return [...AGENT_RUNTIME_TARGET_RUN_STATUSES];
}

export function getActionRunAgentRuntimeUnsupportedRunStatuses() {
  const projectedRunStatuses = new Set<AgentRuntimeRunStatus>(
    AI_ACTION_RUN_AGENT_RUNTIME_PROJECTED_RUN_STATUSES
  );

  return AGENT_RUNTIME_TARGET_RUN_STATUSES.filter(
    status => !projectedRunStatuses.has(status)
  );
}

export function getActionRunAgentRuntimeUnsupportedStepTypes() {
  const projectedStepTypes = new Set<AgentRuntimeStepType>(
    AI_ACTION_RUN_AGENT_RUNTIME_PROJECTED_STEP_TYPES
  );

  return AGENT_RUNTIME_TARGET_STEP_TYPES.filter(
    stepType => !projectedStepTypes.has(stepType)
  );
}

export function getActionRunAgentRuntimeRunStatusGaps() {
  return getActionRunAgentRuntimeUnsupportedRunStatuses().map(
    status => `${status} -> not_projected`
  );
}

export function getActionRunAgentRuntimeProjectionGaps(input: {
  hasPreparedRouteTrace: boolean;
}) {
  return [
    ...(input.hasPreparedRouteTrace
      ? []
      : ['model -> no_prepared_route_trace']),
    ...getActionRunAgentRuntimeUnsupportedStepTypes().map(
      stepType => `${stepType} -> not_projected`
    ),
  ];
}
