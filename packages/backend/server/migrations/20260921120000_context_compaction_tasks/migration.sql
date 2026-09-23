-- The original checkpoint table used a standalone unique index, not a named
-- constraint. The immutable-revision migration dropped only the constraint
-- form, so remove the legacy index before publishing multiple revisions.
DROP INDEX IF EXISTS "ai_context_checkpoints_session_id_strategy_version_key";

CREATE TABLE "ai_context_compaction_tasks" (
  "id" VARCHAR NOT NULL,
  "session_id" VARCHAR NOT NULL,
  "actor_user_id_snapshot" VARCHAR NOT NULL,
  "workspace_id_snapshot" VARCHAR,
  "project_id_snapshot" VARCHAR,
  "context_epoch" INTEGER NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'queued',
  "request_fingerprint" VARCHAR NOT NULL,
  "source_fingerprint" VARCHAR NOT NULL,
  "source_message_ids" JSONB NOT NULL DEFAULT '[]',
  "summarized_message_count" INTEGER NOT NULL,
  "previous_checkpoint_id" VARCHAR,
  "strategy_version" VARCHAR NOT NULL,
  "strategy_fingerprint" VARCHAR NOT NULL,
  "model_id" VARCHAR,
  "route_fingerprint" VARCHAR NOT NULL,
  "project_memory_revision" INTEGER,
  "project_context_version" INTEGER,
  "dependencies" JSONB NOT NULL DEFAULT '{}',
  "candidate_summary" TEXT NOT NULL,
  "candidate_summary_data" JSONB NOT NULL DEFAULT '{}',
  "candidate_diagnostics" JSONB NOT NULL DEFAULT '{}',
  "input_budget" INTEGER,
  "output_characters" INTEGER,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "worker_lease_id" VARCHAR,
  "worker_lease_expires_at" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failure_code" VARCHAR,
  "failure_message" TEXT,
  "checkpoint_id" VARCHAR,
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),

  CONSTRAINT "ai_context_compaction_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_compaction_tasks_status_check" CHECK (
    "status" IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'cancelled', 'stale')
  ),
  CONSTRAINT "ai_context_compaction_tasks_attempt_check" CHECK (
    "attempt" >= 0 AND "max_attempts" > 0 AND "attempt" <= "max_attempts"
  ),
  CONSTRAINT "ai_context_compaction_tasks_source_check" CHECK (
    "summarized_message_count" > 0
    AND jsonb_typeof("source_message_ids") = 'array'
    AND jsonb_array_length("source_message_ids") = "summarized_message_count"
  ),
  CONSTRAINT "ai_context_compaction_tasks_payload_shape_check" CHECK (
    jsonb_typeof("dependencies") = 'object'
    AND jsonb_typeof("candidate_summary_data") = 'object'
    AND jsonb_typeof("candidate_diagnostics") = 'object'
    AND char_length("candidate_summary") BETWEEN 1 AND 10000
    AND char_length("request_fingerprint") > 0
    AND char_length("source_fingerprint") > 0
    AND char_length("route_fingerprint") > 0
  ),
  CONSTRAINT "ai_context_compaction_tasks_lease_check" CHECK (
    ("status" = 'running' AND "worker_lease_id" IS NOT NULL AND "worker_lease_expires_at" IS NOT NULL)
    OR ("status" <> 'running' AND "worker_lease_id" IS NULL AND "worker_lease_expires_at" IS NULL)
  ),
  CONSTRAINT "ai_context_compaction_tasks_result_check" CHECK (
    ("status" = 'succeeded' AND "checkpoint_id" IS NOT NULL AND "completed_at" IS NOT NULL)
    OR ("status" <> 'succeeded' AND "checkpoint_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "ai_context_compaction_tasks_request_fingerprint_key"
  ON "ai_context_compaction_tasks"("request_fingerprint");
CREATE UNIQUE INDEX "ai_context_compaction_tasks_checkpoint_id_key"
  ON "ai_context_compaction_tasks"("checkpoint_id");
CREATE INDEX "ai_context_compaction_tasks_status_next_attempt_at_idx"
  ON "ai_context_compaction_tasks"("status", "next_attempt_at");
CREATE INDEX "ai_context_compaction_tasks_worker_lease_expires_at_idx"
  ON "ai_context_compaction_tasks"("worker_lease_expires_at");
CREATE INDEX "ai_context_compaction_tasks_session_id_requested_at_idx"
  ON "ai_context_compaction_tasks"("session_id", "requested_at");

ALTER TABLE "ai_context_compaction_tasks"
  ADD CONSTRAINT "ai_context_compaction_tasks_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_context_compaction_tasks"
  ADD CONSTRAINT "ai_context_compaction_tasks_checkpoint_id_fkey"
  FOREIGN KEY ("checkpoint_id") REFERENCES "ai_context_checkpoints"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION localmind_guard_context_compaction_identity()
RETURNS trigger AS $$
BEGIN
  IF NOT (
    NEW."status" = OLD."status"
    OR (OLD."status" = 'queued' AND NEW."status" IN ('running', 'cancelled'))
    OR (OLD."status" = 'running' AND NEW."status" IN ('succeeded', 'retry_wait', 'failed', 'cancelled', 'stale'))
    OR (OLD."status" = 'retry_wait' AND NEW."status" IN ('running', 'cancelled'))
    OR (OLD."status" IN ('failed', 'cancelled') AND NEW."status" = 'retry_wait')
  ) THEN
    RAISE EXCEPTION 'invalid context compaction status transition: % -> %', OLD."status", NEW."status";
  END IF;
  IF NEW."session_id" IS DISTINCT FROM OLD."session_id"
    OR NEW."actor_user_id_snapshot" IS DISTINCT FROM OLD."actor_user_id_snapshot"
    OR NEW."workspace_id_snapshot" IS DISTINCT FROM OLD."workspace_id_snapshot"
    OR NEW."project_id_snapshot" IS DISTINCT FROM OLD."project_id_snapshot"
    OR NEW."context_epoch" IS DISTINCT FROM OLD."context_epoch"
    OR NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint"
    OR NEW."source_fingerprint" IS DISTINCT FROM OLD."source_fingerprint"
    OR NEW."source_message_ids" IS DISTINCT FROM OLD."source_message_ids"
    OR NEW."summarized_message_count" IS DISTINCT FROM OLD."summarized_message_count"
    OR NEW."previous_checkpoint_id" IS DISTINCT FROM OLD."previous_checkpoint_id"
    OR NEW."strategy_version" IS DISTINCT FROM OLD."strategy_version"
    OR NEW."strategy_fingerprint" IS DISTINCT FROM OLD."strategy_fingerprint"
    OR NEW."model_id" IS DISTINCT FROM OLD."model_id"
    OR NEW."route_fingerprint" IS DISTINCT FROM OLD."route_fingerprint"
    OR NEW."project_memory_revision" IS DISTINCT FROM OLD."project_memory_revision"
    OR NEW."project_context_version" IS DISTINCT FROM OLD."project_context_version"
    OR NEW."dependencies" IS DISTINCT FROM OLD."dependencies"
    OR NEW."candidate_summary" IS DISTINCT FROM OLD."candidate_summary"
    OR NEW."candidate_summary_data" IS DISTINCT FROM OLD."candidate_summary_data"
    OR NEW."candidate_diagnostics" IS DISTINCT FROM OLD."candidate_diagnostics"
    OR NEW."input_budget" IS DISTINCT FROM OLD."input_budget"
    OR (
      NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"
      AND NOT (
        OLD."status" = 'failed'
        AND NEW."status" = 'retry_wait'
        AND NEW."max_attempts" > OLD."max_attempts"
      )
    )
    OR (
      NEW."attempt" IS DISTINCT FROM OLD."attempt"
      AND NOT (
        NEW."status" = 'running'
        AND OLD."status" IN ('queued', 'retry_wait', 'running')
        AND NEW."attempt" = OLD."attempt" + 1
      )
    )
    OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
  THEN
    RAISE EXCEPTION 'context compaction task identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_context_compaction_tasks_identity_guard"
BEFORE UPDATE ON "ai_context_compaction_tasks"
FOR EACH ROW EXECUTE FUNCTION localmind_guard_context_compaction_identity();
