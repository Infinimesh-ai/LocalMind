ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_timestamp_coherence_check"
  CHECK (
    "updated_at" >= "created_at"
    AND (
      "last_attempt_at" IS NULL
      OR "last_attempt_at" >= "created_at"
    )
  ) NOT VALID;
