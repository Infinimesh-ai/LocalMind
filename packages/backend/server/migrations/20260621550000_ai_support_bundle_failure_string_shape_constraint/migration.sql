ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_failure_string_shape_check"
  CHECK (
    (
      "failure_code" IS NULL
      AND "failure_message" IS NULL
    )
    OR (
      length(btrim("failure_code")) BETWEEN 1 AND 128
      AND length(btrim("failure_message")) BETWEEN 1 AND 512
    )
  ) NOT VALID;
