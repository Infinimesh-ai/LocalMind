ALTER TABLE "ai_support_bundle_transfer_events"
  DROP CONSTRAINT "ai_support_bundle_transfer_events_authorization_fkey";

ALTER TABLE "ai_support_bundle_transfer_events"
  ADD CONSTRAINT "ai_support_bundle_transfer_events_authorization_fkey"
  FOREIGN KEY (
    "authorization_id",
    "bundle_id",
    "workspace_id",
    "actor_id",
    "artifact_kind",
    "manifest_fingerprint",
    "artifact_fingerprint",
    "authorization_fingerprint",
    "delivery_method"
  )
  REFERENCES "ai_support_bundle_download_authorizations" (
    "id",
    "bundle_id",
    "workspace_id",
    "actor_id",
    "artifact_kind",
    "manifest_fingerprint",
    "artifact_fingerprint",
    "authorization_fingerprint",
    "delivery_method"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;
