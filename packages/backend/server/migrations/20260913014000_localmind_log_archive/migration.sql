ALTER TABLE "localmind_log_policies"
  ADD COLUMN "retention_frozen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "frozen_at" TIMESTAMPTZ(3);

CREATE TABLE "localmind_log_archives" (
  "id" VARCHAR NOT NULL,
  "event_id" VARCHAR NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retention_class" VARCHAR NOT NULL,
  "payload" JSONB NOT NULL,
  CONSTRAINT "localmind_log_archives_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "localmind_log_archives_event_id_key" ON "localmind_log_archives" ("event_id");
CREATE INDEX "localmind_log_archives_occurred_at_idx" ON "localmind_log_archives" ("occurred_at");
CREATE INDEX "localmind_log_archives_archived_at_idx" ON "localmind_log_archives" ("archived_at");
