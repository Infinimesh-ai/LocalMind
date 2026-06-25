CREATE TABLE "ai_provider_health_probe_attempts" (
  "id" VARCHAR NOT NULL,
  "provider_id" VARCHAR NOT NULL,
  "provider_type" VARCHAR,
  "scope_type" VARCHAR NOT NULL DEFAULT 'workspace',
  "workspace_id" VARCHAR,
  "actor_id" VARCHAR,
  "provider_registry_revision_id" VARCHAR,
  "provider_registry_revision_fingerprint" VARCHAR,
  "provider_profile_source" VARCHAR,
  "provider_profile_fingerprint" VARCHAR NOT NULL,
  "provider_profile_snapshot" JSONB NOT NULL DEFAULT '{}',
  "request_fingerprint" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'queued',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "scheduled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "worker_lease_id" VARCHAR,
  "worker_lease_expires_at" TIMESTAMPTZ(3),
  "checked_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "dead_lettered_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR,
  "failure_message" TEXT,
  "result_status" VARCHAR,
  "result_last_error" TEXT,
  "result_metadata" JSONB NOT NULL DEFAULT '{}',
  "result_fingerprint" VARCHAR,
  "provider_health_state_id" VARCHAR,
  "provider_health_state_fingerprint" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_provider_health_probe_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_health_probe_attempts_request_fingerprint_key"
  ON "ai_provider_health_probe_attempts"("request_fingerprint");

CREATE INDEX "ai_provider_health_probe_attempts_status_scheduled_at_idx"
  ON "ai_provider_health_probe_attempts"("status", "scheduled_at");

CREATE INDEX "ai_provider_health_probe_attempts_status_worker_lease_expires_at_idx"
  ON "ai_provider_health_probe_attempts"("status", "worker_lease_expires_at");

CREATE INDEX "ai_provider_health_probe_attempts_scope_idx"
  ON "ai_provider_health_probe_attempts"("provider_id", "scope_type", "workspace_id", "scheduled_at");

CREATE INDEX "ai_provider_health_probe_attempts_revision_idx"
  ON "ai_provider_health_probe_attempts"("provider_registry_revision_id", "scheduled_at");

CREATE INDEX "ai_provider_health_probe_attempts_workspace_id_scheduled_at_idx"
  ON "ai_provider_health_probe_attempts"("workspace_id", "scheduled_at");

CREATE INDEX "ai_provider_health_probe_attempts_actor_id_scheduled_at_idx"
  ON "ai_provider_health_probe_attempts"("actor_id", "scheduled_at");

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_registry_revision_fkey"
  FOREIGN KEY ("provider_registry_revision_id")
  REFERENCES "ai_provider_registry_revisions"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_health_state_fkey"
  FOREIGN KEY ("provider_health_state_id")
  REFERENCES "ai_provider_health_states"("id")
  ON DELETE CASCADE ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_status_check"
  CHECK (
    "status" IN (
      'queued',
      'processing',
      'retry_scheduled',
      'completed',
      'dead_lettered'
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_scope_check"
  CHECK (
    "scope_type" = 'workspace'
    AND "workspace_id" IS NOT NULL
    AND "actor_id" IS NOT NULL
    AND "provider_registry_revision_id" IS NOT NULL
    AND "provider_registry_revision_fingerprint" IS NOT NULL
  ) NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_attempt_count_check"
  CHECK (
    "attempt_count" >= 0
    AND "max_attempts" BETWEEN 1 AND 10
    AND "attempt_count" <= "max_attempts"
  ) NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_json_shape_check"
  CHECK (
    jsonb_typeof("provider_profile_snapshot") = 'object'
    AND jsonb_typeof("result_metadata") = 'object'
  ) NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_string_shape_check"
  CHECK (
    length(btrim("id")) BETWEEN 1 AND 512
    AND length(btrim("provider_id")) BETWEEN 1 AND 512
    AND (
      "provider_type" IS NULL
      OR length(btrim("provider_type")) BETWEEN 1 AND 128
    )
    AND (
      "provider_profile_source" IS NULL
      OR length(btrim("provider_profile_source")) BETWEEN 1 AND 128
    )
    AND length(btrim("provider_profile_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("request_fingerprint")) BETWEEN 1 AND 128
    AND (
      "provider_registry_revision_fingerprint" IS NULL
      OR length(btrim("provider_registry_revision_fingerprint")) BETWEEN 1 AND 128
    )
    AND (
      "worker_lease_id" IS NULL
      OR length(btrim("worker_lease_id")) BETWEEN 1 AND 512
    )
    AND (
      "failure_code" IS NULL
      OR length(btrim("failure_code")) BETWEEN 1 AND 128
    )
    AND (
      "failure_message" IS NULL
      OR length(btrim("failure_message")) BETWEEN 1 AND 512
    )
    AND (
      "result_status" IS NULL
      OR "result_status" IN ('unknown', 'healthy', 'degraded', 'down')
    )
    AND (
      "result_last_error" IS NULL
      OR length(btrim("result_last_error")) BETWEEN 1 AND 512
    )
    AND (
      "result_fingerprint" IS NULL
      OR length(btrim("result_fingerprint")) BETWEEN 1 AND 128
    )
    AND (
      "provider_health_state_fingerprint" IS NULL
      OR length(btrim("provider_health_state_fingerprint")) BETWEEN 1 AND 128
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_state_check"
  CHECK (
    (
      "status" = 'queued'
      AND "attempt_count" = 0
      AND "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
      AND "checked_at" IS NULL
      AND "completed_at" IS NULL
      AND "dead_lettered_at" IS NULL
      AND "failure_code" IS NULL
      AND "failure_message" IS NULL
      AND "result_status" IS NULL
      AND "result_fingerprint" IS NULL
      AND "provider_health_state_id" IS NULL
      AND "provider_health_state_fingerprint" IS NULL
    )
    OR (
      "status" = 'processing'
      AND "attempt_count" BETWEEN 1 AND "max_attempts"
      AND "worker_lease_id" IS NOT NULL
      AND "worker_lease_expires_at" IS NOT NULL
      AND "checked_at" IS NULL
      AND "completed_at" IS NULL
      AND "dead_lettered_at" IS NULL
      AND "failure_code" IS NULL
      AND "failure_message" IS NULL
      AND "result_status" IS NULL
      AND "result_fingerprint" IS NULL
      AND "provider_health_state_id" IS NULL
      AND "provider_health_state_fingerprint" IS NULL
    )
    OR (
      "status" = 'retry_scheduled'
      AND "attempt_count" BETWEEN 1 AND ("max_attempts" - 1)
      AND "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
      AND "checked_at" IS NULL
      AND "completed_at" IS NULL
      AND "dead_lettered_at" IS NULL
      AND "failure_code" IS NOT NULL
      AND "failure_message" IS NOT NULL
      AND "result_status" IS NULL
      AND "result_fingerprint" IS NULL
      AND "provider_health_state_id" IS NULL
      AND "provider_health_state_fingerprint" IS NULL
    )
    OR (
      "status" = 'completed'
      AND "attempt_count" BETWEEN 1 AND "max_attempts"
      AND "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
      AND "checked_at" IS NOT NULL
      AND "completed_at" IS NOT NULL
      AND "dead_lettered_at" IS NULL
      AND "failure_code" IS NULL
      AND "failure_message" IS NULL
      AND "result_status" IS NOT NULL
      AND "result_fingerprint" IS NOT NULL
      AND "provider_health_state_id" IS NOT NULL
      AND "provider_health_state_fingerprint" IS NOT NULL
    )
    OR (
      "status" = 'dead_lettered'
      AND "attempt_count" BETWEEN 1 AND "max_attempts"
      AND "worker_lease_id" IS NULL
      AND "worker_lease_expires_at" IS NULL
      AND "checked_at" IS NULL
      AND "completed_at" IS NULL
      AND "dead_lettered_at" IS NOT NULL
      AND "failure_code" IS NOT NULL
      AND "failure_message" IS NOT NULL
      AND "result_status" IS NULL
      AND "result_fingerprint" IS NULL
      AND "provider_health_state_id" IS NULL
      AND "provider_health_state_fingerprint" IS NULL
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_health_probe_attempts"
  ADD CONSTRAINT "ai_provider_health_probe_attempts_result_metadata_check"
  CHECK (
    "status" <> 'completed'
    OR (
      btrim(COALESCE("result_metadata"->>'version', '')) =
        'provider-health-probe-attempt-result/v1'
      AND btrim(COALESCE("result_metadata"->>'providerHealthProbeAttemptId', '')) =
        "id"
      AND btrim(COALESCE("result_metadata"->>'providerHealthProbeRequestFingerprint', '')) =
        "request_fingerprint"
      AND btrim(COALESCE("result_metadata"->>'providerRegistryRevisionId', '')) =
        "provider_registry_revision_id"
      AND btrim(COALESCE("result_metadata"->>'providerRegistryRevisionFingerprint', '')) =
        "provider_registry_revision_fingerprint"
      AND btrim(COALESCE("result_metadata"->>'providerProfileFingerprint', '')) =
        "provider_profile_fingerprint"
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION ai_provider_health_probe_attempt_snapshot_valid()
RETURNS trigger AS $$
DECLARE
  revision_record record;
  state_record record;
BEGIN
  SELECT
    id,
    provider_id,
    provider_type,
    scope_type,
    workspace_id,
    actor_id,
    fingerprint,
    status
  INTO revision_record
  FROM "ai_provider_registry_revisions"
  WHERE id = NEW."provider_registry_revision_id";

  IF revision_record.id IS NULL
     OR revision_record.scope_type <> 'workspace'
     OR revision_record.status <> 'active'
     OR revision_record.provider_id IS DISTINCT FROM NEW."provider_id"
     OR revision_record.provider_type IS DISTINCT FROM NEW."provider_type"
     OR revision_record.scope_type IS DISTINCT FROM NEW."scope_type"
     OR revision_record.workspace_id IS DISTINCT FROM NEW."workspace_id"
     OR revision_record.actor_id IS DISTINCT FROM NEW."actor_id"
     OR revision_record.fingerprint IS DISTINCT FROM NEW."provider_registry_revision_fingerprint" THEN
    RAISE EXCEPTION
      'ai_provider_health_probe_attempts_revision_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_provider_health_probe_attempts_revision_snapshot_check';
  END IF;

  IF NEW."provider_health_state_id" IS NOT NULL THEN
    SELECT
      id,
      provider_id,
      scope_type,
      workspace_id,
      fingerprint,
      source
    INTO state_record
    FROM "ai_provider_health_states"
    WHERE id = NEW."provider_health_state_id";

    IF state_record.id IS NULL
       OR state_record.provider_id IS DISTINCT FROM NEW."provider_id"
       OR state_record.scope_type IS DISTINCT FROM NEW."scope_type"
       OR state_record.workspace_id IS DISTINCT FROM NEW."workspace_id"
       OR state_record.fingerprint IS DISTINCT FROM NEW."provider_health_state_fingerprint"
       OR state_record.source IS DISTINCT FROM 'probe_result' THEN
      RAISE EXCEPTION
        'ai_provider_health_probe_attempts_health_state_snapshot_check'
        USING ERRCODE = '23514',
          CONSTRAINT = 'ai_provider_health_probe_attempts_health_state_snapshot_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_health_probe_attempts_snapshot_check"
BEFORE INSERT OR UPDATE OF
  "provider_id",
  "provider_type",
  "scope_type",
  "workspace_id",
  "actor_id",
  "provider_registry_revision_id",
  "provider_registry_revision_fingerprint",
  "provider_health_state_id",
  "provider_health_state_fingerprint"
ON "ai_provider_health_probe_attempts"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_probe_attempt_snapshot_valid();

CREATE OR REPLACE FUNCTION ai_provider_health_probe_attempt_content_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" IN ('completed', 'dead_lettered') THEN
    IF OLD."provider_id" IS DISTINCT FROM NEW."provider_id"
       OR OLD."provider_type" IS DISTINCT FROM NEW."provider_type"
       OR OLD."scope_type" IS DISTINCT FROM NEW."scope_type"
       OR OLD."workspace_id" IS DISTINCT FROM NEW."workspace_id"
       OR OLD."actor_id" IS DISTINCT FROM NEW."actor_id"
       OR OLD."provider_registry_revision_id" IS DISTINCT FROM NEW."provider_registry_revision_id"
       OR OLD."provider_registry_revision_fingerprint" IS DISTINCT FROM NEW."provider_registry_revision_fingerprint"
       OR OLD."provider_profile_source" IS DISTINCT FROM NEW."provider_profile_source"
       OR OLD."provider_profile_fingerprint" IS DISTINCT FROM NEW."provider_profile_fingerprint"
       OR OLD."provider_profile_snapshot" IS DISTINCT FROM NEW."provider_profile_snapshot"
       OR OLD."request_fingerprint" IS DISTINCT FROM NEW."request_fingerprint"
       OR OLD."status" IS DISTINCT FROM NEW."status"
       OR OLD."attempt_count" IS DISTINCT FROM NEW."attempt_count"
       OR OLD."max_attempts" IS DISTINCT FROM NEW."max_attempts"
       OR OLD."scheduled_at" IS DISTINCT FROM NEW."scheduled_at"
       OR OLD."checked_at" IS DISTINCT FROM NEW."checked_at"
       OR OLD."completed_at" IS DISTINCT FROM NEW."completed_at"
       OR OLD."dead_lettered_at" IS DISTINCT FROM NEW."dead_lettered_at"
       OR OLD."failure_code" IS DISTINCT FROM NEW."failure_code"
       OR OLD."failure_message" IS DISTINCT FROM NEW."failure_message"
       OR OLD."result_status" IS DISTINCT FROM NEW."result_status"
       OR OLD."result_last_error" IS DISTINCT FROM NEW."result_last_error"
       OR OLD."result_metadata" IS DISTINCT FROM NEW."result_metadata"
       OR OLD."result_fingerprint" IS DISTINCT FROM NEW."result_fingerprint"
       OR OLD."provider_health_state_id" IS DISTINCT FROM NEW."provider_health_state_id"
       OR OLD."provider_health_state_fingerprint" IS DISTINCT FROM NEW."provider_health_state_fingerprint" THEN
      RAISE EXCEPTION
        'Cannot mutate provider health probe attempt evidence'
        USING ERRCODE = '23514',
          CONSTRAINT = 'ai_provider_health_probe_attempts_content_check';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_health_probe_attempts_content_check"
BEFORE UPDATE
ON "ai_provider_health_probe_attempts"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_probe_attempt_content_guard();

CREATE OR REPLACE FUNCTION ai_provider_health_probe_attempt_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_provider_registry_revisions" revision
    WHERE revision."id" = OLD."provider_registry_revision_id"
  ) THEN
    RAISE EXCEPTION
      'Cannot delete provider health probe attempt while registry revision exists'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_provider_health_probe_attempts_delete_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_provider_health_probe_attempts_delete_check"
AFTER DELETE
ON "ai_provider_health_probe_attempts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_probe_attempt_delete_restrict();
