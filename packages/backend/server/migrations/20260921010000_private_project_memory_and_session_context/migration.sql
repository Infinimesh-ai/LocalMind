-- Workspace/Project context remediation.
--
-- The directory name predates the corrected product decision. Project memory
-- is shared by Project; author identity is provenance, not a recall boundary.
-- A separately-versioned forward migration follows this one so installations
-- that already applied the withdrawn private-project draft can be repaired
-- without rewriting their migration history.

ALTER TABLE "ai_sessions_metadata"
  ADD COLUMN "context_epoch" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "allow_memory_capture" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "memory_capture_revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ai_sessions_metadata"
  ADD CONSTRAINT "ai_sessions_metadata_context_epoch_check"
    CHECK ("context_epoch" > 0),
  ADD CONSTRAINT "ai_sessions_metadata_memory_capture_revision_check"
    CHECK ("memory_capture_revision" > 0);

ALTER TABLE "ai_context_memories"
  ADD COLUMN "last_edited_by_user_id" VARCHAR,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sharing_status" VARCHAR NOT NULL DEFAULT 'private',
  ADD COLUMN "contract_version" VARCHAR NOT NULL DEFAULT 'legacy/v1';

ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_revision_check" CHECK ("revision" > 0),
  ADD CONSTRAINT "ai_context_memories_sharing_status_check"
    CHECK ("sharing_status" IN ('private', 'shared', 'quarantined'));

