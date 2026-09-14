-- Convert the log table to a time-partitioned parent while preserving existing rows.
-- A DEFAULT partition keeps writes valid before the next scheduled partition is created.
ALTER TABLE "localmind_log_events" RENAME TO "localmind_log_events_legacy";
ALTER INDEX IF EXISTS "localmind_log_events_pkey" RENAME TO "localmind_log_events_legacy_pkey";
ALTER INDEX IF EXISTS "localmind_log_events_event_id_key" RENAME TO "localmind_log_events_legacy_event_id_key";
ALTER INDEX IF EXISTS "localmind_log_events_occurred_at_idx" RENAME TO "localmind_log_events_legacy_occurred_at_idx";
ALTER INDEX IF EXISTS "localmind_log_events_severity_occurred_at_idx" RENAME TO "localmind_log_events_legacy_severity_occurred_at_idx";
ALTER INDEX IF EXISTS "localmind_log_events_event_name_occurred_at_idx" RENAME TO "localmind_log_events_legacy_event_name_occurred_at_idx";
ALTER INDEX IF EXISTS "localmind_log_events_request_id_idx" RENAME TO "localmind_log_events_legacy_request_id_idx";
ALTER INDEX IF EXISTS "localmind_log_events_trace_id_idx" RENAME TO "localmind_log_events_legacy_trace_id_idx";
ALTER INDEX IF EXISTS "localmind_log_events_workspace_id_occurred_at_idx" RENAME TO "localmind_log_events_legacy_workspace_id_occurred_at_idx";
ALTER INDEX IF EXISTS "localmind_log_events_project_id_occurred_at_idx" RENAME TO "localmind_log_events_legacy_project_id_occurred_at_idx";

CREATE TABLE "localmind_log_events" (
  "id" VARCHAR NOT NULL,
  "event_id" VARCHAR NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "instance_id" VARCHAR NOT NULL,
  "node_id" VARCHAR NOT NULL,
  "service" VARCHAR NOT NULL,
  "component" VARCHAR,
  "severity" VARCHAR NOT NULL,
  "event_name" VARCHAR NOT NULL,
  "message_template" VARCHAR,
  "message_params" JSONB,
  "request_id" VARCHAR,
  "trace_id" VARCHAR,
  "span_id" VARCHAR,
  "actor_type" VARCHAR,
  "actor_id_hash" VARCHAR,
  "workspace_id" VARCHAR,
  "project_id" VARCHAR,
  "resource_type" VARCHAR,
  "resource_id" VARCHAR,
  "session_id" VARCHAR,
  "run_id" VARCHAR,
  "step_id" VARCHAR,
  "job_name" VARCHAR,
  "job_id" VARCHAR,
  "status" VARCHAR,
  "error_code" VARCHAR,
  "duration_ms" INTEGER,
  "metadata" JSONB,
  "redaction_version" VARCHAR NOT NULL DEFAULT 'v1',
  "retention_class" VARCHAR NOT NULL DEFAULT 'runtime',
  CONSTRAINT "localmind_log_events_pkey" PRIMARY KEY ("id", "occurred_at")
) PARTITION BY RANGE ("occurred_at");

CREATE TABLE "localmind_log_events_default" PARTITION OF "localmind_log_events" DEFAULT;
CREATE TABLE "localmind_log_events_2026" PARTITION OF "localmind_log_events"
  FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE "localmind_log_events_2027" PARTITION OF "localmind_log_events"
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');
CREATE TABLE "localmind_log_events_2028" PARTITION OF "localmind_log_events"
  FOR VALUES FROM ('2028-01-01 00:00:00+00') TO ('2029-01-01 00:00:00+00');
CREATE INDEX "localmind_log_events_default_event_id_idx" ON "localmind_log_events_default" ("event_id");

INSERT INTO "localmind_log_events"
SELECT * FROM "localmind_log_events_legacy";

-- This registry provides a global idempotency constraint because PostgreSQL
-- requires a partition key in unique indexes on partitioned tables.
CREATE TABLE "localmind_log_event_ids" (
  "event_id" VARCHAR PRIMARY KEY,
  "log_id" VARCHAR NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL
);
INSERT INTO "localmind_log_event_ids" ("event_id", "log_id", "occurred_at")
SELECT "event_id", "id", "occurred_at" FROM "localmind_log_events_legacy";

CREATE OR REPLACE FUNCTION localmind_log_event_id_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "localmind_log_event_ids" ("event_id", "log_id", "occurred_at")
  VALUES (NEW."event_id", NEW."id", NEW."occurred_at")
  ON CONFLICT ("event_id") DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'duplicate LocalMind log event_id: %', NEW."event_id"
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER localmind_log_event_id_guard
BEFORE INSERT ON "localmind_log_events"
FOR EACH ROW EXECUTE FUNCTION localmind_log_event_id_guard();

CREATE OR REPLACE FUNCTION localmind_log_event_id_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "localmind_log_event_ids" WHERE "event_id" = OLD."event_id";
  RETURN OLD;
END;
$$;
CREATE TRIGGER localmind_log_event_id_delete
AFTER DELETE ON "localmind_log_events"
FOR EACH ROW EXECUTE FUNCTION localmind_log_event_id_delete();

CREATE INDEX "localmind_log_events_occurred_at_idx" ON "localmind_log_events" ("occurred_at");
CREATE INDEX "localmind_log_events_event_id_idx" ON "localmind_log_events" ("event_id");
CREATE INDEX "localmind_log_events_severity_occurred_at_idx" ON "localmind_log_events" ("severity", "occurred_at");
CREATE INDEX "localmind_log_events_event_name_occurred_at_idx" ON "localmind_log_events" ("event_name", "occurred_at");
CREATE INDEX "localmind_log_events_request_id_idx" ON "localmind_log_events" ("request_id");
CREATE INDEX "localmind_log_events_trace_id_idx" ON "localmind_log_events" ("trace_id");
CREATE INDEX "localmind_log_events_workspace_id_occurred_at_idx" ON "localmind_log_events" ("workspace_id", "occurred_at");
CREATE INDEX "localmind_log_events_project_id_occurred_at_idx" ON "localmind_log_events" ("project_id", "occurred_at");

DROP TABLE "localmind_log_events_legacy";
