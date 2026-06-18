export const AI_ACTION_RUN_AGENT_RUNTIME_PROJECTION_SOURCE =
  'ai_action_run_agent_runtime_projection/v1';

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

export function getAgentRuntimeTargetStepTypes() {
  return [...AGENT_RUNTIME_TARGET_STEP_TYPES];
}

export function getActionRunAgentRuntimeUnsupportedStepTypes() {
  const projectedStepTypes = new Set<AgentRuntimeStepType>(
    AI_ACTION_RUN_AGENT_RUNTIME_PROJECTED_STEP_TYPES
  );

  return AGENT_RUNTIME_TARGET_STEP_TYPES.filter(
    stepType => !projectedStepTypes.has(stepType)
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
