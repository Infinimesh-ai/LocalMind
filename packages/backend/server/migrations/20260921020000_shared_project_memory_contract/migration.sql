-- Forward-only correction for installations that applied the withdrawn
-- per-user Project-memory draft under 20260921010000. Every statement is also
-- safe after the corrected 20260921010000 migration on a new installation.

ALTER TABLE "ai_sessions_metadata"
  ADD COLUMN IF NOT EXISTS "context_epoch" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "allow_memory_capture" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "memory_capture_revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ai_context_memories"
  ADD COLUMN IF NOT EXISTS "last_edited_by_user_id" VARCHAR,
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "sharing_status" VARCHAR NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS "contract_version" VARCHAR NOT NULL DEFAULT 'legacy/v1';

ALTER TABLE "ai_context_memory_events"
  ADD COLUMN IF NOT EXISTS "project_id" VARCHAR;

UPDATE "ai_context_memory_events" event
SET "project_id" = memory."project_id"
FROM "ai_context_memories" memory
WHERE event."memory_id" = memory."id"
  AND memory."scope" = 'project'
  AND event."project_id" IS NULL;

CREATE TABLE IF NOT EXISTS "ai_project_memory_settings" (
  "project_id" VARCHAR NOT NULL PRIMARY KEY,
  "auto_memory_enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "project_memory_revision" INTEGER NOT NULL DEFAULT 1,
  "contract_version" VARCHAR NOT NULL DEFAULT 'shared-project-memory/v1',
  "updated_by_user_id" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ai_context_upgrade_quarantines" (
  "id" VARCHAR NOT NULL PRIMARY KEY,
  "entity_type" VARCHAR NOT NULL,
  "entity_id" VARCHAR NOT NULL,
  "owner_user_id_snapshot" VARCHAR,
  "project_id" VARCHAR,
  "reason_code" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "review_before" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_context_upgrade_quarantines_entity_type_entity_id_key"
    UNIQUE ("entity_type", "entity_id")
);

CREATE TABLE IF NOT EXISTS "ai_context_memory_contributions" (
  "id" VARCHAR NOT NULL PRIMARY KEY,
  "memory_id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "contributor_user_id" VARCHAR,
  "source_session_id" VARCHAR,
  "source_turn_id" VARCHAR,
  "contribution_kind" VARCHAR NOT NULL DEFAULT 'create',
  "status" VARCHAR NOT NULL DEFAULT 'active',
  "content_fingerprint" VARCHAR NOT NULL,
  "request_fingerprint" VARCHAR NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawn_at" TIMESTAMPTZ(3)
);

CREATE TABLE IF NOT EXISTS "ai_project_memory_conflicts" (
  "id" VARCHAR NOT NULL PRIMARY KEY,
  "project_id" VARCHAR NOT NULL,
  "base_memory_id" VARCHAR NOT NULL,
  "proposed_by_user_id" VARCHAR,
  "source_session_id" VARCHAR,
  "source_turn_id" VARCHAR,
  "fact_key" VARCHAR NOT NULL,
  "proposed_content" TEXT NOT NULL,
  "proposed_fingerprint" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'pending',
  "expected_memory_revision" INTEGER NOT NULL,
  "request_fingerprint" VARCHAR NOT NULL UNIQUE,
  "resolved_by_user_id" VARCHAR,
  "resolution" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3)
);

CREATE TABLE IF NOT EXISTS "ai_session_deletions" (
  "id" VARCHAR NOT NULL PRIMARY KEY,
  "session_id" VARCHAR NOT NULL UNIQUE,
  "owner_user_id_snapshot" VARCHAR NOT NULL,
  "workspace_id_snapshot" VARCHAR,
  "project_id_snapshot" VARCHAR,
  "context_epoch" INTEGER NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'requested',
  "request_fingerprint" VARCHAR NOT NULL,
  "progress" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result_counts" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "worker_lease_id" VARCHAR,
  "worker_lease_expires_at" TIMESTAMPTZ(3),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failure_code" VARCHAR,
  "failure_message" TEXT,
  "receipt_fingerprint" VARCHAR,
  "retention_class" VARCHAR NOT NULL DEFAULT 'long_term_minimal',
  "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3)
);

