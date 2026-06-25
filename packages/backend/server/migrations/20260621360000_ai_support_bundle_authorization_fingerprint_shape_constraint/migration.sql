ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_fingerprint_shape_check"
  CHECK (
    "manifest_fingerprint" ~ '^[a-f0-9]{16}$'
    AND "artifact_fingerprint" ~ '^[a-f0-9]{16}$'
    AND "authorization_fingerprint" ~ '^[a-f0-9]{16}$'
    AND "token_fingerprint" ~ '^[a-f0-9]{64}$'
  ) NOT VALID;
