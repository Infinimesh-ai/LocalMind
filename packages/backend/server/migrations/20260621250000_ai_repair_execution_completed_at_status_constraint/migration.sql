ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_completed_at_status_check"
  CHECK (
    (
      "status" IN ('completed', 'failed', 'cancelled')
      AND "completed_at" IS NOT NULL
    )
    OR (
      "status" NOT IN ('completed', 'failed', 'cancelled')
      AND "completed_at" IS NULL
    )
  ) NOT VALID;
