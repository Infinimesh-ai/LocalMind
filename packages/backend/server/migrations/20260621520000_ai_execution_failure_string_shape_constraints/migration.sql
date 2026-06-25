ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_failure_string_shape_check"
  CHECK (
    (
      "failure_code" IS NULL
      AND "failure_message" IS NULL
    )
    OR (
      length(btrim("failure_code")) BETWEEN 1 AND 128
      AND length(btrim("failure_message")) BETWEEN 1 AND 2000
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_failure_string_shape_check"
  CHECK (
    (
      "failure_code" IS NULL
      AND "failure_message" IS NULL
    )
    OR (
      length(btrim("failure_code")) BETWEEN 1 AND 128
      AND length(btrim("failure_message")) BETWEEN 1 AND 1024
    )
  ) NOT VALID;
