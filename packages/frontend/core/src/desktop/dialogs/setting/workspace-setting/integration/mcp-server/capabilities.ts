export const MCP_DELEGATION_OPTIONS = [
  { key: 'delegate', capability: 'delegate_to_localmind' },
  { key: 'query', capability: 'get_localmind_task' },
  { key: 'control', capability: 'control_localmind_task' },
] as const;

export const MCP_RESOURCE_OPTIONS = [
  { key: 'doc-list', capability: 'workspace_doc_list' },
  { key: 'doc-search', capability: 'workspace_doc_keyword_search' },
  { key: 'doc-read', capability: 'workspace_doc_read' },
  { key: 'doc-create', capability: 'workspace_doc_create' },
  { key: 'doc-update', capability: 'workspace_doc_update' },
  { key: 'doc-title', capability: 'workspace_doc_update_meta' },
  { key: 'folder-list', capability: 'workspace_folder_list' },
  { key: 'folder-create', capability: 'workspace_folder_create' },
  { key: 'folder-move', capability: 'workspace_folder_move_document' },
  { key: 'operation-get', capability: 'workspace_operation_get' },
] as const;
export const MCP_CAPABILITY_OPTIONS = [
  ...MCP_RESOURCE_OPTIONS,
  ...MCP_DELEGATION_OPTIONS,
];
export const MCP_CAPABILITY_GROUPS = [
  { key: 'resources', options: MCP_RESOURCE_OPTIONS },
  { key: 'delegation', options: MCP_DELEGATION_OPTIONS },
] as const;
export const MCP_WRITE_CAPABILITIES = new Set<string>([
  'delegate_to_localmind',
  'control_localmind_task',
  'workspace_doc_create',
  'workspace_doc_update',
  'workspace_doc_update_meta',
  'workspace_folder_create',
  'workspace_folder_move_document',
]);
export function needsOperationQueryHint(capabilities: ReadonlySet<string>) {
  return (
    !capabilities.has('workspace_operation_get') &&
    [...capabilities].some(
      capability =>
        capability.startsWith('workspace_') &&
        MCP_WRITE_CAPABILITIES.has(capability)
    )
  );
}

export const DEFAULT_MCP_CAPABILITIES = MCP_DELEGATION_OPTIONS.map(
  option => option.capability
);

export function updateMcpCapabilities(
  current: ReadonlySet<string>,
  capability: string,
  checked: boolean
) {
  const next = new Set(current);
  if (checked) {
    next.add(capability);
  } else {
    next.delete(capability);
  }
  return next;
}
