ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_timestamp_coherence_check"
  CHECK ("updated_at" >= "created_at") NOT VALID;

ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_timestamp_coherence_check"
  CHECK (
    "updated_at" >= "created_at"
    AND (
      "downloaded_at" IS NULL
      OR "downloaded_at" >= "created_at"
    )
  ) NOT VALID;
