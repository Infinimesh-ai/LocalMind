ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_queued_at_status_check"
  CHECK (
    (
      "status" = 'queued'
      AND "queued_at" IS NOT NULL
    )
    OR
    (
      "status" = 'waiting_approval'
      AND "queued_at" IS NULL
    )
    OR
    (
      "status" NOT IN ('queued', 'waiting_approval')
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_queued_at_status_check"
  CHECK (
    (
      "status" = 'queued'
      AND "queued_at" IS NOT NULL
    )
    OR
    (
      "status" = 'waiting_approval'
      AND "queued_at" IS NULL
    )
    OR
    (
      "status" NOT IN ('queued', 'waiting_approval')
    )
  ) NOT VALID;
