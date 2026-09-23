ALTER TABLE "localmind_log_archives"
  ADD COLUMN IF NOT EXISTS "batch_id" VARCHAR;

CREATE TABLE IF NOT EXISTS "localmind_log_archive_batches" (
  "id" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'pending',
  "archive_path" TEXT,
  "key_version" VARCHAR,
  "manifest_fingerprint" VARCHAR,
  "signature" VARCHAR,
  "item_count" INTEGER NOT NULL DEFAULT 0,
  "from_occurred_at" TIMESTAMPTZ(3),
  "to_occurred_at" TIMESTAMPTZ(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "worker_lease_id" VARCHAR,
  "worker_lease_expires_at" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failure_code" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "localmind_log_archive_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "localmind_log_archive_batches_status_check" CHECK (
    "status" IN ('pending', 'running', 'completed', 'retry_wait', 'failed')
  ),
  CONSTRAINT "localmind_log_archive_batches_completed_check" CHECK (
    ("status" = 'completed' AND "completed_at" IS NOT NULL
      AND "manifest_fingerprint" IS NOT NULL AND "signature" IS NOT NULL
      AND "key_version" IS NOT NULL AND "archive_path" IS NOT NULL)
    OR "status" <> 'completed'
  )
);

CREATE INDEX IF NOT EXISTS "localmind_log_archive_batches_status_next_attempt_at_idx"
  ON "localmind_log_archive_batches"("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "localmind_log_archive_batches_worker_lease_expires_at_idx"
  ON "localmind_log_archive_batches"("worker_lease_expires_at");
CREATE INDEX IF NOT EXISTS "localmind_log_archive_batches_completed_at_idx"
  ON "localmind_log_archive_batches"("completed_at");
CREATE INDEX IF NOT EXISTS "localmind_log_archives_batch_id_idx"
  ON "localmind_log_archives"("batch_id");

ALTER TABLE "localmind_log_archives"
  ADD CONSTRAINT "localmind_log_archives_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "localmind_log_archive_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "context_session_recovery_barrier_receipts" (
  "id" VARCHAR NOT NULL,
  "fingerprint" VARCHAR NOT NULL,
  "key_version" VARCHAR NOT NULL,
  "signature" VARCHAR NOT NULL,
  "session_count" INTEGER NOT NULL DEFAULT 0,
  "memory_count" INTEGER NOT NULL DEFAULT 0,
  "grant_count" INTEGER NOT NULL DEFAULT 0,
  "generated_at" TIMESTAMPTZ(3) NOT NULL,
  "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "context_session_recovery_barrier_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "context_session_recovery_barrier_receipts_applied_at_idx"
  ON "context_session_recovery_barrier_receipts"("applied_at");

-- Audit envelopes remain immutable to ordinary application writes. Retention
-- may remove one only after an independently stored, signed archive batch has
-- been verified and marked completed in the same transaction.
CREATE OR REPLACE FUNCTION localmind_audit_envelope_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE'
    AND NULLIF(current_setting('localmind.audit_archive_batch_id', true), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM "localmind_log_archives" archived
      JOIN "localmind_log_archive_batches" batch ON batch."id" = archived."batch_id"
      WHERE archived."event_id" = OLD."event_id"
        AND archived."retention_class" = 'audit'
        AND batch."id" = current_setting('localmind.audit_archive_batch_id', true)
        AND batch."status" = 'completed'
        AND batch."manifest_fingerprint" IS NOT NULL
        AND batch."signature" IS NOT NULL
        AND batch."archive_path" IS NOT NULL
    )
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'localmind audit envelopes are immutable';
END;
$$;