-- Convert old per-user settings into a body-free upgrade record. They are not
-- aggregated into a Project policy because no individual member can choose it.
DO $$
BEGIN
  IF to_regclass('ai_project_context_preferences') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO "ai_context_upgrade_quarantines" (
        "id", "entity_type", "entity_id", "owner_user_id_snapshot",
        "project_id", "reason_code", "metadata", "review_before"
      )
      SELECT gen_random_uuid()::text, 'project_memory_preference', pref."id",
        pref."user_id", pref."project_id", 'withdrawn_per_user_project_setting',
        jsonb_build_object('revision', pref."revision"),
        CURRENT_TIMESTAMP + INTERVAL '90 days'
      FROM "ai_project_context_preferences" pref
      ON CONFLICT ("entity_type", "entity_id") DO NOTHING
    $sql$;
  END IF;
END;
$$;

INSERT INTO "ai_project_memory_settings" (
  "project_id", "auto_memory_enabled", "revision", "project_memory_revision"
)
SELECT project."id", false, 1, 1
FROM "ai_context_projects" project
ON CONFLICT ("project_id") DO NOTHING;

-- Restore only rows that the old migration itself quarantined but that were
-- not produced by its private writer. Private/unknown rows remain excluded.
UPDATE "ai_context_memories" memory
SET "sharing_status" = CASE
      WHEN memory."writer_version" = 'structured-memory-writer/v2-user-project'
        THEN 'quarantined' ELSE 'shared' END,
    "contract_version" = CASE
      WHEN memory."writer_version" = 'structured-memory-writer/v2-user-project'
        THEN 'withdrawn-private-project/v2' ELSE 'shared-project-memory/v1' END,
    "status" = CASE
      WHEN memory."writer_version" = 'structured-memory-writer/v2-user-project'
        AND memory."status" IN ('active', 'disabled') THEN 'disabled'
      WHEN memory."quarantine_reason" = 'legacy_project_owner_unverified'
        AND memory."status" = 'disabled' THEN 'active'
      ELSE memory."status" END,
    "quarantined_at" = CASE
      WHEN memory."writer_version" = 'structured-memory-writer/v2-user-project'
        THEN COALESCE(memory."quarantined_at", CURRENT_TIMESTAMP)
      ELSE NULL END,
    "quarantine_reason" = CASE
      WHEN memory."writer_version" = 'structured-memory-writer/v2-user-project'
        THEN 'withdrawn_private_project_contract' ELSE NULL END,
    "embedding" = CASE
      WHEN memory."writer_version" = 'structured-memory-writer/v2-user-project'
        THEN NULL ELSE memory."embedding" END
WHERE memory."scope" = 'project'
  AND (
    memory."writer_version" = 'structured-memory-writer/v2-user-project'
    OR memory."quarantine_reason" = 'legacy_project_owner_unverified'
    OR memory."sharing_status" = 'private'
  );

INSERT INTO "ai_context_upgrade_quarantines" (
  "id", "entity_type", "entity_id", "owner_user_id_snapshot", "project_id",
  "reason_code", "metadata", "review_before"
)
SELECT gen_random_uuid()::text, 'memory', memory."id", memory."owner_user_id",
  memory."project_id", 'withdrawn_private_project_contract',
  jsonb_build_object(
    'fingerprint', memory."fingerprint",
    'writerVersion', memory."writer_version"
  ), CURRENT_TIMESTAMP + INTERVAL '90 days'
FROM "ai_context_memories" memory
WHERE memory."scope" = 'project'
  AND memory."writer_version" = 'structured-memory-writer/v2-user-project'
ON CONFLICT ("entity_type", "entity_id") DO UPDATE
SET "reason_code" = EXCLUDED."reason_code", "metadata" = EXCLUDED."metadata";

