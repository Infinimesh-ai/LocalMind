ALTER TABLE "ai_context_compaction_tasks"
  ADD COLUMN "result_summary" TEXT,
  ADD COLUMN "result_summary_data" JSONB,
  ADD COLUMN "result_diagnostics" JSONB,
  ADD COLUMN "input_tokens_estimated" INTEGER,
  ADD COLUMN "output_tokens_estimated" INTEGER;

ALTER TABLE "ai_context_compaction_tasks"
  ADD CONSTRAINT "ai_context_compaction_tasks_structured_result_check" CHECK (
    (
      "result_summary" IS NULL
      AND "result_summary_data" IS NULL
      AND "result_diagnostics" IS NULL
    )
    OR (
      char_length("result_summary") BETWEEN 1 AND 10000
      AND jsonb_typeof("result_summary_data") = 'object'
      AND jsonb_typeof("result_diagnostics") = 'object'
      AND "input_tokens_estimated" IS NOT NULL
      AND "input_tokens_estimated" >= 0
      AND "output_tokens_estimated" IS NOT NULL
      AND "output_tokens_estimated" >= 0
    )
  );

CREATE TABLE "ai_context_compaction_events" (
  "id" VARCHAR NOT NULL,
  "sequence" SERIAL NOT NULL,
  "task_id" VARCHAR NOT NULL,
  "session_id" VARCHAR NOT NULL,
  "context_epoch" INTEGER NOT NULL,
  "status" VARCHAR NOT NULL,
  "attempt" INTEGER NOT NULL,
  "statistics" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_compaction_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_compaction_events_status_check" CHECK (
    "status" IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'cancelled', 'stale')
  ),
  CONSTRAINT "ai_context_compaction_events_attempt_check" CHECK ("attempt" >= 0),
  CONSTRAINT "ai_context_compaction_events_statistics_check" CHECK (
    jsonb_typeof("statistics") = 'object'
  )
);

CREATE UNIQUE INDEX "ai_context_compaction_events_sequence_key"
  ON "ai_context_compaction_events"("sequence");
CREATE INDEX "ai_context_compaction_events_session_id_sequence_idx"
  ON "ai_context_compaction_events"("session_id", "sequence");
CREATE INDEX "ai_context_compaction_events_task_id_sequence_idx"
  ON "ai_context_compaction_events"("task_id", "sequence");

ALTER TABLE "ai_context_compaction_events"
  ADD CONSTRAINT "ai_context_compaction_events_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "ai_context_compaction_tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_context_compaction_events"
  ADD CONSTRAINT "ai_context_compaction_events_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ai_context_compaction_events" (
  "id",
  "task_id",
  "session_id",
  "context_epoch",
  "status",
  "attempt",
  "statistics",
  "created_at"
)
SELECT
  gen_random_uuid()::text,
  "id",
  "session_id",
  "context_epoch",
  "status",
  "attempt",
  jsonb_build_object(
    'summarizedMessageCount', "summarized_message_count",
    'inputBudget', "input_budget",
    'outputCharacters', "output_characters"
  ),
  "updated_at"
FROM "ai_context_compaction_tasks";

CREATE OR REPLACE FUNCTION localmind_guard_context_compaction_result()
RETURNS trigger AS $$
BEGIN
  IF OLD."result_summary" IS NOT NULL AND (
    NEW."result_summary" IS DISTINCT FROM OLD."result_summary"
    OR NEW."result_summary_data" IS DISTINCT FROM OLD."result_summary_data"
    OR NEW."result_diagnostics" IS DISTINCT FROM OLD."result_diagnostics"
    OR NEW."input_tokens_estimated" IS DISTINCT FROM OLD."input_tokens_estimated"
    OR NEW."output_tokens_estimated" IS DISTINCT FROM OLD."output_tokens_estimated"
  ) THEN
    RAISE EXCEPTION 'context compaction structured result is immutable';
  END IF;
  IF OLD."result_summary" IS NULL AND NEW."result_summary" IS NOT NULL
    AND OLD."status" <> 'running'
  THEN
    RAISE EXCEPTION 'context compaction result requires a running task';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_context_compaction_tasks_result_guard"
BEFORE UPDATE ON "ai_context_compaction_tasks"
FOR EACH ROW EXECUTE FUNCTION localmind_guard_context_compaction_result();
