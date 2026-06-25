ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_manifest_artifact_fingerprint_check"
  CHECK (
    "artifact_kind" <> 'manifest_json'
    OR "artifact_fingerprint" = "manifest_fingerprint"
  ) NOT VALID;
