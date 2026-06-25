ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_status_retention_check"
  CHECK (
    (
      "status" = 'expired'
      AND "retention_status" IN ('expired', 'deleted')
    )
    OR
    (
      "status" <> 'expired'
      AND "retention_status" = 'active'
    )
  ) NOT VALID;
