-- AlterTable
ALTER TABLE "ai_repair_execution_requests"
  ADD COLUMN "queued_at" TIMESTAMPTZ(3),
  ADD COLUMN "worker_lease_id" VARCHAR,
  ADD COLUMN "worker_lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "worker_attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "worker_max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3);

-- Backfill historical terminal rows for observability.
UPDATE "ai_repair_execution_requests"
SET "queued_at" = "created_at"
WHERE "status" IN ('queued', 'running', 'completed', 'failed')
  AND "queued_at" IS NULL;

-- Indexes
CREATE INDEX "ai_repair_execution_requests_status_worker_lease_expires_at_idx"
  ON "ai_repair_execution_requests"("status", "worker_lease_expires_at");

CREATE INDEX "ai_repair_execution_requests_queued_at_idx"
  ON "ai_repair_execution_requests"("queued_at");

-- AlterCheckConstraint
ALTER TABLE "ai_repair_execution_audit_events"
  DROP CONSTRAINT "ai_repair_execution_audit_events_type_check";

ALTER TABLE "ai_repair_execution_audit_events"
  ADD CONSTRAINT "ai_repair_execution_audit_events_type_check"
  CHECK ("event_type" IN (
    'requested',
    'queued',
    'waiting_approval',
    'approval_approved',
    'approval_rejected',
    'running',
    'side_effect_applied',
    'retry_scheduled',
    'completed',
    'failed',
    'cancelled',
    'reused'
  ));
