-- Batch timing and failure details for log retention runs, so a slow or
-- failing cleanup can be diagnosed from the run record alone.
ALTER TABLE "localmind_log_retention_runs"
  ADD COLUMN "last_batch_size" INTEGER,
  ADD COLUMN "last_batch_ms" INTEGER,
  ADD COLUMN "max_batch_ms" INTEGER,
  ADD COLUMN "batch_timeouts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_message" VARCHAR(500),
  ADD CONSTRAINT "localmind_log_retention_runs_timing_check" CHECK (
    "batch_timeouts" >= 0
    AND ("last_batch_size" IS NULL OR "last_batch_size" > 0)
    AND ("last_batch_ms" IS NULL OR "last_batch_ms" >= 0)
    AND ("max_batch_ms" IS NULL OR "max_batch_ms" >= 0)
  );
