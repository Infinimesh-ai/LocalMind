ALTER TABLE "ai_sessions_metadata"
  ADD COLUMN "selected_context_project_id" VARCHAR;

ALTER TABLE "ai_context_memories"
  ADD COLUMN "fact_key" VARCHAR,
  ADD COLUMN "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "sensitivity" VARCHAR NOT NULL DEFAULT 'private',
  ADD COLUMN "capture_mode" VARCHAR NOT NULL DEFAULT 'manual',
  ADD COLUMN "writer_version" VARCHAR NOT NULL DEFAULT 'legacy/v1',
  ADD COLUMN "valid_from" TIMESTAMPTZ(3),
  ADD COLUMN "valid_until" TIMESTAMPTZ(3),
  ADD COLUMN "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "supersedes_id" VARCHAR,
  ADD COLUMN "last_used_at" TIMESTAMPTZ(3),
  ADD COLUMN "use_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "embedding" vector(1024);

UPDATE "ai_context_memories"
SET
  "capture_mode" = CASE
    WHEN "kind" = 'auto_memory' THEN 'legacy'
    ELSE 'manual'
  END,
  "writer_version" = 'legacy/v1';

ALTER TABLE "ai_context_memories"
  DROP CONSTRAINT "ai_context_memories_status_check",
  ADD CONSTRAINT "ai_context_memories_status_check"
    CHECK ("status" IN ('active', 'disabled', 'superseded', 'deleted', 'expired')),
  ADD CONSTRAINT "ai_context_memories_quality_check"
    CHECK (
      "confidence" >= 0 AND "confidence" <= 1 AND
      "importance" >= 0 AND "importance" <= 1 AND
      "use_count" >= 0 AND
      ("status" <> 'superseded' OR "valid_until" IS NOT NULL)
    ),
  ADD CONSTRAINT "ai_context_memories_lifecycle_check"
    CHECK (
      ("valid_until" IS NULL OR "valid_from" IS NULL OR "valid_until" > "valid_from") AND
      ("expires_at" IS NULL OR "valid_from" IS NULL OR "expires_at" > "valid_from") AND
      ("supersedes_id" IS NULL OR "supersedes_id" <> "id")
    ),
  ADD CONSTRAINT "ai_context_memories_writer_check"
    CHECK (
      "capture_mode" IN ('manual', 'explicit', 'implicit', 'legacy') AND
      "sensitivity" IN ('private', 'personal', 'restricted') AND
      length(btrim("writer_version")) > 0 AND
      ("fact_key" IS NULL OR length(btrim("fact_key")) > 0)
    );

DROP INDEX "ai_context_memories_private_identity_key";
CREATE UNIQUE INDEX "ai_context_memories_private_active_identity_key"
  ON "ai_context_memories"(
    "owner_user_id",
    COALESCE("workspace_id", ''),
    COALESCE("doc_id", ''),
    COALESCE("project_id", ''),
    "kind",
    "fingerprint"
  )
  WHERE "visibility" = 'private' AND "status" = 'active';

CREATE UNIQUE INDEX "ai_context_memories_private_active_fact_key"
  ON "ai_context_memories"(
    "owner_user_id",
    COALESCE("workspace_id", ''),
    COALESCE("doc_id", ''),
    COALESCE("project_id", ''),
    "kind",
    "fact_key"
  )
  WHERE
    "visibility" = 'private' AND
    "status" = 'active' AND
    "kind" = 'auto_memory' AND
    "fact_key" IS NOT NULL;

CREATE INDEX "ai_sessions_metadata_selected_context_project_id_idx"
  ON "ai_sessions_metadata"("selected_context_project_id");
CREATE INDEX "ai_context_memories_owner_user_id_fact_key_status_updated_at_idx"
  ON "ai_context_memories"("owner_user_id", "fact_key", "status", "updated_at");
CREATE INDEX "ai_context_memories_expires_at_status_idx"
  ON "ai_context_memories"("expires_at", "status");
CREATE INDEX "ai_context_memories_last_used_at_idx"
  ON "ai_context_memories"("last_used_at");
CREATE INDEX "ai_context_memories_supersedes_id_idx"
  ON "ai_context_memories"("supersedes_id");
CREATE INDEX "ai_context_memories_embedding_hnsw_idx"
  ON "ai_context_memories"
  USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;

