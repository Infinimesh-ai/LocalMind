ALTER TABLE ai_shared_write_source_checks
  DROP CONSTRAINT ai_shared_write_source_checks_reason_code_check;

ALTER TABLE ai_shared_write_source_checks
  ADD CONSTRAINT ai_shared_write_source_checks_reason_code_check
  CHECK (
    reason_code IN (
      'authorized',
      'unshared_source',
      'source_budget_exceeded',
      'waived_server_resolved_destination'
    )
  );
