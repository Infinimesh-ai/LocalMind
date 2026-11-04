-- Add a typed native target without rewriting historical v1 identities or grants.
ALTER TABLE mcp_resource_operations
  ADD COLUMN resource_kind varchar(32),
  ADD COLUMN resource_id varchar;

ALTER TABLE mcp_credentials DROP CONSTRAINT mcp_credentials_capabilities_check;
ALTER TABLE mcp_credentials ADD CONSTRAINT mcp_credentials_capabilities_check CHECK (
  cardinality(capabilities) BETWEEN 1 AND 16 AND capabilities <@ ARRAY[
    'delegate_to_localmind','get_localmind_task','control_localmind_task',
    'workspace_doc_list','workspace_doc_keyword_search','workspace_doc_read',
    'workspace_doc_create','workspace_doc_update','workspace_doc_update_meta',
    'workspace_folder_list','workspace_folder_create','workspace_folder_move_document','workspace_operation_get',
    'workspace_doc_inspect','workspace_doc_edit_preview','workspace_doc_apply'
  ]::text[] AND ((access_mode = 'READ_WRITE') = (capabilities && ARRAY[
    'delegate_to_localmind','control_localmind_task','workspace_doc_create','workspace_doc_update',
    'workspace_doc_update_meta','workspace_folder_create','workspace_folder_move_document','workspace_doc_apply'
  ]::text[]))
);

ALTER TABLE mcp_resource_operations DROP CONSTRAINT mcp_resource_status_check;
ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_status_check CHECK (
  status IN ('processing', 'succeeded', 'failed', 'needs_reconciliation')
  AND ((status IN ('succeeded', 'failed')) = (completed_at IS NOT NULL))
  AND (status NOT IN ('succeeded', 'failed') OR result IS NOT NULL)
  AND (
    (contract_version = 'localmind-resource-mcp/v1' AND tool_name IN (
      'workspace_doc_create', 'workspace_doc_update', 'workspace_doc_update_meta',
      'workspace_folder_create', 'workspace_folder_move_document'))
    OR (contract_version = 'localmind-document-mcp/v2' AND tool_name = 'workspace_doc_apply')
  )
  AND length(idempotency_key) BETWEEN 1 AND 256
  AND request_fingerprint ~ '^[a-f0-9]{64}$'
);

ALTER TABLE mcp_resource_operations DROP CONSTRAINT mcp_resource_target_check;
ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_target_check CHECK ((
  CASE WHEN contract_version = 'localmind-resource-mcp/v1' THEN
    resource_kind IS NULL AND resource_id IS NULL AND (
      (tool_name = 'workspace_folder_create' AND folder_id IS NOT NULL AND document_id IS NULL)
      OR (tool_name <> 'workspace_folder_create' AND document_id IS NOT NULL))
  ELSE
    resource_kind IN ('blocksuite', 'office', 'file') AND resource_id IS NOT NULL
    AND length(resource_id) BETWEEN 1 AND 256
    AND CASE WHEN resource_kind = 'blocksuite' THEN document_id = resource_id ELSE document_id IS NULL END
  END
) IS TRUE);

ALTER TABLE mcp_resource_operations DROP CONSTRAINT mcp_resource_result_identity_check;
ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_result_identity_check CHECK (
  status <> 'succeeded' OR (
    result->>'status' = 'succeeded' AND result->>'writeOutcome' = 'committed'
    AND result->>'operationId' = id AND result->>'workspaceId' = workspace_id
    AND result->>'toolName' = tool_name AND result->>'contractVersion' = contract_version
    AND CASE WHEN contract_version = 'localmind-document-mcp/v2' THEN
      result->'resource'->>'kind' = resource_kind AND result->'resource'->>'id' = resource_id
    WHEN tool_name = 'workspace_folder_create' THEN result->>'folderId' = folder_id
    ELSE result->>'documentId' = document_id END
  ) IS TRUE
);
-- guard_mcp_resource_operation compares all identity columns, so the new
-- resource_kind/resource_id are immutable without changing the trigger.
