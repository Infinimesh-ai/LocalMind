ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_direct_expiry_check"
  CHECK (
    "direct_download_expires_at" IS NULL
    OR "direct_download_expires_at" <= "expires_at"
  ) NOT VALID;
