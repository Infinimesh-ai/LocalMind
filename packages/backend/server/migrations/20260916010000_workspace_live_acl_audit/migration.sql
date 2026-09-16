-- Existing source judgments remain immutable historical evidence.
ALTER TABLE ai_shared_write_source_checks
  ADD COLUMN policy_version VARCHAR NOT NULL DEFAULT 'shared-write-source/v1';
ALTER TABLE ai_shared_write_source_checks
  DROP CONSTRAINT ai_shared_write_source_checks_reason_code_check,
  DROP CONSTRAINT ai_shared_write_source_checks_check;
ALTER TABLE ai_shared_write_source_checks
  ADD CONSTRAINT ai_shared_write_source_checks_policy_check CHECK (
    (policy_version = 'shared-write-source/v1'
      AND reason_code IN ('authorized', 'unshared_source', 'source_budget_exceeded', 'waived_server_resolved_destination')
      AND allowed = (reason_code = 'authorized'))
    OR
    (policy_version = 'workspace-live-acl/v1'
      AND reason_code = 'authorized_by_live_acl' AND allowed AND project_id IS NULL)
  );