-- Rules created after the withdrawn migration completed cannot be silently
-- reclassified as shared. Legacy rules that migration disabled are restored.
DO $$
DECLARE private_cutover TIMESTAMPTZ;
BEGIN
  SELECT migration."finished_at" INTO private_cutover
  FROM "_prisma_migrations" migration
  WHERE migration."migration_name" =
    '20260921010000_private_project_memory_and_session_context'
  LIMIT 1;

  IF private_cutover IS NOT NULL THEN
    INSERT INTO "ai_context_upgrade_quarantines" (
      "id", "entity_type", "entity_id", "owner_user_id_snapshot", "project_id",
      "reason_code", "metadata", "review_before"
    )
    SELECT gen_random_uuid()::text, 'rule', rule."id", rule."owner_user_id",
      rule."project_id", 'withdrawn_private_project_rule',
      jsonb_build_object('activeRevision', rule."active_revision"),
      CURRENT_TIMESTAMP + INTERVAL '90 days'
    FROM "ai_context_rules" rule
    WHERE rule."scope" = 'project' AND rule."created_at" > private_cutover
    ON CONFLICT ("entity_type", "entity_id") DO NOTHING;

    UPDATE "ai_context_rules" rule SET "status" = 'disabled'
    WHERE rule."scope" = 'project' AND rule."created_at" > private_cutover;

    UPDATE "ai_context_rules" rule
    SET "status" = CASE
      WHEN quarantine."metadata"->>'status' IN ('active', 'disabled')
        THEN quarantine."metadata"->>'status' ELSE 'active' END
    FROM "ai_context_upgrade_quarantines" quarantine
    WHERE quarantine."entity_type" = 'rule'
      AND quarantine."entity_id" = rule."id"
      AND quarantine."reason_code" = 'legacy_project_owner_unverified'
      AND rule."created_at" <= private_cutover;
  END IF;
END;
$$;

INSERT INTO "ai_context_memory_contributions" (
  "id", "memory_id", "project_id", "contributor_user_id",
  "source_session_id", "contribution_kind", "content_fingerprint",
  "request_fingerprint"
)
SELECT gen_random_uuid()::text, memory."id", memory."project_id",
  memory."owner_user_id", memory."source_session_id", 'create',
  memory."fingerprint",
  encode(digest('shared-memory-backfill:' || memory."id" || ':' ||
    COALESCE(memory."owner_user_id", 'deleted'), 'sha256'), 'hex')
FROM "ai_context_memories" memory
WHERE memory."scope" = 'project'
  AND memory."sharing_status" = 'shared'
  AND memory."project_id" IS NOT NULL
ON CONFLICT ("request_fingerprint") DO NOTHING;

DROP INDEX IF EXISTS "ai_context_memories_project_active_identity_key";
DROP INDEX IF EXISTS "ai_context_memories_project_active_fact_key";
CREATE UNIQUE INDEX "ai_context_memories_project_active_identity_key"
  ON "ai_context_memories"("project_id", "kind", "fingerprint")
  WHERE "scope" = 'project' AND "visibility" = 'private'
    AND "sharing_status" = 'shared' AND "status" = 'active';
