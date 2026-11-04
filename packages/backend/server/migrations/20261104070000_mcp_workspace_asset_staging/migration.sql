-- Workspace-scoped staging enables the first native import without a placeholder
-- document. It is available only to the explicitly granted v2 upload tool.
ALTER TABLE mcp_resource_operations DROP CONSTRAINT mcp_resource_target_check;
ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_target_check CHECK ((
  CASE WHEN contract_version = 'localmind-resource-mcp/v1' THEN
    resource_kind IS NULL AND resource_id IS NULL AND (
      (tool_name = 'workspace_folder_create' AND folder_id IS NOT NULL AND document_id IS NULL)
      OR (tool_name <> 'workspace_folder_create' AND document_id IS NOT NULL))
  ELSE
    resource_id IS NOT NULL AND length(resource_id) BETWEEN 1 AND 256 AND (
      (resource_kind IN ('blocksuite', 'office', 'file')
        AND CASE WHEN resource_kind = 'blocksuite' THEN document_id = resource_id ELSE document_id IS NULL END)
      OR (resource_kind = 'workspace' AND resource_id = workspace_id
        AND document_id IS NULL AND tool_name = 'workspace_doc_asset_upload'))
  END
) IS TRUE);
