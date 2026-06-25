ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_worker_lease_pair_check"
  CHECK (
    (
      "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
    )
    OR (
      "worker_lease_id" IS NOT NULL
      AND "worker_lease_expires_at" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_worker_lease_pair_check"
  CHECK (
    (
      "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
    )
    OR (
      "worker_lease_id" IS NOT NULL
      AND "worker_lease_expires_at" IS NOT NULL
    )
  ) NOT VALID;
