ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_failure_pair_check"
  CHECK (
    (
      "failure_code" IS NULL
      AND "failure_message" IS NULL
    )
    OR (
      "failure_code" IS NOT NULL
      AND "failure_message" IS NOT NULL
    )
  ) NOT VALID;
