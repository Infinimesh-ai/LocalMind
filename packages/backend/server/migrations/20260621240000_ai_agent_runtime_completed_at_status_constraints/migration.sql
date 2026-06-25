ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_completed_at_status_check"
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

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_completed_at_status_check"
  CHECK (
    (
      "status" IN ('completed', 'failed', 'skipped')
      AND "completed_at" IS NOT NULL
    )
    OR (
      "status" NOT IN ('completed', 'failed', 'skipped')
      AND "completed_at" IS NULL
    )
  ) NOT VALID;
