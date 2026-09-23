-- Replace mutable per-strategy checkpoints with immutable revisions and an
-- explicit active pointer. Existing summaries remain available as revisioned
-- evidence; session epoch and shared Project memory revision invalidate stale
-- checkpoints without rewriting them.
ALTER TABLE "ai_context_checkpoints"
  ADD COLUMN "revision" INTEGER,
  ADD COLUMN "context_epoch" INTEGER,
  ADD COLUMN "project_memory_revision" INTEGER,
  ADD COLUMN "status" VARCHAR NOT NULL DEFAULT 'completed',
  ADD COLUMN "summary_data" JSONB NOT NULL DEFAULT '{}';

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY session_id ORDER BY updated_at ASC, id ASC
    ) AS revision
  FROM "ai_context_checkpoints"
)
UPDATE "ai_context_checkpoints" checkpoint
SET revision = ranked.revision,
    context_epoch = session.context_epoch,
    project_memory_revision = settings.project_memory_revision,
    summary_data = jsonb_build_object(
      'format', 'legacy_text/v1',
      'summary', checkpoint.summary
    )
FROM ranked
CROSS JOIN "ai_sessions_metadata" session
LEFT JOIN "ai_project_memory_settings" settings
  ON settings.project_id = session.selected_context_project_id
WHERE checkpoint.id = ranked.id
  AND session.id = checkpoint.session_id;

ALTER TABLE "ai_context_checkpoints"
  ALTER COLUMN "revision" SET NOT NULL,
  ALTER COLUMN "revision" SET DEFAULT 1,
  ALTER COLUMN "context_epoch" SET NOT NULL,
  ALTER COLUMN "context_epoch" SET DEFAULT 1;

ALTER TABLE "ai_context_checkpoints"
  DROP CONSTRAINT IF EXISTS "ai_context_checkpoints_session_id_strategy_version_key";

CREATE UNIQUE INDEX "ai_context_checkpoints_session_id_revision_key"
  ON "ai_context_checkpoints"("session_id", "revision");

CREATE TABLE "ai_context_checkpoint_pointers" (
  "session_id" VARCHAR NOT NULL,
  "checkpoint_id" VARCHAR NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_context_checkpoint_pointers_pkey" PRIMARY KEY ("session_id"),
  CONSTRAINT "ai_context_checkpoint_pointers_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_context_checkpoint_pointers_checkpoint_id_fkey"
    FOREIGN KEY ("checkpoint_id") REFERENCES "ai_context_checkpoints"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ai_context_checkpoint_pointers_checkpoint_id_key"
  ON "ai_context_checkpoint_pointers"("checkpoint_id");

INSERT INTO "ai_context_checkpoint_pointers" ("session_id", "checkpoint_id")
SELECT DISTINCT ON ("session_id") "session_id", id
FROM "ai_context_checkpoints"
ORDER BY "session_id", "revision" DESC;
