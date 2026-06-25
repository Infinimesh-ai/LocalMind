ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_failure_pair_check"
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

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_failure_pair_check"
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
