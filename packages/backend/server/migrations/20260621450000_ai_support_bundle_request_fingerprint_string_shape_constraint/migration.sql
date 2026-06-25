ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_fingerprint_shape_check"
  CHECK (
    length(btrim("source_evidence_set_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("manifest_fingerprint")) BETWEEN 1 AND 128
    AND (
      "archive_fingerprint" IS NULL
      OR length(btrim("archive_fingerprint")) BETWEEN 1 AND 128
    )
  ) NOT VALID;