CREATE UNIQUE INDEX "ai_context_memories_project_active_fact_key"
  ON "ai_context_memories"("project_id", "kind", "fact_key")
  WHERE "scope" = 'project' AND "visibility" = 'private'
    AND "sharing_status" = 'shared' AND "status" = 'active'
    AND "kind" = 'auto_memory' AND "fact_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ai_context_memory_contributions_memory_status_created_at_idx"
  ON "ai_context_memory_contributions"("memory_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "ai_context_memory_contributions_project_contributor_status_created_at_idx"
  ON "ai_context_memory_contributions"("project_id", "contributor_user_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "ai_context_memory_contributions_source_session_id_created_at_idx"
  ON "ai_context_memory_contributions"("source_session_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_project_memory_conflicts_project_status_created_at_idx"
  ON "ai_project_memory_conflicts"("project_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "ai_project_memory_conflicts_base_memory_status_idx"
  ON "ai_project_memory_conflicts"("base_memory_id", "status");
CREATE INDEX IF NOT EXISTS "ai_session_deletions_status_next_attempt_at_idx"
  ON "ai_session_deletions"("status", "next_attempt_at");

ALTER TABLE "ai_context_memory_events"
  DROP CONSTRAINT IF EXISTS "ai_context_memory_events_operation_check",
  DROP CONSTRAINT IF EXISTS "ai_context_memory_events_shape_check",
  ADD CONSTRAINT "ai_context_memory_events_operation_check"
    CHECK ("operation" IN (
      'ADD', 'UPDATE', 'DELETE', 'NOOP', 'UNDO', 'WITHDRAW', 'PENDING_CONFLICT'
    )),
  ADD CONSTRAINT "ai_context_memory_events_shape_check" CHECK (
    ("operation" = 'ADD' AND "memory_id" IS NOT NULL AND "previous_memory_id" IS NULL AND "target_event_id" IS NULL) OR
    ("operation" = 'UPDATE' AND "memory_id" IS NOT NULL AND "previous_memory_id" IS NOT NULL AND "target_event_id" IS NULL) OR
    ("operation" IN ('DELETE', 'WITHDRAW', 'PENDING_CONFLICT') AND "memory_id" IS NOT NULL AND "target_event_id" IS NULL) OR
    ("operation" = 'NOOP' AND "target_event_id" IS NULL) OR
    ("operation" = 'UNDO' AND "target_event_id" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION "ai_context_assert_memory_supersession"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."supersedes_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ai_context_memories" previous
    WHERE previous."id" = NEW."supersedes_id"
      AND previous."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND previous."doc_id" IS NOT DISTINCT FROM NEW."doc_id"
      AND previous."project_id" IS NOT DISTINCT FROM NEW."project_id"
      AND previous."scope" = NEW."scope"
      AND previous."kind" = NEW."kind"
      AND previous."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
      AND (NEW."scope" = 'project' OR previous."owner_user_id" = NEW."owner_user_id")
  ) THEN
    RAISE EXCEPTION 'Superseded context memory must share its principal, scope, and fact key'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Install missing foreign keys only when correcting an already-applied draft.
DO $$
BEGIN
  ALTER TABLE "ai_context_memories"
    DROP CONSTRAINT IF EXISTS "ai_context_memories_owner_user_id_fkey",
    ALTER COLUMN "owner_user_id" DROP NOT NULL,
    ADD CONSTRAINT "ai_context_memories_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "ai_context_memories"
    DROP CONSTRAINT IF EXISTS "ai_context_memories_last_edited_by_user_id_fkey",
    ADD CONSTRAINT "ai_context_memories_last_edited_by_user_id_fkey"
      FOREIGN KEY ("last_edited_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "ai_context_rules"
    DROP CONSTRAINT IF EXISTS "ai_context_rules_owner_user_id_fkey",
    ALTER COLUMN "owner_user_id" DROP NOT NULL,
    ADD CONSTRAINT "ai_context_rules_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "ai_context_rule_revisions"
    DROP CONSTRAINT IF EXISTS "ai_context_rule_revisions_created_by_user_id_fkey",
    ADD CONSTRAINT "ai_context_rule_revisions_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "ai_context_memory_events"
    DROP CONSTRAINT IF EXISTS "ai_context_memory_events_owner_user_id_fkey",
    ALTER COLUMN "owner_user_id" DROP NOT NULL,
    ADD CONSTRAINT "ai_context_memory_events_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_context_memory_events_project_id_fkey'
  ) THEN
    ALTER TABLE "ai_context_memory_events"
      ADD CONSTRAINT "ai_context_memory_events_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_project_memory_settings_project_id_fkey'
  ) THEN
    ALTER TABLE "ai_project_memory_settings"
      ADD CONSTRAINT "ai_project_memory_settings_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_project_memory_settings_updated_by_user_id_fkey'
  ) THEN
    ALTER TABLE "ai_project_memory_settings"
      ADD CONSTRAINT "ai_project_memory_settings_updated_by_user_id_fkey"
      FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_context_memory_contributions_memory_fkey'
  ) THEN
    ALTER TABLE "ai_context_memory_contributions"
      ADD CONSTRAINT "ai_context_memory_contributions_memory_fkey"
      FOREIGN KEY ("memory_id", "project_id")
      REFERENCES "ai_context_memories"("id", "project_id")
      ON DELETE CASCADE ON UPDATE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_context_memory_contributions_project_fkey'
  ) THEN
    ALTER TABLE "ai_context_memory_contributions"
      ADD CONSTRAINT "ai_context_memory_contributions_project_fkey"
      FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_context_memory_contributions_contributor_fkey'
  ) THEN
    ALTER TABLE "ai_context_memory_contributions"
      ADD CONSTRAINT "ai_context_memory_contributions_contributor_fkey"
      FOREIGN KEY ("contributor_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_context_memory_contributions_session_fkey'
  ) THEN
    ALTER TABLE "ai_context_memory_contributions"
      ADD CONSTRAINT "ai_context_memory_contributions_session_fkey"
      FOREIGN KEY ("source_session_id") REFERENCES "ai_sessions_metadata"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_project_memory_conflicts_project_fkey'
  ) THEN
    ALTER TABLE "ai_project_memory_conflicts"
      ADD CONSTRAINT "ai_project_memory_conflicts_project_fkey"
      FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_project_memory_conflicts_memory_fkey'
  ) THEN
    ALTER TABLE "ai_project_memory_conflicts"
      ADD CONSTRAINT "ai_project_memory_conflicts_memory_fkey"
      FOREIGN KEY ("base_memory_id", "project_id")
      REFERENCES "ai_context_memories"("id", "project_id")
      ON DELETE CASCADE ON UPDATE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_project_memory_conflicts_session_fkey'
  ) THEN
    ALTER TABLE "ai_project_memory_conflicts"
      ADD CONSTRAINT "ai_project_memory_conflicts_session_fkey"
      FOREIGN KEY ("source_session_id") REFERENCES "ai_sessions_metadata"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_project_memory_conflicts_proposer_fkey'
  ) THEN
    ALTER TABLE "ai_project_memory_conflicts"
      ADD CONSTRAINT "ai_project_memory_conflicts_proposer_fkey"
      FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_project_memory_conflicts_resolver_fkey'
  ) THEN
    ALTER TABLE "ai_project_memory_conflicts"
      ADD CONSTRAINT "ai_project_memory_conflicts_resolver_fkey"
      FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_session_deletions_session_id_fkey'
  ) THEN
    ALTER TABLE "ai_session_deletions"
      ADD CONSTRAINT "ai_session_deletions_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  ELSE
    ALTER TABLE "ai_session_deletions"
      DROP CONSTRAINT "ai_session_deletions_session_id_fkey",
      ADD CONSTRAINT "ai_session_deletions_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS "ai_context_transfer_project_state_before_user_delete" ON "users";
