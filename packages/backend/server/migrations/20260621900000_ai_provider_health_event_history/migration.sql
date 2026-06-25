CREATE TABLE "ai_provider_health_events" (
  "id" VARCHAR NOT NULL,
  "state_id" VARCHAR,
  "provider_id" VARCHAR NOT NULL,
  "provider_type" VARCHAR,
  "scope_type" VARCHAR NOT NULL,
  "workspace_id" VARCHAR,
  "actor_id" VARCHAR,
  "status" VARCHAR NOT NULL,
  "checked_at" TIMESTAMPTZ(3) NOT NULL,
  "last_error" TEXT,
  "source" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "fingerprint" VARCHAR NOT NULL,
  "state_fingerprint" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_provider_health_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_provider_health_events_scope_checked_at_idx"
  ON "ai_provider_health_events"("provider_id", "scope_type", "workspace_id", "checked_at");

CREATE INDEX "ai_provider_health_events_state_id_created_at_idx"
  ON "ai_provider_health_events"("state_id", "created_at");

CREATE INDEX "ai_provider_health_events_workspace_id_checked_at_idx"
  ON "ai_provider_health_events"("workspace_id", "checked_at");

CREATE INDEX "ai_provider_health_events_actor_id_checked_at_idx"
  ON "ai_provider_health_events"("actor_id", "checked_at");

CREATE INDEX "ai_provider_health_events_event_type_checked_at_idx"
  ON "ai_provider_health_events"("event_type", "checked_at");

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_status_check"
  CHECK ("status" IN ('unknown', 'healthy', 'degraded', 'down')) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_source_check"
  CHECK ("source" IN ('manual_override', 'probe_result')) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_scope_type_check"
  CHECK ("scope_type" IN ('global', 'workspace')) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_event_type_check"
  CHECK (
    "event_type" IN (
      'manual_override_recorded',
      'workspace_probe_result_recorded',
      'configured_snapshot_recorded',
      'configured_snapshot_cleared',
      'stale_probe_result_cleared'
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_scope_workspace_check"
  CHECK (
    ("scope_type" = 'global' AND "workspace_id" IS NULL) OR
    ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_metadata_shape_check"
  CHECK (jsonb_typeof("metadata") = 'object') NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_fingerprint_shape_check"
  CHECK (
    length(btrim("fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("state_fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_identity_shape_check"
  CHECK (
    length(btrim("provider_id")) BETWEEN 1 AND 512
    AND (
      "provider_type" IS NULL
      OR length(btrim("provider_type")) BETWEEN 1 AND 128
    )
    AND (
      "state_id" IS NULL
      OR length(btrim("state_id")) BETWEEN 1 AND 512
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_last_error_shape_check"
  CHECK (
    "last_error" IS NULL
    OR length(btrim("last_error")) BETWEEN 1 AND 512
  ) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_metadata_contract_check"
  CHECK (
    ai_provider_health_cleanup_metadata_valid("metadata", "source")
  ) NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_event_type_source_check"
  CHECK (
    (
      "event_type" = 'manual_override_recorded'
      AND "source" = 'manual_override'
      AND btrim("metadata"->>'publishSource') = 'graphql_mutation'
    )
    OR (
      "event_type" = 'workspace_probe_result_recorded'
      AND "source" = 'probe_result'
      AND "scope_type" = 'workspace'
      AND btrim("metadata"->>'publishSource') =
        'workspace_provider_health_probe_result'
    )
    OR (
      "event_type" = 'configured_snapshot_recorded'
      AND "source" = 'probe_result'
      AND "scope_type" = 'global'
      AND btrim("metadata"->>'publishSource') =
        'configured_provider_health_snapshot_worker'
    )
    OR (
      "event_type" = 'configured_snapshot_cleared'
      AND "source" = 'probe_result'
      AND "scope_type" = 'global'
      AND btrim("metadata"->>'publishSource') =
        'configured_provider_health_snapshot_cleanup_worker'
    )
    OR (
      "event_type" = 'stale_probe_result_cleared'
      AND "source" = 'probe_result'
      AND btrim("metadata"->>'publishSource') =
        'provider_health_probe_result_stale_cleanup_worker'
    )
  ) NOT VALID;
