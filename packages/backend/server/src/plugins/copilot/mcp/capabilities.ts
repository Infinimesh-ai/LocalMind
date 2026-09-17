import { McpAccessMode } from '@prisma/client';

export const MCP_DELEGATION_CAPABILITIES = [
  'delegate_to_localmind',
  'get_localmind_task',
  'control_localmind_task',
] as const;

export const MCP_RESOURCE_READ_CAPABILITIES = [
  'workspace_doc_list',
  'workspace_doc_keyword_search',
  'workspace_doc_read',
  'workspace_folder_list',
  'workspace_operation_get',
] as const;
export const MCP_RESOURCE_WRITE_CAPABILITIES = [
  'workspace_doc_create',
  'workspace_doc_update',
  'workspace_doc_update_meta',
  'workspace_folder_create',
  'workspace_folder_move_document',
] as const;
export const MCP_CAPABILITIES = [
  ...MCP_DELEGATION_CAPABILITIES,
  ...MCP_RESOURCE_READ_CAPABILITIES,
  ...MCP_RESOURCE_WRITE_CAPABILITIES,
] as const;
export const MCP_RESOURCE_CAPABILITIES = [
  ...MCP_RESOURCE_READ_CAPABILITIES,
  ...MCP_RESOURCE_WRITE_CAPABILITIES,
] as const;

export const MCP_DELEGATE_CAPABILITY = 'delegate_to_localmind' as const;
export const MCP_TASK_QUERY_CAPABILITY = 'get_localmind_task' as const;
export const MCP_TASK_CONTROL_CAPABILITY = 'control_localmind_task' as const;

export type McpCapability = (typeof MCP_CAPABILITIES)[number];

const MCP_CAPABILITY_SET = new Set<string>(MCP_CAPABILITIES);

export function normalizeMcpCapabilities(
  capabilities: readonly string[] | null | undefined,
  accessMode: McpAccessMode
): McpCapability[] {
  const requested = capabilities?.length
    ? capabilities
    : accessMode === McpAccessMode.READ_WRITE
      ? MCP_DELEGATION_CAPABILITIES
      : [MCP_TASK_QUERY_CAPABILITY];
  const normalized = [...new Set(requested.map(value => value.trim()))];
  const invalid = normalized.filter(value => !MCP_CAPABILITY_SET.has(value));
  if (invalid.length) {
    throw new Error(`Unsupported MCP capabilities: ${invalid.join(', ')}`);
  }
  return normalized as McpCapability[];
}

export function mcpAccessModeForCapabilities(
  capabilities: readonly McpCapability[]
) {
  return capabilities.some(
    capability =>
      capability === MCP_DELEGATE_CAPABILITY ||
      capability === MCP_TASK_CONTROL_CAPABILITY ||
      (MCP_RESOURCE_WRITE_CAPABILITIES as readonly string[]).includes(
        capability
      )
  )
    ? McpAccessMode.READ_WRITE
    : McpAccessMode.READ_ONLY;
}
