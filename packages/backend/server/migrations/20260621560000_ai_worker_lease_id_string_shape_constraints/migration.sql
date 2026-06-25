ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_worker_lease_id_shape_check"
  CHECK (
    "worker_lease_id" IS NULL
    OR length(btrim("worker_lease_id")) BETWEEN 1 AND 512
  ) NOT VALID;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_worker_lease_id_shape_check"
  CHECK (
    "worker_lease_id" IS NULL
    OR length(btrim("worker_lease_id")) BETWEEN 1 AND 512
  ) NOT VALID;