ALTER TABLE "ai_context_memories"
  DROP CONSTRAINT "ai_context_memories_owner_user_id_fkey",
  ALTER COLUMN "owner_user_id" DROP NOT NULL,
  ADD CONSTRAINT "ai_context_memories_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memories_last_edited_by_user_id_fkey"
    FOREIGN KEY ("last_edited_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_context_rules"
  DROP CONSTRAINT "ai_context_rules_owner_user_id_fkey",
  ALTER COLUMN "owner_user_id" DROP NOT NULL,
  ADD CONSTRAINT "ai_context_rules_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_context_rule_revisions"
  DROP CONSTRAINT "ai_context_rule_revisions_created_by_user_id_fkey",
  ADD CONSTRAINT "ai_context_rule_revisions_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_context_memory_events"
  ADD COLUMN "project_id" VARCHAR;

UPDATE "ai_context_memory_events" event
SET "project_id" = memory."project_id"
FROM "ai_context_memories" memory
WHERE memory."id" = event."memory_id"
  AND memory."scope" = 'project';

ALTER TABLE "ai_context_memory_events"
  DROP CONSTRAINT "ai_context_memory_events_owner_user_id_fkey",
  ALTER COLUMN "owner_user_id" DROP NOT NULL,
  ADD CONSTRAINT "ai_context_memory_events_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memory_events_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ai_context_memories_last_edited_by_user_id_updated_at_idx"
  ON "ai_context_memories"("last_edited_by_user_id", "updated_at");
CREATE INDEX "ai_context_memory_events_project_id_created_at_idx"
  ON "ai_context_memory_events"("project_id", "created_at");

CREATE TABLE "ai_project_memory_settings" (
  "project_id" VARCHAR NOT NULL,
  "auto_memory_enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "project_memory_revision" INTEGER NOT NULL DEFAULT 1,
  "contract_version" VARCHAR NOT NULL DEFAULT 'shared-project-memory/v1',
  "updated_by_user_id" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_project_memory_settings_pkey" PRIMARY KEY ("project_id"),
  CONSTRAINT "ai_project_memory_settings_revision_check"
    CHECK ("revision" > 0 AND "project_memory_revision" > 0),
  CONSTRAINT "ai_project_memory_settings_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_project_memory_settings_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ai_project_memory_settings_updated_by_user_id_updated_at_idx"
  ON "ai_project_memory_settings"("updated_by_user_id", "updated_at");

-- Existing projects do not inherit a Workspace/user preference. Their Owner
-- must explicitly confirm the shared capture policy. Newly-created projects
-- receive an enabled row from the application transaction.
INSERT INTO "ai_project_memory_settings" (
  "project_id", "auto_memory_enabled", "revision", "project_memory_revision"
)
SELECT project."id", false, 1, 1
FROM "ai_context_projects" project
ON CONFLICT ("project_id") DO NOTHING;

CREATE TABLE "ai_context_memory_contributions" (
  "id" VARCHAR NOT NULL,
  "memory_id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "contributor_user_id" VARCHAR,
  "source_session_id" VARCHAR,
  "source_turn_id" VARCHAR,
  "contribution_kind" VARCHAR NOT NULL DEFAULT 'create',
  "status" VARCHAR NOT NULL DEFAULT 'active',
  "content_fingerprint" VARCHAR NOT NULL,
  "request_fingerprint" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawn_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_context_memory_contributions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_memory_contributions_request_fingerprint_key"
    UNIQUE ("request_fingerprint"),
  CONSTRAINT "ai_context_memory_contributions_status_check"
    CHECK ("status" IN ('active', 'withdrawn')),
  CONSTRAINT "ai_context_memory_contributions_memory_fkey"
    FOREIGN KEY ("memory_id", "project_id")
    REFERENCES "ai_context_memories"("id", "project_id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "ai_context_memory_contributions_project_fkey"
    FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_context_memory_contributions_contributor_fkey"
    FOREIGN KEY ("contributor_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ai_context_memory_contributions_session_fkey"
    FOREIGN KEY ("source_session_id") REFERENCES "ai_sessions_metadata"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ai_context_memory_contributions_memory_status_created_at_idx"
  ON "ai_context_memory_contributions"("memory_id", "status", "created_at");
CREATE INDEX "ai_context_memory_contributions_project_contributor_status_created_at_idx"
  ON "ai_context_memory_contributions"(
    "project_id", "contributor_user_id", "status", "created_at"
  );
CREATE INDEX "ai_context_memory_contributions_source_session_id_created_at_idx"
  ON "ai_context_memory_contributions"("source_session_id", "created_at");

CREATE TABLE "ai_project_memory_conflicts" (
  "id" VARCHAR NOT NULL,
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
  "request_fingerprint" VARCHAR NOT NULL,
  "resolved_by_user_id" VARCHAR,
  "resolution" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_project_memory_conflicts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_project_memory_conflicts_request_fingerprint_key"
    UNIQUE ("request_fingerprint"),
  CONSTRAINT "ai_project_memory_conflicts_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'rejected', 'stale')),
  CONSTRAINT "ai_project_memory_conflicts_project_fkey"
    FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_project_memory_conflicts_memory_fkey"
    FOREIGN KEY ("base_memory_id", "project_id")
    REFERENCES "ai_context_memories"("id", "project_id")
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "ai_project_memory_conflicts_session_fkey"
    FOREIGN KEY ("source_session_id") REFERENCES "ai_sessions_metadata"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ai_project_memory_conflicts_proposer_fkey"
    FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ai_project_memory_conflicts_resolver_fkey"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ai_project_memory_conflicts_project_status_created_at_idx"
  ON "ai_project_memory_conflicts"("project_id", "status", "created_at");
CREATE INDEX "ai_project_memory_conflicts_base_memory_status_idx"
  ON "ai_project_memory_conflicts"("base_memory_id", "status");

CREATE TABLE "ai_context_upgrade_quarantines" (
  "id" VARCHAR NOT NULL,
  "entity_type" VARCHAR NOT NULL,
  "entity_id" VARCHAR NOT NULL,
  "owner_user_id_snapshot" VARCHAR,
  "project_id" VARCHAR,
  "reason_code" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "review_before" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_context_upgrade_quarantines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_upgrade_quarantines_entity_type_entity_id_key"
    UNIQUE ("entity_type", "entity_id")
);

CREATE INDEX "ai_context_upgrade_quarantines_reason_code_review_before_idx"
  ON "ai_context_upgrade_quarantines"("reason_code", "review_before");
CREATE INDEX "ai_context_upgrade_quarantines_project_id_created_at_idx"
  ON "ai_context_upgrade_quarantines"("project_id", "created_at");

-- Only records positively identified as having been created by the withdrawn
-- private Project contract are quarantined. No content is copied to the ledger.
INSERT INTO "ai_context_upgrade_quarantines" (
  "id", "entity_type", "entity_id", "owner_user_id_snapshot", "project_id",
  "reason_code", "metadata", "review_before"
)
SELECT
  gen_random_uuid()::text,
  'memory', memory."id", memory."owner_user_id", memory."project_id",
  'withdrawn_private_project_contract',
  jsonb_build_object(
    'fingerprint', memory."fingerprint",
    'writerVersion', memory."writer_version",
    'sourceSessionPresent', memory."source_session_id" IS NOT NULL
  ),
  CURRENT_TIMESTAMP + INTERVAL '90 days'
FROM "ai_context_memories" memory
WHERE memory."scope" = 'project'
  AND memory."writer_version" = 'structured-memory-writer/v2-user-project'
ON CONFLICT ("entity_type", "entity_id") DO NOTHING;

UPDATE "ai_context_memories"
SET
  "sharing_status" = CASE
    WHEN "writer_version" = 'structured-memory-writer/v2-user-project'
      THEN 'quarantined'
    ELSE 'shared'
  END,
  "contract_version" = CASE
    WHEN "writer_version" = 'structured-memory-writer/v2-user-project'
      THEN 'withdrawn-private-project/v2'
    ELSE 'shared-project-memory/v1'
  END,
  "status" = CASE
    WHEN "writer_version" = 'structured-memory-writer/v2-user-project'
      AND "status" IN ('active', 'disabled') THEN 'disabled'
    ELSE "status"
  END,
  "quarantined_at" = CASE
    WHEN "writer_version" = 'structured-memory-writer/v2-user-project'
      THEN COALESCE("quarantined_at", CURRENT_TIMESTAMP)
    ELSE "quarantined_at"
  END,
  "quarantine_reason" = CASE
    WHEN "writer_version" = 'structured-memory-writer/v2-user-project'
      THEN COALESCE("quarantine_reason", 'withdrawn_private_project_contract')
    ELSE "quarantine_reason"
  END,
  "embedding" = CASE
    WHEN "writer_version" = 'structured-memory-writer/v2-user-project'
      THEN NULL
    ELSE "embedding"
  END
WHERE "scope" = 'project';

-- Preserve author provenance for known shared rows. A later contribution by a
-- different member adds another row instead of changing recall ownership.
INSERT INTO "ai_context_memory_contributions" (
  "id", "memory_id", "project_id", "contributor_user_id",
  "source_session_id", "contribution_kind", "content_fingerprint",
  "request_fingerprint"
)
SELECT
  gen_random_uuid()::text,
  memory."id",
  memory."project_id",
  memory."owner_user_id",
  memory."source_session_id",
  'create',
  memory."fingerprint",
  encode(digest(
    'shared-memory-backfill:' || memory."id" || ':' ||
    COALESCE(memory."owner_user_id", 'deleted'), 'sha256'
  ), 'hex')
FROM "ai_context_memories" memory
WHERE memory."scope" = 'project'
  AND memory."sharing_status" = 'shared'
  AND memory."project_id" IS NOT NULL
ON CONFLICT ("request_fingerprint") DO NOTHING;

DROP INDEX IF EXISTS "ai_context_memories_project_active_identity_key";
DROP INDEX IF EXISTS "ai_context_memories_project_active_fact_key";

CREATE UNIQUE INDEX "ai_context_memories_project_active_identity_key"
  ON "ai_context_memories"("project_id", "kind", "fingerprint")
  WHERE "scope" = 'project'
    AND "visibility" = 'private'
    AND "sharing_status" = 'shared'
    AND "status" = 'active';

CREATE UNIQUE INDEX "ai_context_memories_project_active_fact_key"
  ON "ai_context_memories"("project_id", "kind", "fact_key")
  WHERE "scope" = 'project'
    AND "visibility" = 'private'
    AND "sharing_status" = 'shared'
    AND "status" = 'active'
    AND "kind" = 'auto_memory'
    AND "fact_key" IS NOT NULL;

ALTER TABLE "ai_context_memory_events"
  DROP CONSTRAINT "ai_context_memory_events_operation_check",
  DROP CONSTRAINT "ai_context_memory_events_shape_check",
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

DROP TRIGGER IF EXISTS "ai_context_transfer_project_state_before_user_delete"
  ON "users";
DROP FUNCTION IF EXISTS "ai_context_transfer_project_state_before_user_delete"();

CREATE FUNCTION "ai_context_cleanup_user_context_before_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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

  UPDATE "ai_context_memories"
  SET "owner_user_id" = NULL
  WHERE "owner_user_id" = OLD."id" AND "scope" = 'project';

  UPDATE "ai_context_rules"
  SET "owner_user_id" = NULL
  WHERE "owner_user_id" = OLD."id" AND "scope" = 'project';

  UPDATE "ai_context_rule_revisions" revision
  SET "created_by_user_id" = NULL
  FROM "ai_context_rules" rule
  WHERE revision."created_by_user_id" = OLD."id"
    AND rule."id" = revision."rule_id"
    AND rule."scope" = 'project';

  PERFORM set_config('localmind.ai_context_user_delete_actor', '', true);

  RETURN OLD;
END;
$$;

CREATE TRIGGER "ai_context_cleanup_user_context_before_delete"
BEFORE DELETE ON "users"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_cleanup_user_context_before_delete"();

CREATE TABLE "ai_session_deletions" (
  "id" VARCHAR NOT NULL,
  "session_id" VARCHAR NOT NULL,
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
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_session_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_session_deletions_session_id_key" UNIQUE ("session_id"),
  CONSTRAINT "ai_session_deletions_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ai_session_deletions_status_next_attempt_at_idx"
  ON "ai_session_deletions"("status", "next_attempt_at");
CREATE INDEX "ai_session_deletions_worker_lease_expires_at_idx"
  ON "ai_session_deletions"("worker_lease_expires_at");
CREATE INDEX "ai_session_deletions_owner_requested_at_idx"
  ON "ai_session_deletions"("owner_user_id_snapshot", "requested_at");

-- Duplicate Workspace contexts are not merged. Keep the newest row with an
-- empty selection and record only ids/fingerprints for operator review.
WITH duplicate_sessions AS (
  SELECT "session_id" FROM "ai_contexts"
  GROUP BY "session_id" HAVING count(*) > 1
)
INSERT INTO "ai_context_upgrade_quarantines" (
  "id", "entity_type", "entity_id", "reason_code", "metadata", "review_before"
)
SELECT
  gen_random_uuid()::text,
  'workspace_context_session', context."session_id",
  'duplicate_workspace_context_reselection_required',
  jsonb_build_object(
    'rowCount', count(*),
    'contextIds', jsonb_agg(context."id" ORDER BY context."updated_at" DESC),
    'configFingerprints', jsonb_agg(md5(context."config"::text) ORDER BY context."updated_at" DESC)
  ),
  CURRENT_TIMESTAMP + INTERVAL '90 days'
FROM "ai_contexts" context
JOIN duplicate_sessions duplicate ON duplicate."session_id" = context."session_id"
GROUP BY context."session_id"
ON CONFLICT ("entity_type", "entity_id") DO NOTHING;

WITH ranked AS (
  SELECT context."id", context."session_id",
    row_number() OVER (
      PARTITION BY context."session_id"
      ORDER BY context."updated_at" DESC, context."created_at" DESC, context."id" DESC
    ) AS rank
  FROM "ai_contexts" context
), canonical AS (
  UPDATE "ai_contexts" context
  SET "config" = json_build_object(
    'workspaceId', session."workspace_id",
    'blobs', json_build_array(), 'docs', json_build_array(),
    'files', json_build_array(), 'categories', json_build_array()
  )
  FROM ranked, "ai_sessions_metadata" session
  WHERE context."id" = ranked."id" AND ranked.rank = 1
    AND context."session_id" = session."id"
    AND EXISTS (
      SELECT 1 FROM ranked duplicate
      WHERE duplicate."session_id" = ranked."session_id" AND duplicate.rank > 1
    )
  RETURNING context."id"
)
DELETE FROM "ai_contexts" context
USING ranked
WHERE context."id" = ranked."id" AND ranked.rank > 1;

CREATE UNIQUE INDEX "ai_contexts_session_id_key"
  ON "ai_contexts"("session_id");