ALTER TABLE "ai_sessions_metadata"
  ADD CONSTRAINT "ai_sessions_metadata_selected_context_project_id_fkey"
  FOREIGN KEY ("selected_context_project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_supersedes_id_fkey"
  FOREIGN KEY ("supersedes_id") REFERENCES "ai_context_memories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ai_context_memory_events" (
    "id" VARCHAR NOT NULL,
    "owner_user_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR,
    "source_session_id" VARCHAR,
    "source_turn_id" VARCHAR,
    "operation" VARCHAR NOT NULL,
    "memory_id" VARCHAR,
    "previous_memory_id" VARCHAR,
    "target_event_id" VARCHAR,
    "fact_key" VARCHAR,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "reason_code" VARCHAR NOT NULL,
    "writer_version" VARCHAR NOT NULL,
    "decision_fingerprint" VARCHAR NOT NULL,
    "undone_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_memory_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_memory_events_operation_check"
      CHECK ("operation" IN ('ADD', 'UPDATE', 'DELETE', 'NOOP', 'UNDO')),
    CONSTRAINT "ai_context_memory_events_identity_check"
      CHECK (
        length(btrim("reason_code")) > 0 AND
        length(btrim("writer_version")) > 0 AND
        length(btrim("decision_fingerprint")) > 0 AND
        ("fact_key" IS NULL OR length(btrim("fact_key")) > 0) AND
        ("source_turn_id" IS NULL OR length(btrim("source_turn_id")) > 0)
      ),
    CONSTRAINT "ai_context_memory_events_shape_check"
      CHECK (
        ("operation" = 'ADD' AND "memory_id" IS NOT NULL AND "previous_memory_id" IS NULL AND "target_event_id" IS NULL) OR
        ("operation" = 'UPDATE' AND "memory_id" IS NOT NULL AND "previous_memory_id" IS NOT NULL AND "target_event_id" IS NULL) OR
        ("operation" = 'DELETE' AND "memory_id" IS NOT NULL AND "target_event_id" IS NULL) OR
        ("operation" = 'NOOP' AND "target_event_id" IS NULL) OR
        ("operation" = 'UNDO' AND "target_event_id" IS NOT NULL)
      )
);

CREATE UNIQUE INDEX "ai_context_memory_events_decision_fingerprint_key"
  ON "ai_context_memory_events"("decision_fingerprint");
CREATE UNIQUE INDEX "ai_context_memory_events_single_undo_key"
  ON "ai_context_memory_events"("target_event_id")
  WHERE "operation" = 'UNDO';
CREATE INDEX "ai_context_memory_events_owner_user_id_workspace_id_created_at_idx"
  ON "ai_context_memory_events"("owner_user_id", "workspace_id", "created_at");
CREATE INDEX "ai_context_memory_events_source_session_id_created_at_idx"
  ON "ai_context_memory_events"("source_session_id", "created_at");
CREATE INDEX "ai_context_memory_events_memory_id_created_at_idx"
  ON "ai_context_memory_events"("memory_id", "created_at");
CREATE INDEX "ai_context_memory_events_target_event_id_idx"
  ON "ai_context_memory_events"("target_event_id");

ALTER TABLE "ai_context_memory_events"
  ADD CONSTRAINT "ai_context_memory_events_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memory_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memory_events_source_session_id_fkey"
  FOREIGN KEY ("source_session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memory_events_memory_id_fkey"
  FOREIGN KEY ("memory_id") REFERENCES "ai_context_memories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memory_events_previous_memory_id_fkey"
  FOREIGN KEY ("previous_memory_id") REFERENCES "ai_context_memories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memory_events_target_event_id_fkey"
  FOREIGN KEY ("target_event_id") REFERENCES "ai_context_memory_events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_context_rules" (
    "id" VARCHAR NOT NULL,
    "owner_user_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR,
    "project_id" VARCHAR,
    "scope" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "application_mode" VARCHAR NOT NULL DEFAULT 'relevant',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "active_revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_rules_scope_check"
      CHECK (
        ("scope" = 'user' AND "workspace_id" IS NULL AND "project_id" IS NULL) OR
        ("scope" = 'workspace' AND "workspace_id" IS NOT NULL AND "project_id" IS NULL) OR
        ("scope" = 'project' AND "workspace_id" IS NOT NULL AND "project_id" IS NOT NULL)
      ),
    CONSTRAINT "ai_context_rules_mode_check"
      CHECK ("application_mode" IN ('always', 'relevant', 'manual')),
    CONSTRAINT "ai_context_rules_status_check"
      CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "ai_context_rules_values_check"
      CHECK (
        length(btrim("name")) BETWEEN 1 AND 120 AND
        length("description") <= 2000 AND
        "priority" BETWEEN -1000 AND 1000 AND
        "active_revision" > 0 AND
        jsonb_typeof("conditions") = 'object'
      )
);

CREATE TABLE "ai_context_rule_revisions" (
    "id" VARCHAR NOT NULL,
    "rule_id" VARCHAR NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "fingerprint" VARCHAR NOT NULL,
    "created_by_user_id" VARCHAR NOT NULL,
    "source" VARCHAR NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_rule_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_rule_revisions_values_check"
      CHECK (
        "revision" > 0 AND
        length(btrim("content")) BETWEEN 1 AND 8000 AND
        length(btrim("fingerprint")) > 0 AND
        "source" IN ('manual', 'rollback', 'legacy_import')
      )
);

CREATE TABLE "ai_context_rule_hits" (
    "id" VARCHAR NOT NULL,
    "rule_id" VARCHAR NOT NULL,
    "revision_id" VARCHAR NOT NULL,
    "session_id" VARCHAR NOT NULL,
    "source_turn_id" VARCHAR,
    "match_reason" VARCHAR NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_rule_hits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_rule_hits_values_check"
      CHECK (
        "match_reason" IN ('always', 'condition', 'semantic', 'manual') AND
        "score" >= 0 AND
        ("source_turn_id" IS NULL OR length(btrim("source_turn_id")) > 0)
      )
);

CREATE UNIQUE INDEX "ai_context_rule_revisions_rule_id_revision_key"
  ON "ai_context_rule_revisions"("rule_id", "revision");
CREATE INDEX "ai_context_rule_revisions_fingerprint_idx"
  ON "ai_context_rule_revisions"("fingerprint");
CREATE INDEX "ai_context_rules_owner_user_id_workspace_id_status_priority_idx"
  ON "ai_context_rules"("owner_user_id", "workspace_id", "status", "priority");
CREATE INDEX "ai_context_rules_project_id_status_priority_idx"
  ON "ai_context_rules"("project_id", "status", "priority");
CREATE INDEX "ai_context_rule_hits_rule_id_created_at_idx"
  ON "ai_context_rule_hits"("rule_id", "created_at");
CREATE INDEX "ai_context_rule_hits_session_id_created_at_idx"
  ON "ai_context_rule_hits"("session_id", "created_at");

ALTER TABLE "ai_context_rules"
  ADD CONSTRAINT "ai_context_rules_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_rules_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_rules_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_context_rule_revisions"
  ADD CONSTRAINT "ai_context_rule_revisions_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "ai_context_rules"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_rule_revisions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_context_rule_hits"
  ADD CONSTRAINT "ai_context_rule_hits_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "ai_context_rules"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_rule_hits_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "ai_context_rule_revisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_rule_hits_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_context_policies" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "application_mode" VARCHAR NOT NULL DEFAULT 'always',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "active_revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_policies_mode_check"
      CHECK ("application_mode" IN ('always', 'relevant')),
    CONSTRAINT "ai_context_policies_status_check"
      CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "ai_context_policies_values_check"
      CHECK (
        length(btrim("name")) BETWEEN 1 AND 120 AND
        length("description") <= 2000 AND
        "priority" BETWEEN -1000 AND 1000 AND
        "active_revision" > 0 AND
        jsonb_typeof("conditions") = 'object'
      )
);

CREATE TABLE "ai_context_policy_revisions" (
    "id" VARCHAR NOT NULL,
    "policy_id" VARCHAR NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "fingerprint" VARCHAR NOT NULL,
    "created_by_user_id" VARCHAR,
    "source" VARCHAR NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_policy_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_policy_revisions_values_check"
      CHECK (
        "revision" > 0 AND
        length(btrim("content")) BETWEEN 1 AND 8000 AND
        length(btrim("fingerprint")) > 0 AND
        "source" IN ('manual', 'rollback')
      )
);

CREATE TABLE "ai_context_policy_hits" (
    "id" VARCHAR NOT NULL,
    "policy_id" VARCHAR NOT NULL,
    "revision_id" VARCHAR NOT NULL,
    "session_id" VARCHAR NOT NULL,
    "source_turn_id" VARCHAR,
    "match_reason" VARCHAR NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_context_policy_hits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_policy_hits_values_check"
      CHECK (
        "match_reason" IN ('always', 'condition', 'semantic') AND
        "score" >= 0 AND
        ("source_turn_id" IS NULL OR length(btrim("source_turn_id")) > 0)
      )
);

CREATE UNIQUE INDEX "ai_context_policy_revisions_policy_id_revision_key"
  ON "ai_context_policy_revisions"("policy_id", "revision");
CREATE INDEX "ai_context_policy_revisions_fingerprint_idx"
  ON "ai_context_policy_revisions"("fingerprint");
CREATE INDEX "ai_context_policies_workspace_id_status_priority_idx"
  ON "ai_context_policies"("workspace_id", "status", "priority");
CREATE INDEX "ai_context_policy_hits_policy_id_created_at_idx"
  ON "ai_context_policy_hits"("policy_id", "created_at");
CREATE INDEX "ai_context_policy_hits_session_id_created_at_idx"
  ON "ai_context_policy_hits"("session_id", "created_at");

ALTER TABLE "ai_context_policies"
  ADD CONSTRAINT "ai_context_policies_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_policies_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_context_policy_revisions"
  ADD CONSTRAINT "ai_context_policy_revisions_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "ai_context_policies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_policy_revisions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_context_policy_hits"
  ADD CONSTRAINT "ai_context_policy_hits_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "ai_context_policies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_policy_hits_revision_id_fkey"
  FOREIGN KEY ("revision_id") REFERENCES "ai_context_policy_revisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_policy_hits_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ai_context_rules" (
  "id",
  "owner_user_id",
  "workspace_id",
  "project_id",
  "scope",
  "name",
  "description",
  "application_mode",
  "priority",
  "conditions",
  "status",
  "active_revision",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "owner_user_id",
  "workspace_id",
  "project_id",
  "scope",
  'Imported rule ' || left("id", 8),
  'Imported from the legacy context memory model.',
  'always',
  0,
  '{}'::jsonb,
  CASE WHEN "status" = 'active' THEN 'active' ELSE 'disabled' END,
  1,
  "created_at",
  "updated_at"
FROM "ai_context_memories"
WHERE "kind" = 'rule';

CREATE FUNCTION "ai_context_assert_project_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."project_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    WHERE project."id" = NEW."project_id"
      AND project."workspace_id" = NEW."workspace_id"
  ) THEN
    RAISE EXCEPTION 'Context project must belong to the same workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_memories_project_workspace_guard"
BEFORE INSERT OR UPDATE OF "workspace_id", "project_id"
ON "ai_context_memories"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_project_workspace"();

CREATE TRIGGER "ai_context_rules_project_workspace_guard"
BEFORE INSERT OR UPDATE OF "workspace_id", "project_id"
ON "ai_context_rules"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_project_workspace"();

CREATE FUNCTION "ai_context_assert_selected_project_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."selected_context_project_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    WHERE project."id" = NEW."selected_context_project_id"
      AND project."workspace_id" = NEW."workspace_id"
  ) THEN
    RAISE EXCEPTION 'Selected context project must belong to the session workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_sessions_selected_context_project_workspace_guard"
