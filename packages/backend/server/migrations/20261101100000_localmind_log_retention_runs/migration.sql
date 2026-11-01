-- Durable progress for batched log retention cleanup. Each run commits small
-- delete batches and records its outcome here, independently of the log table.
CREATE TABLE "localmind_log_retention_runs" (
  "id" VARCHAR NOT NULL,
  "kind" VARCHAR NOT NULL DEFAULT 'cleanup',
  "trigger" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "runtime_cutoff" TIMESTAMPTZ(3) NOT NULL,
  "failure_cutoff" TIMESTAMPTZ(3) NOT NULL,
  "scanned" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "batches" INTEGER NOT NULL DEFAULT 0,
  "last_occurred_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3),
  CONSTRAINT "localmind_log_retention_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localmind_log_retention_runs_status_check" CHECK (
    "status" IN ('running', 'completed', 'partial', 'contended', 'paused', 'failed', 'interrupted')
  ),
  CONSTRAINT "localmind_log_retention_runs_trigger_check" CHECK (
    "trigger" IN ('scheduled', 'manual')
  ),
  CONSTRAINT "localmind_log_retention_runs_counts_check" CHECK (
    "scanned" >= 0 AND "deleted" >= 0 AND "deleted" <= "scanned" AND "batches" >= 0
  )
);
CREATE INDEX "localmind_log_retention_runs_kind_started_at_idx" ON "localmind_log_retention_runs" ("kind", "started_at");
CREATE INDEX "localmind_log_retention_runs_status_started_at_idx" ON "localmind_log_retention_runs" ("status", "started_at");
