ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_downloaded_at_status_check"
  CHECK (
    (
      "status" = 'downloaded'
      AND "downloaded_at" IS NOT NULL
    )
    OR (
      "status" <> 'downloaded'
      AND "downloaded_at" IS NULL
    )
  ) NOT VALID;
