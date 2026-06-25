ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_worker_lease_status_check"
  CHECK (
    "status" = 'running'
    OR (
      "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_worker_lease_status_check"
  CHECK (
    "status" = 'running'
    OR (
      "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
    )
  ) NOT VALID;
