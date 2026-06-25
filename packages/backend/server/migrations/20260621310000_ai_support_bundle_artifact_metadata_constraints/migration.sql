ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_manifest_artifact_metadata_check"
  CHECK (
    (
      "manifest_storage_key" IS NULL
      AND "manifest_byte_size" IS NULL
      AND "manifest_mime" IS NULL
      AND "manifest_filename" IS NULL
    )
    OR
    (
      "manifest_storage_key" IS NOT NULL
      AND "manifest_byte_size" IS NOT NULL
      AND "manifest_byte_size" > 0
      AND "manifest_mime" IS NOT NULL
      AND "manifest_filename" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_archive_artifact_metadata_check"
  CHECK (
    (
      "archive_storage_key" IS NULL
      AND "archive_byte_size" IS NULL
      AND "archive_fingerprint" IS NULL
      AND "archive_mime" IS NULL
      AND "archive_filename" IS NULL
    )
    OR
    (
      "archive_storage_key" IS NOT NULL
      AND "archive_byte_size" IS NOT NULL
      AND "archive_byte_size" > 0
      AND "archive_fingerprint" IS NOT NULL
      AND "archive_mime" IS NOT NULL
      AND "archive_filename" IS NOT NULL
    )
  ) NOT VALID;
