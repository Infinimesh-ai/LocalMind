/** Executable resource contracts are scope-specific; historical names are read-only. */
const RETIRED_RESOURCE_TOOLS = new Set([
  'doc_create',
  'doc_copy',
  'doc_creation_status',
  'doc_read',
  'doc_update',
  'doc_update_meta',
  'doc_keyword_search',
  'doc_semantic_search',
  'doc_trash',
  'doc_restore',
  'doc_delete_permanently',
  'blob_read',
  'office_read',
  'office_command_request',
  'office_command_batch_request',
  'conditional_noop_complete',
  'project_doc_update_request',
  'project_doc_add',
]);

export const isRetiredResourceTool = (name: string) =>
  RETIRED_RESOURCE_TOOLS.has(name);

export class ToolContractRetiredError extends Error {
  constructor() {
    super('tool_contract_retired');
    this.name = 'ToolContractRetiredError';
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function assertCurrentProjectToolContract(command: unknown) {
  const value = object(command);
  if (
    value.version !== 2 ||
    typeof value.toolName !== 'string' ||
    !value.toolName.startsWith('project_') ||
    isRetiredResourceTool(value.toolName)
  )
    throw new ToolContractRetiredError();
}

export function hasRetiredToolContract(run: {
  workflow: string;
  steps: ReadonlyArray<{ input?: unknown; outputSummary: unknown }>;
}) {
  if (run.workflow === 'agent_runtime_localmind_tool_agent') {
    const requests = run.steps
      .map(step => object(object(step.outputSummary).localMindToolAgentRequest))
      .filter(request => Object.keys(request).length);
    return (
      requests.length !== 1 ||
      requests.some(
        request =>
          request.version !== 'localmind-tool-agent-request/v7' ||
          object(request.completionContract).version !==
            'localmind-tool-agent-completion-contract/v5' ||
          !Array.isArray(request.allowedToolNames) ||
          request.allowedToolNames.some(
            name =>
              typeof name !== 'string' ||
              isRetiredResourceTool(name) ||
              name.startsWith('project_')
          )
      )
    );
  }
  if (run.workflow === 'agent_runtime_project_resource') {
    return run.steps.some(step => {
      const command = object(step.input);
      return (
        Object.keys(command).length > 0 &&
        (command.version !== 2 ||
          typeof command.toolName !== 'string' ||
          !command.toolName.startsWith('project_') ||
          isRetiredResourceTool(command.toolName))
      );
    });
  }
  return false;
}