BEFORE INSERT OR UPDATE OF "workspace_id", "selected_context_project_id"
ON "ai_sessions_metadata"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_selected_project_workspace"();

CREATE FUNCTION "ai_context_assert_memory_supersession"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."supersedes_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_memories" previous
    WHERE previous."id" = NEW."supersedes_id"
      AND previous."owner_user_id" = NEW."owner_user_id"
      AND previous."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND previous."doc_id" IS NOT DISTINCT FROM NEW."doc_id"
      AND previous."project_id" IS NOT DISTINCT FROM NEW."project_id"
      AND previous."scope" = NEW."scope"
      AND previous."kind" = NEW."kind"
      AND previous."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
  ) THEN
    RAISE EXCEPTION 'Superseded context memory must share owner, scope, and fact key'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_memories_supersession_guard"
BEFORE INSERT OR UPDATE OF
  "owner_user_id",
  "workspace_id",
  "doc_id",
  "project_id",
  "scope",
  "kind",
  "fact_key",
  "supersedes_id"
ON "ai_context_memories"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_memory_supersession"();

CREATE FUNCTION "ai_context_assert_memory_event_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."source_session_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_sessions_metadata" session
    WHERE session."id" = NEW."source_session_id"
      AND session."user_id" = NEW."owner_user_id"
      AND session."workspace_id" = NEW."workspace_id"
  ) THEN
    RAISE EXCEPTION 'Context memory event source session does not match its owner and workspace'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."memory_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_memories" memory
    WHERE memory."id" = NEW."memory_id"
      AND memory."owner_user_id" = NEW."owner_user_id"
      AND memory."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND memory."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
  ) THEN
    RAISE EXCEPTION 'Context memory event target does not match its owner, workspace, and fact key'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."previous_memory_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_memories" memory
    WHERE memory."id" = NEW."previous_memory_id"
      AND memory."owner_user_id" = NEW."owner_user_id"
      AND memory."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND memory."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
  ) THEN
    RAISE EXCEPTION 'Previous context memory event target does not match its owner, workspace, and fact key'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."target_event_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_memory_events" target
    WHERE target."id" = NEW."target_event_id"
      AND target."owner_user_id" = NEW."owner_user_id"
      AND target."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND target."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
  ) THEN
    RAISE EXCEPTION 'Undo event target does not match its owner, workspace, and fact key'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_memory_events_snapshot_guard"
