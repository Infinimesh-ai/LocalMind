-- Existing live Project conversations follow the new default contribution policy.
-- Deleted conversations and personal work orders retain their isolation.
UPDATE ai_sessions_metadata
SET allow_memory_capture = true,
    memory_capture_revision = memory_capture_revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE scope_type = 'project'
  AND selected_context_project_id IS NOT NULL
  AND workspace_id IS NULL
  AND doc_id IS NULL
  AND deleted_at IS NULL
  AND allow_memory_capture = false;
