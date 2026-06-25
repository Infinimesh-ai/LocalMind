ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_artifact_string_shape_check"
  CHECK (
    (
      "manifest_storage_key" IS NULL
      OR length(btrim("manifest_storage_key")) BETWEEN 1 AND 1024
    )
    AND (
      "manifest_mime" IS NULL
      OR length(btrim("manifest_mime")) BETWEEN 1 AND 128
    )
    AND (
      "manifest_filename" IS NULL
      OR length(btrim("manifest_filename")) BETWEEN 1 AND 512
    )
    AND (
      "archive_storage_key" IS NULL
      OR length(btrim("archive_storage_key")) BETWEEN 1 AND 1024
    )
    AND (
      "archive_mime" IS NULL
      OR length(btrim("archive_mime")) BETWEEN 1 AND 128
    )
    AND (
      "archive_filename" IS NULL
      OR length(btrim("archive_filename")) BETWEEN 1 AND 512
    )
  ) NOT VALID;

ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_artifact_string_shape_check"
  CHECK (
    length(btrim("artifact_filename")) BETWEEN 1 AND 512
    AND length(btrim("artifact_mime")) BETWEEN 1 AND 128
    AND (
      "direct_download_url" IS NULL
      OR length(btrim("direct_download_url")) >= 1
    )
  ) NOT VALID;