BEFORE INSERT OR UPDATE OF
  "owner_user_id",
  "workspace_id",
  "source_session_id",
  "memory_id",
  "previous_memory_id",
  "target_event_id",
  "fact_key"
ON "ai_context_memory_events"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_memory_event_snapshot"();

CREATE FUNCTION "ai_context_assert_rule_revision_anchor"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_context_rule_revisions" revision
    WHERE revision."rule_id" = NEW."id"
      AND revision."revision" = NEW."active_revision"
  ) THEN
    RAISE EXCEPTION 'Active context rule revision is missing'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_context_rules_active_revision_guard"
AFTER INSERT OR UPDATE OF "active_revision"
ON "ai_context_rules"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_rule_revision_anchor"();

CREATE FUNCTION "ai_context_assert_policy_revision_anchor"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_context_policy_revisions" revision
    WHERE revision."policy_id" = NEW."id"
      AND revision."revision" = NEW."active_revision"
  ) THEN
    RAISE EXCEPTION 'Active context policy revision is missing'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_context_policies_active_revision_guard"
AFTER INSERT OR UPDATE OF "active_revision"
ON "ai_context_policies"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_policy_revision_anchor"();

CREATE FUNCTION "ai_context_assert_rule_hit_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_context_rule_revisions" revision
    JOIN "ai_context_rules" rule ON rule."id" = revision."rule_id"
    JOIN "ai_sessions_metadata" session ON session."id" = NEW."session_id"
    WHERE revision."id" = NEW."revision_id"
      AND rule."id" = NEW."rule_id"
      AND session."user_id" = rule."owner_user_id"
      AND (
        (rule."scope" = 'user') OR
        (rule."workspace_id" = session."workspace_id")
      )
  ) THEN
    RAISE EXCEPTION 'Context rule hit does not match its revision and session scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_rule_hits_snapshot_guard"
