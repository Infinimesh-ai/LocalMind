-- Explicit new capability names only; no historical credential or task snapshot is rewritten.
ALTER TABLE mcp_credentials DROP CONSTRAINT mcp_credentials_capabilities_check;
ALTER TABLE mcp_credentials ADD CONSTRAINT mcp_credentials_capabilities_check CHECK (
  cardinality(capabilities) BETWEEN 1 AND 31 AND capabilities <@ ARRAY['get_localmind_task','workspace_doc_list','workspace_doc_keyword_search','workspace_doc_read','workspace_folder_list','workspace_operation_get','delegate_to_localmind','control_localmind_task','workspace_doc_create','workspace_doc_update','workspace_doc_update_meta','workspace_folder_create','workspace_folder_move_document','workspace_doc_inspect','workspace_doc_edit_preview','workspace_doc_export','workspace_doc_history_list','workspace_doc_history_read','workspace_doc_comments_read','workspace_doc_asset_read','workspace_doc_access_read','workspace_doc_apply','workspace_doc_create_native','workspace_doc_import','workspace_doc_history_restore','workspace_doc_properties_update','workspace_doc_comments_apply','workspace_doc_asset_upload','workspace_doc_duplicate','workspace_doc_lifecycle','workspace_doc_access_update']::text[]
  AND ((access_mode = 'READ_WRITE') = (capabilities && ARRAY['delegate_to_localmind','control_localmind_task','workspace_doc_create','workspace_doc_update','workspace_doc_update_meta','workspace_folder_create','workspace_folder_move_document','workspace_doc_apply','workspace_doc_create_native','workspace_doc_import','workspace_doc_history_restore','workspace_doc_properties_update','workspace_doc_comments_apply','workspace_doc_asset_upload','workspace_doc_duplicate','workspace_doc_lifecycle','workspace_doc_access_update']::text[]))
);
ALTER TABLE mcp_resource_operations DROP CONSTRAINT mcp_resource_status_check;
ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_status_check CHECK (
  status IN ('processing','succeeded','failed','needs_reconciliation')
  AND ((status IN ('succeeded','failed')) = (completed_at IS NOT NULL))
  AND (status NOT IN ('succeeded','failed') OR result IS NOT NULL)
  AND ((contract_version = 'localmind-resource-mcp/v1' AND tool_name IN ('workspace_doc_create','workspace_doc_update','workspace_doc_update_meta','workspace_folder_create','workspace_folder_move_document'))
    OR (contract_version = 'localmind-document-mcp/v2' AND tool_name IN ('workspace_doc_apply','workspace_doc_create_native','workspace_doc_import','workspace_doc_history_restore','workspace_doc_properties_update','workspace_doc_comments_apply','workspace_doc_asset_upload','workspace_doc_duplicate','workspace_doc_lifecycle','workspace_doc_access_update')))
  AND length(idempotency_key) BETWEEN 1 AND 256
  AND request_fingerprint ~ '^[a-f0-9]{64}$'
);
