ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_worker_attempts_check"
  CHECK (
    "worker_attempt" >= 0
    AND "worker_max_attempts" > 0
    AND "worker_attempt" <= "worker_max_attempts"
  ) NOT VALID;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_worker_attempts_check"
  CHECK (
    "worker_attempt" >= 0
    AND "worker_max_attempts" > 0
    AND "worker_attempt" <= "worker_max_attempts"
  ) NOT VALID;