DROP FUNCTION IF EXISTS "ai_context_transfer_project_state_before_user_delete"();
DROP TRIGGER IF EXISTS "ai_context_cleanup_user_context_before_delete" ON "users";
DROP FUNCTION IF EXISTS "ai_context_cleanup_user_context_before_delete"();

CREATE FUNCTION "ai_context_cleanup_user_context_before_delete"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('localmind.ai_context_user_delete_actor', OLD."id", true);
  DELETE FROM "ai_context_memory_events"
    WHERE "owner_user_id" = OLD."id" AND "project_id" IS NULL;
  DELETE FROM "ai_context_memories"
    WHERE "owner_user_id" = OLD."id" AND "scope" <> 'project';
  DELETE FROM "ai_context_rules"
    WHERE "owner_user_id" = OLD."id" AND "scope" <> 'project';
  UPDATE "ai_context_memory_events"
    SET "owner_user_id" = NULL, "source_session_id" = NULL
    WHERE "owner_user_id" = OLD."id" AND "project_id" IS NOT NULL;
  UPDATE "ai_context_memories" SET "owner_user_id" = NULL
    WHERE "owner_user_id" = OLD."id" AND "scope" = 'project';
  UPDATE "ai_context_rules" SET "owner_user_id" = NULL
    WHERE "owner_user_id" = OLD."id" AND "scope" = 'project';
  PERFORM set_config('localmind.ai_context_user_delete_actor', '', true);
  RETURN OLD;
END;
$$;

CREATE TRIGGER "ai_context_cleanup_user_context_before_delete"
BEFORE DELETE ON "users" FOR EACH ROW
EXECUTE FUNCTION "ai_context_cleanup_user_context_before_delete"();
