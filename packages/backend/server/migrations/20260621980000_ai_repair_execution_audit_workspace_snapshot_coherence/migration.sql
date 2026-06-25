ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_audit_workspace_key"
  UNIQUE ("id", "workspace_id");

ALTER TABLE "ai_repair_execution_audit_events"
  ADD CONSTRAINT "ai_repair_execution_audit_events_request_workspace_fkey"
  FOREIGN KEY (
    "execution_request_id",
    "workspace_id"
  )
  REFERENCES "ai_repair_execution_requests"(
    "id",
    "workspace_id"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;
