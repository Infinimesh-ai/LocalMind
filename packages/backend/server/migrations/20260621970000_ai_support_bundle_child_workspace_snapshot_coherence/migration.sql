ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_workspace_snapshot_key"
  UNIQUE ("id", "workspace_id");

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_bundle_workspace_snapshot_fkey"
  FOREIGN KEY (
    "bundle_id",
    "workspace_id"
  )
  REFERENCES "ai_support_bundle_requests"(
    "id",
    "workspace_id"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_auth_bundle_workspace_snapshot_fkey"
  FOREIGN KEY (
    "bundle_id",
    "workspace_id"
  )
  REFERENCES "ai_support_bundle_requests"(
    "id",
    "workspace_id"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;
