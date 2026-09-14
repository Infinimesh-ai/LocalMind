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
  CONSTRAINT "localmind_log_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "localmind_log_events_event_id_key" ON "localmind_log_events"("event_id");
CREATE INDEX "localmind_log_events_occurred_at_idx" ON "localmind_log_events"("occurred_at");
CREATE INDEX "localmind_log_events_severity_occurred_at_idx" ON "localmind_log_events"("severity", "occurred_at");
CREATE INDEX "localmind_log_events_event_name_occurred_at_idx" ON "localmind_log_events"("event_name", "occurred_at");
CREATE INDEX "localmind_log_events_request_id_idx" ON "localmind_log_events"("request_id");
CREATE INDEX "localmind_log_events_trace_id_idx" ON "localmind_log_events"("trace_id");
CREATE INDEX "localmind_log_events_workspace_id_occurred_at_idx" ON "localmind_log_events"("workspace_id", "occurred_at");
CREATE INDEX "localmind_log_events_project_id_occurred_at_idx" ON "localmind_log_events"("project_id", "occurred_at");
