ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_timestamp_coherence_check"
  CHECK (
    "updated_at" >= "created_at"
    AND (
      "started_at" IS NULL
      OR "completed_at" IS NULL
      OR "completed_at" >= "started_at"
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_timestamp_coherence_check"
  CHECK (
    "updated_at" >= "created_at"
    AND (
      "started_at" IS NULL
      OR "completed_at" IS NULL
      OR "completed_at" >= "started_at"
    )
  ) NOT VALID;