BEFORE INSERT OR UPDATE OF "rule_id", "revision_id", "session_id"
ON "ai_context_rule_hits"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_rule_hit_snapshot"();

CREATE FUNCTION "ai_context_assert_policy_hit_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_context_policy_revisions" revision
    JOIN "ai_context_policies" policy ON policy."id" = revision."policy_id"
    JOIN "ai_sessions_metadata" session ON session."id" = NEW."session_id"
    WHERE revision."id" = NEW."revision_id"
      AND policy."id" = NEW."policy_id"
      AND policy."workspace_id" = session."workspace_id"
  ) THEN
    RAISE EXCEPTION 'Context policy hit does not match its revision and session workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_policy_hits_snapshot_guard"
BEFORE INSERT OR UPDATE OF "policy_id", "revision_id", "session_id"
ON "ai_context_policy_hits"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_policy_hit_snapshot"();

INSERT INTO "ai_context_rule_revisions" (
  "id",
  "rule_id",
  "revision",
  "content",
  "fingerprint",
  "created_by_user_id",
  "source",
  "created_at"
)
SELECT
  "id" || ':revision:1',
  "id",
  1,
  "content",
  "fingerprint",
  "owner_user_id",
  'legacy_import',
  "created_at"
FROM "ai_context_memories"
WHERE "kind" = 'rule';
