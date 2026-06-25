-- Add durable worker scheduling fields for standalone Agent Runtime runs.
ALTER TABLE "ai_agent_runs"
  ADD COLUMN "queued_at" TIMESTAMPTZ(3),
  ADD COLUMN "worker_lease_id" VARCHAR,
  ADD COLUMN "worker_lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "worker_attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "worker_max_attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3);

UPDATE "ai_agent_runs"
SET "queued_at" = "created_at"
WHERE "status" = 'queued'
  AND "queued_at" IS NULL;

CREATE INDEX "ai_agent_runs_status_worker_lease_expires_at_idx"
  ON "ai_agent_runs"("status", "worker_lease_expires_at");

CREATE INDEX "ai_agent_runs_queued_at_idx"
  ON "ai_agent_runs"("queued_at");
