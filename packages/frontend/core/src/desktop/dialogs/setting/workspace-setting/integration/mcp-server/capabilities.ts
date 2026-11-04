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
  { key: 'doc-inspect', capability: 'workspace_doc_inspect' },
  { key: 'doc-preview', capability: 'workspace_doc_edit_preview' },
  { key: 'doc-apply', capability: 'workspace_doc_apply' },
  { key: 'doc-export', capability: 'workspace_doc_export' },
  { key: 'doc-history-list', capability: 'workspace_doc_history_list' },
  { key: 'doc-history-read', capability: 'workspace_doc_history_read' },
  { key: 'doc-history-restore', capability: 'workspace_doc_history_restore' },
  { key: 'doc-create-native', capability: 'workspace_doc_create_native' },
  { key: 'doc-import', capability: 'workspace_doc_import' },
  { key: 'doc-asset-read', capability: 'workspace_doc_asset_read' },
  { key: 'doc-asset-upload', capability: 'workspace_doc_asset_upload' },
  { key: 'doc-properties', capability: 'workspace_doc_properties_update' },
  { key: 'doc-duplicate', capability: 'workspace_doc_duplicate' },
  { key: 'doc-lifecycle', capability: 'workspace_doc_lifecycle' },
  { key: 'doc-comments-read', capability: 'workspace_doc_comments_read' },
  { key: 'doc-comments-apply', capability: 'workspace_doc_comments_apply' },
  { key: 'doc-access-read', capability: 'workspace_doc_access_read' },
  { key: 'doc-access-update', capability: 'workspace_doc_access_update' },
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
  'workspace_doc_apply',
  'workspace_doc_history_restore',
  'workspace_doc_properties_update',
  'workspace_doc_asset_upload',
  'workspace_doc_create_native',
  'workspace_doc_import',
  'workspace_doc_duplicate',
  'workspace_doc_lifecycle',
  'workspace_doc_comments_apply',
  'workspace_doc_access_update',
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

// Explicit versioned selection: adding a future tool must not widen this preset.
export const MCP_DOCUMENT_EDIT_PRESET = [
  'workspace_doc_list',
  'workspace_doc_keyword_search',
  'workspace_folder_list',
  'workspace_folder_create',
  'workspace_folder_move_document',
  'workspace_operation_get',
  'workspace_doc_inspect',
  'workspace_doc_edit_preview',
  'workspace_doc_apply',
  'workspace_doc_create_native',
  'workspace_doc_duplicate',
  'workspace_doc_import',
  'workspace_doc_export',
  'workspace_doc_properties_update',
  'workspace_doc_history_list',
  'workspace_doc_history_read',
  'workspace_doc_history_restore',
  'workspace_doc_comments_read',
  'workspace_doc_comments_apply',
  'workspace_doc_asset_read',
  'workspace_doc_asset_upload',
] as const;

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
