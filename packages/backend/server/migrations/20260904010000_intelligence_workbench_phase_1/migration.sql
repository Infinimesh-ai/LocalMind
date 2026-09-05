-- Abort before any DDL when a deleted legacy creator has no active source
-- workspace owner to inherit ownership.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    WHERE project."created_by_user_id" IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "workspace_members" member
        WHERE member."workspace_id" = project."workspace_id"
          AND member."role" = 'owner'
          AND member."state" = 'active'
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot globalize AI context project without an active owner'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Audit actors may be deleted without destroying Project-owned evidence. The
-- Project state rows themselves retain their non-null owner FK and are handed
-- to another Project owner by the user deletion trigger below.
ALTER TABLE "ai_context_memory_events"
  DROP CONSTRAINT "ai_context_memory_events_owner_user_id_fkey",
  ALTER COLUMN "owner_user_id" DROP NOT NULL,
  ADD CONSTRAINT "ai_context_memory_events_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_context_rule_revisions"
  DROP CONSTRAINT "ai_context_rule_revisions_created_by_user_id_fkey",
  ALTER COLUMN "created_by_user_id" DROP NOT NULL,
  ADD CONSTRAINT "ai_context_rule_revisions_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_context_project_members" (
  "project_id" VARCHAR NOT NULL,
  "user_id" VARCHAR NOT NULL,
  "role" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_members_pkey"
    PRIMARY KEY ("project_id", "user_id"),
  CONSTRAINT "ai_context_project_members_role_check"
    CHECK ("role" IN ('owner', 'member'))
);

ALTER TABLE "ai_context_project_members"
  ADD CONSTRAINT "ai_context_project_members_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_context_project_members"
  ADD CONSTRAINT "ai_context_project_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ai_context_project_members_user_id_role_created_at_idx"
  ON "ai_context_project_members"("user_id", "role", "created_at");
CREATE INDEX "ai_context_project_members_project_id_role_idx"
  ON "ai_context_project_members"("project_id", "role");

INSERT INTO "ai_context_project_members" (
  "project_id",
  "user_id",
  "role",
  "created_at",
  "updated_at"
)
SELECT
  project."id",
  project."created_by_user_id",
  'owner',
  project."created_at",
  project."updated_at"
FROM "ai_context_projects" project
WHERE project."created_by_user_id" IS NOT NULL
ON CONFLICT ("project_id", "user_id") DO UPDATE
SET "role" = 'owner', "updated_at" = EXCLUDED."updated_at";

-- A deleted legacy creator leaves the project in place. Transfer those
-- projects to every active owner of their source workspace before removing
-- the workspace ownership column.
INSERT INTO "ai_context_project_members" (
  "project_id",
  "user_id",
  "role",
  "created_at",
  "updated_at"
)
SELECT
  project."id",
  member."user_id",
  'owner',
  project."created_at",
  project."updated_at"
FROM "ai_context_projects" project
JOIN "workspace_members" member
  ON member."workspace_id" = project."workspace_id"
 AND member."role" = 'owner'
 AND member."state" = 'active'
WHERE project."created_by_user_id" IS NULL
ON CONFLICT ("project_id", "user_id") DO UPDATE
SET "role" = 'owner', "updated_at" = EXCLUDED."updated_at";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    WHERE NOT EXISTS (
      SELECT 1
      FROM "ai_context_project_members" member
      WHERE member."project_id" = project."id"
        AND member."role" = 'owner'
    )
  ) THEN
    RAISE EXCEPTION
      'Cannot globalize AI context project without an active owner'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION "ai_context_assert_project_has_owner"("target_project_id" VARCHAR)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    WHERE project."id" = "target_project_id"
  ) AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_project_members" member
    WHERE member."project_id" = "target_project_id"
      AND member."role" = 'owner'
  ) THEN
    RAISE EXCEPTION
      'AI context project must retain at least one owner'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_context_projects_owner_required_check';
  END IF;
END;
$$;

CREATE FUNCTION "ai_context_project_insert_owner_required"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "ai_context_assert_project_has_owner"(NEW."id");
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_context_projects_owner_required_check"
AFTER INSERT
ON "ai_context_projects"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_project_insert_owner_required"();

CREATE FUNCTION "ai_context_project_member_owner_required"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "ai_context_assert_project_has_owner"(OLD."project_id");
  END IF;
  IF TG_OP <> 'DELETE' AND (
    TG_OP = 'INSERT' OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
  ) THEN
    PERFORM "ai_context_assert_project_has_owner"(NEW."project_id");
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_context_project_members_owner_required_check"
AFTER INSERT OR UPDATE OR DELETE
ON "ai_context_project_members"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_project_member_owner_required"();

CREATE FUNCTION "ai_context_transfer_project_state_before_user_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config(
    'localmind.ai_context_user_delete_actor',
    OLD."id",
    true
  );

  UPDATE "ai_context_memory_events" event
  SET
    "owner_user_id" = NULL,
    "source_session_id" = NULL
  WHERE event."owner_user_id" = OLD."id"
    AND EXISTS (
      SELECT 1
      FROM "ai_context_memories" memory
      WHERE memory."scope" = 'project'
        AND memory."id" IN (
          event."memory_id",
          event."previous_memory_id"
        )
    );

  UPDATE "ai_context_rule_revisions" revision
  SET "created_by_user_id" = NULL
  FROM "ai_context_rules" rule
  WHERE revision."created_by_user_id" = OLD."id"
    AND rule."id" = revision."rule_id"
    AND rule."scope" = 'project';

  IF EXISTS (
    SELECT 1
    FROM "ai_context_memories" memory
    WHERE memory."scope" = 'project'
      AND memory."owner_user_id" = OLD."id"
      AND NOT EXISTS (
        SELECT 1
        FROM "ai_context_project_members" member
        WHERE member."project_id" = memory."project_id"
          AND member."role" = 'owner'
          AND member."user_id" <> OLD."id"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "ai_context_rules" rule
    WHERE rule."scope" = 'project'
      AND rule."owner_user_id" = OLD."id"
      AND NOT EXISTS (
        SELECT 1
        FROM "ai_context_project_members" member
        WHERE member."project_id" = rule."project_id"
          AND member."role" = 'owner'
          AND member."user_id" <> OLD."id"
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot delete the last owner of an AI context project'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_context_projects_owner_required_check';
  END IF;

  UPDATE "ai_context_memories" memory
  SET "owner_user_id" = (
    SELECT member."user_id"
    FROM "ai_context_project_members" member
    WHERE member."project_id" = memory."project_id"
      AND member."role" = 'owner'
      AND member."user_id" <> OLD."id"
    ORDER BY member."created_at" ASC, member."user_id" ASC
    LIMIT 1
  )
  WHERE memory."scope" = 'project'
    AND memory."owner_user_id" = OLD."id";

  UPDATE "ai_context_rules" rule
  SET "owner_user_id" = (
    SELECT member."user_id"
    FROM "ai_context_project_members" member
    WHERE member."project_id" = rule."project_id"
      AND member."role" = 'owner'
      AND member."user_id" <> OLD."id"
    ORDER BY member."created_at" ASC, member."user_id" ASC
    LIMIT 1
  )
  WHERE rule."scope" = 'project'
    AND rule."owner_user_id" = OLD."id";

  PERFORM set_config(
    'localmind.ai_context_user_delete_actor',
    '',
    true
  );

  RETURN OLD;
END;
$$;

CREATE TRIGGER "ai_context_transfer_project_state_before_user_delete"
BEFORE DELETE
ON "users"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_transfer_project_state_before_user_delete"();

ALTER TABLE "ai_context_project_docs"
  ADD COLUMN "workspace_id" VARCHAR,
  ADD COLUMN "group_id" VARCHAR,
  ADD COLUMN "sort_order" INTEGER;

UPDATE "ai_context_project_docs" document
SET "workspace_id" = project."workspace_id"
FROM "ai_context_projects" project
WHERE project."id" = document."project_id";

WITH ranked AS (
  SELECT
    "project_id",
    "doc_id",
    row_number() OVER (
      PARTITION BY "project_id"
      ORDER BY "created_at" ASC, "doc_id" ASC
    ) - 1 AS "sort_order"
  FROM "ai_context_project_docs"
)
UPDATE "ai_context_project_docs" document
SET "sort_order" = ranked."sort_order"
FROM ranked
WHERE ranked."project_id" = document."project_id"
  AND ranked."doc_id" = document."doc_id";

ALTER TABLE "ai_context_project_docs"
  ALTER COLUMN "workspace_id" SET NOT NULL,
  ALTER COLUMN "sort_order" SET DEFAULT 0,
  ALTER COLUMN "sort_order" SET NOT NULL;

ALTER TABLE "ai_context_project_docs"
  DROP CONSTRAINT "ai_context_project_docs_pkey";
ALTER TABLE "ai_context_project_docs"
  ADD CONSTRAINT "ai_context_project_docs_pkey"
  PRIMARY KEY ("project_id", "workspace_id", "doc_id");

DROP INDEX "ai_context_project_docs_doc_id_project_id_idx";
CREATE INDEX "ai_context_project_docs_workspace_id_doc_id_project_id_idx"
  ON "ai_context_project_docs"("workspace_id", "doc_id", "project_id");
CREATE INDEX "ai_context_project_docs_project_id_group_id_sort_order_idx"
  ON "ai_context_project_docs"("project_id", "group_id", "sort_order");

ALTER TABLE "ai_context_project_docs"
  ADD CONSTRAINT "ai_context_project_docs_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing selections made by users other than the migrated owner are no
-- longer authorized under explicit membership and must fail closed.
UPDATE "ai_sessions_metadata" session
SET "selected_context_project_id" = NULL
WHERE session."selected_context_project_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_project_members" member
    WHERE member."project_id" = session."selected_context_project_id"
      AND member."user_id" = session."user_id"
  );

DROP TRIGGER IF EXISTS "ai_context_memories_project_workspace_guard"
  ON "ai_context_memories";
DROP TRIGGER IF EXISTS "ai_context_rules_project_workspace_guard"
  ON "ai_context_rules";
DROP TRIGGER IF EXISTS "ai_sessions_selected_context_project_workspace_guard"
  ON "ai_sessions_metadata";
DROP FUNCTION IF EXISTS "ai_context_assert_project_workspace"();
DROP FUNCTION IF EXISTS "ai_context_assert_selected_project_workspace"();

-- Project-scoped state follows the global project rather than whichever
-- workspace happened to host the creating session. Writer events retain that
-- host workspace as provenance. Disable the row-order-sensitive supersession
-- guard while normalizing complete legacy chains, then restore it.
ALTER TABLE "ai_context_memories"
  DROP CONSTRAINT "ai_context_memories_scope_shape_check";
ALTER TABLE "ai_context_rules"
  DROP CONSTRAINT "ai_context_rules_scope_check";
DROP TRIGGER "ai_context_memories_supersession_guard"
  ON "ai_context_memories";
DROP INDEX "ai_context_memories_private_active_identity_key";
DROP INDEX "ai_context_memories_private_active_fact_key";

UPDATE "ai_context_memories"
SET "workspace_id" = NULL
WHERE "scope" = 'project';

-- A legacy Project rule's docIds inherited its Project workspace implicitly.
-- Freeze that source workspace into each condition before Project.workspaceId
-- disappears so an equal doc id in another workspace cannot satisfy the rule.
UPDATE "ai_context_rules" rule
SET "conditions" =
  (rule."conditions" - 'docIds') ||
  jsonb_build_object(
    'documentRefs',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'workspaceId', project."workspace_id",
            'docId', document."doc_id"
          )
          ORDER BY document."first_ordinal"
        )
        FROM (
          SELECT
            btrim(value) AS "doc_id",
            min(ordinality) AS "first_ordinal"
          FROM jsonb_array_elements_text(rule."conditions"->'docIds')
            WITH ORDINALITY AS legacy(value, ordinality)
          WHERE btrim(value) <> ''
          GROUP BY btrim(value)
        ) document
      ),
      '[]'::jsonb
    )
  )
FROM "ai_context_projects" project
WHERE rule."scope" = 'project'
  AND rule."project_id" = project."id"
  AND jsonb_typeof(rule."conditions"->'docIds') = 'array';

UPDATE "ai_context_rules"
SET "workspace_id" = NULL
WHERE "scope" = 'project';

-- Legacy workspace-scoped projects could accumulate equivalent active rows
-- under different users. A global Project is the principal now, so retain all
-- evidence while selecting one deterministic active row per Project identity.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "project_id", "kind", "fact_key"
      ORDER BY "updated_at" DESC, "id" DESC
    ) AS duplicate_rank
  FROM "ai_context_memories"
  WHERE "scope" = 'project'
    AND "visibility" = 'private'
    AND "status" = 'active'
    AND "kind" = 'auto_memory'
    AND "fact_key" IS NOT NULL
)
UPDATE "ai_context_memories" memory
SET
  "status" = 'superseded',
  "valid_until" = CASE
    WHEN memory."valid_from" IS NULL THEN memory."updated_at"
    ELSE GREATEST(
      memory."updated_at",
      memory."valid_from" + INTERVAL '1 millisecond'
    )
  END
FROM ranked
WHERE memory."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "project_id", "kind", "fingerprint"
      ORDER BY "updated_at" DESC, "id" DESC
    ) AS duplicate_rank
  FROM "ai_context_memories"
  WHERE "scope" = 'project'
    AND "visibility" = 'private'
    AND "status" = 'active'
)
UPDATE "ai_context_memories" memory
SET
  "status" = 'superseded',
  "valid_until" = CASE
    WHEN memory."valid_from" IS NULL THEN memory."updated_at"
    ELSE GREATEST(
      memory."updated_at",
      memory."valid_from" + INTERVAL '1 millisecond'
    )
  END
FROM ranked
WHERE memory."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_scope_shape_check"
  CHECK (
    (
      "scope" = 'user'
      AND "workspace_id" IS NULL
      AND "doc_id" IS NULL
      AND "project_id" IS NULL
    ) OR (
      "scope" = 'workspace'
      AND "workspace_id" IS NOT NULL
      AND "doc_id" IS NULL
      AND "project_id" IS NULL
    ) OR (
      "scope" = 'document'
      AND "workspace_id" IS NOT NULL
      AND "doc_id" IS NOT NULL
      AND "project_id" IS NULL
    ) OR (
      "scope" = 'project'
      AND "workspace_id" IS NULL
      AND "doc_id" IS NULL
      AND "project_id" IS NOT NULL
    )
  );

ALTER TABLE "ai_context_rules"
  ADD CONSTRAINT "ai_context_rules_scope_check"
  CHECK (
    ("scope" = 'user' AND "workspace_id" IS NULL AND "project_id" IS NULL) OR
    ("scope" = 'workspace' AND "workspace_id" IS NOT NULL AND "project_id" IS NULL) OR
    ("scope" = 'project' AND "workspace_id" IS NULL AND "project_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "ai_context_memories_private_active_identity_key"
  ON "ai_context_memories"(
    "owner_user_id",
    COALESCE("workspace_id", ''),
    COALESCE("doc_id", ''),
    COALESCE("project_id", ''),
    "kind",
    "fingerprint"
  )
  WHERE
    "scope" <> 'project' AND
    "visibility" = 'private' AND
    "status" = 'active';

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
    "scope" <> 'project' AND
    "visibility" = 'private' AND
    "status" = 'active' AND
    "kind" = 'auto_memory' AND
    "fact_key" IS NOT NULL;

CREATE UNIQUE INDEX "ai_context_memories_project_active_identity_key"
  ON "ai_context_memories"("project_id", "kind", "fingerprint")
  WHERE
    "scope" = 'project' AND
    "visibility" = 'private' AND
    "status" = 'active';

CREATE UNIQUE INDEX "ai_context_memories_project_active_fact_key"
  ON "ai_context_memories"("project_id", "kind", "fact_key")
  WHERE
    "scope" = 'project' AND
    "visibility" = 'private' AND
    "status" = 'active' AND
    "kind" = 'auto_memory' AND
    "fact_key" IS NOT NULL;

CREATE OR REPLACE FUNCTION "ai_context_assert_memory_supersession"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."supersedes_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_memories" previous
    WHERE previous."id" = NEW."supersedes_id"
      AND previous."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND previous."doc_id" IS NOT DISTINCT FROM NEW."doc_id"
      AND previous."project_id" IS NOT DISTINCT FROM NEW."project_id"
      AND previous."scope" = NEW."scope"
      AND previous."kind" = NEW."kind"
      AND previous."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
      AND (
        NEW."scope" = 'project'
        OR previous."owner_user_id" = NEW."owner_user_id"
      )
  ) THEN
    RAISE EXCEPTION 'Superseded context memory must share its principal, scope, and fact key'
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

CREATE OR REPLACE FUNCTION "ai_context_assert_memory_event_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."owner_user_id" IS NULL THEN
    IF TG_OP = 'UPDATE'
      AND OLD."owner_user_id" IS NOT NULL
      AND COALESCE(
        current_setting(
          'localmind.ai_context_user_delete_actor',
          true
        ),
        ''
      ) = OLD."owner_user_id"
      AND NEW."source_session_id" IS NULL
      AND NEW."id" = OLD."id"
      AND NEW."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
      AND NEW."source_turn_id" IS NOT DISTINCT FROM OLD."source_turn_id"
      AND NEW."operation" = OLD."operation"
      AND NEW."memory_id" IS NOT DISTINCT FROM OLD."memory_id"
      AND NEW."previous_memory_id" IS NOT DISTINCT FROM OLD."previous_memory_id"
      AND NEW."target_event_id" IS NOT DISTINCT FROM OLD."target_event_id"
      AND NEW."fact_key" IS NOT DISTINCT FROM OLD."fact_key"
      AND NEW."explicit" = OLD."explicit"
      AND NEW."reason_code" = OLD."reason_code"
      AND NEW."writer_version" = OLD."writer_version"
      AND NEW."decision_fingerprint" = OLD."decision_fingerprint"
      AND NEW."undone_at" IS NOT DISTINCT FROM OLD."undone_at"
      AND NEW."created_at" = OLD."created_at"
      AND EXISTS (
        SELECT 1
        FROM "ai_context_memories" memory
        WHERE memory."scope" = 'project'
          AND memory."id" IN (
            NEW."memory_id",
            NEW."previous_memory_id"
          )
      )
    THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
      AND pg_trigger_depth() > 1
      AND OLD."owner_user_id" IS NULL
      AND OLD."source_session_id" IS NOT NULL
      AND NEW."source_session_id" IS NULL
      AND NEW."id" = OLD."id"
      AND NEW."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
      AND NEW."source_turn_id" IS NOT DISTINCT FROM OLD."source_turn_id"
      AND NEW."operation" = OLD."operation"
      AND NEW."memory_id" IS NOT DISTINCT FROM OLD."memory_id"
      AND NEW."previous_memory_id" IS NOT DISTINCT FROM OLD."previous_memory_id"
      AND NEW."target_event_id" IS NOT DISTINCT FROM OLD."target_event_id"
      AND NEW."fact_key" IS NOT DISTINCT FROM OLD."fact_key"
      AND NEW."explicit" = OLD."explicit"
      AND NEW."reason_code" = OLD."reason_code"
      AND NEW."writer_version" = OLD."writer_version"
      AND NEW."decision_fingerprint" = OLD."decision_fingerprint"
      AND NEW."undone_at" IS NOT DISTINCT FROM OLD."undone_at"
      AND NEW."created_at" = OLD."created_at"
      AND EXISTS (
        SELECT 1
        FROM "ai_context_memories" memory
        WHERE memory."scope" = 'project'
          AND memory."id" IN (
            NEW."memory_id",
            NEW."previous_memory_id"
          )
      )
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Context memory event actor is required'
      USING ERRCODE = '23514';
  END IF;

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
      AND (
        (
          memory."scope" = 'project'
          AND EXISTS (
            SELECT 1
            FROM "ai_context_projects" project
            JOIN "ai_context_project_members" member
              ON member."project_id" = project."id"
            WHERE project."id" = memory."project_id"
              AND project."status" = 'active'
              AND member."user_id" = NEW."owner_user_id"
          )
        ) OR (
          memory."scope" <> 'project'
          AND memory."owner_user_id" = NEW."owner_user_id"
          AND memory."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
        )
      )
      AND memory."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
  ) THEN
    RAISE EXCEPTION 'Context memory event target does not match its owner, scope, and fact key'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."previous_memory_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_memories" memory
    WHERE memory."id" = NEW."previous_memory_id"
      AND (
        (
          memory."scope" = 'project'
          AND EXISTS (
            SELECT 1
            FROM "ai_context_projects" project
            JOIN "ai_context_project_members" member
              ON member."project_id" = project."id"
            WHERE project."id" = memory."project_id"
              AND project."status" = 'active'
              AND member."user_id" = NEW."owner_user_id"
          )
        ) OR (
          memory."scope" <> 'project'
          AND memory."owner_user_id" = NEW."owner_user_id"
          AND memory."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
        )
      )
      AND memory."fact_key" IS NOT DISTINCT FROM NEW."fact_key"
  ) THEN
    RAISE EXCEPTION 'Previous context memory event target does not match its owner, scope, and fact key'
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

DROP TRIGGER "ai_context_memory_events_snapshot_guard"
  ON "ai_context_memory_events";
CREATE TRIGGER "ai_context_memory_events_snapshot_guard"
BEFORE INSERT OR UPDATE OF
  "owner_user_id",
  "workspace_id",
  "source_session_id",
  "source_turn_id",
  "operation",
  "memory_id",
  "previous_memory_id",
  "target_event_id",
  "fact_key",
  "explicit",
  "reason_code",
  "writer_version",
  "decision_fingerprint",
  "undone_at",
  "created_at"
ON "ai_context_memory_events"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_memory_event_snapshot"();

CREATE FUNCTION "ai_context_assert_rule_revision_actor"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."created_by_user_id" IS NULL THEN
    IF TG_OP = 'UPDATE'
      AND OLD."created_by_user_id" IS NOT NULL
      AND COALESCE(
        current_setting(
          'localmind.ai_context_user_delete_actor',
          true
        ),
        ''
      ) = OLD."created_by_user_id"
      AND EXISTS (
        SELECT 1
        FROM "ai_context_rules" rule
        WHERE rule."id" = NEW."rule_id"
          AND rule."scope" = 'project'
      )
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Context rule revision actor is required'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_rule_revisions_actor_guard"
BEFORE INSERT OR UPDATE OF "rule_id", "created_by_user_id"
ON "ai_context_rule_revisions"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_rule_revision_actor"();

CREATE OR REPLACE FUNCTION "ai_context_assert_rule_hit_snapshot"()
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
      AND (
        (
          rule."scope" = 'user'
          AND session."user_id" = rule."owner_user_id"
          AND rule."workspace_id" IS NULL
          AND rule."project_id" IS NULL
        ) OR (
          rule."scope" = 'workspace'
          AND session."user_id" = rule."owner_user_id"
          AND rule."workspace_id" = session."workspace_id"
          AND rule."project_id" IS NULL
        ) OR (
          rule."scope" = 'project'
          AND rule."workspace_id" IS NULL
          AND rule."project_id" = session."selected_context_project_id"
          AND EXISTS (
            SELECT 1
            FROM "ai_context_projects" project
            JOIN "ai_context_project_members" member
              ON member."project_id" = project."id"
            WHERE project."id" = rule."project_id"
              AND project."status" = 'active'
              AND member."user_id" = session."user_id"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Context rule hit does not match its revision and session scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "ai_context_assert_project_member_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."project_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    JOIN "ai_context_project_members" member
      ON member."project_id" = project."id"
    WHERE project."id" = NEW."project_id"
      AND project."status" = 'active'
      AND member."user_id" = NEW."owner_user_id"
  ) THEN
    RAISE EXCEPTION 'Project-scoped AI context requires active project membership'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_memories_project_member_guard"
BEFORE INSERT OR UPDATE OF "owner_user_id", "project_id"
ON "ai_context_memories"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_project_member_scope"();

CREATE FUNCTION "ai_context_assert_project_owner_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."project_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    JOIN "ai_context_project_members" member
      ON member."project_id" = project."id"
    WHERE project."id" = NEW."project_id"
      AND project."status" = 'active'
      AND member."user_id" = NEW."owner_user_id"
      AND member."role" = 'owner'
  ) THEN
    RAISE EXCEPTION 'Project-scoped AI context rule requires active project ownership'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_context_rules_project_owner_guard"
BEFORE INSERT OR UPDATE OF "owner_user_id", "project_id"
ON "ai_context_rules"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_project_owner_scope"();

CREATE FUNCTION "ai_context_assert_selected_project_member"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."selected_context_project_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_context_projects" project
    JOIN "ai_context_project_members" member
      ON member."project_id" = project."id"
    WHERE project."id" = NEW."selected_context_project_id"
      AND project."status" = 'active'
      AND member."user_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'Selected context project requires active project membership'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_sessions_selected_context_project_member_guard"
BEFORE INSERT OR UPDATE OF "user_id", "selected_context_project_id"
ON "ai_sessions_metadata"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_assert_selected_project_member"();

DROP INDEX "ai_context_projects_workspace_id_status_updated_at_idx";
ALTER TABLE "ai_context_projects"
  DROP CONSTRAINT "ai_context_projects_workspace_id_fkey";
ALTER TABLE "ai_context_projects"
  DROP COLUMN "workspace_id";
CREATE INDEX "ai_context_projects_status_updated_at_idx"
  ON "ai_context_projects"("status", "updated_at");

ALTER TABLE "ai_agent_runs"
  ADD COLUMN "session_id" VARCHAR;

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_agent_runs_actor_id_status_updated_at_idx"
  ON "ai_agent_runs"("actor_id", "status", "updated_at");
CREATE INDEX "ai_agent_runs_actor_id_status_completed_at_idx"
  ON "ai_agent_runs"("actor_id", "status", "completed_at");
CREATE INDEX "ai_agent_runs_session_id_idx"
  ON "ai_agent_runs"("session_id");

CREATE FUNCTION "ai_agent_run_assert_session_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."session_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "ai_sessions_metadata" session
    WHERE session."id" = NEW."session_id"
      AND session."user_id" = NEW."actor_id"
      AND session."workspace_id" = NEW."workspace_id"
  ) THEN
    RAISE EXCEPTION 'Agent run session must match its actor and workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_agent_runs_session_scope_guard"
BEFORE INSERT OR UPDATE OF "session_id", "actor_id", "workspace_id"
ON "ai_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION "ai_agent_run_assert_session_scope"();

-- A failed standalone run may be explicitly abandoned. Preserve the failure
-- evidence while changing only the control state; the deferred timeline guard
-- still requires the matching abandon event in the same transaction.
CREATE OR REPLACE FUNCTION ai_agent_runtime_manual_control_payload_valid(
  value jsonb,
  payload_scope text,
  expected_action text,
  expected_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    payload_scope IN ('step_summary', 'timeline')
    AND (
      expected_action IN ('cancel', 'cancel_requested', 'resume')
      OR (
        payload_scope = 'timeline'
        AND expected_action = 'abandon'
      )
    )
    AND (
      expected_status IS NULL
      OR expected_status IN (
        'queued',
        'running',
        'cancelled',
        'pending',
        'skipped',
        'completed'
      )
    )
    AND jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'agent-runtime-manual-control/v1'
    AND jsonb_typeof(value->'action') = 'string'
    AND btrim(value->>'action') = expected_action
    AND jsonb_typeof(value->'actorId') = 'string'
    AND length(btrim(value->>'actorId')) BETWEEN 1 AND 512
    AND (
      NOT (value ? 'reason')
      OR value->'reason' = 'null'::jsonb
      OR (
        jsonb_typeof(value->'reason') = 'string'
        AND length(btrim(value->>'reason')) BETWEEN 1 AND 1024
      )
    )
    AND (
      payload_scope <> 'timeline'
      OR (
        expected_status IS NOT NULL
        AND jsonb_typeof(value->'previousStatus') = 'string'
        AND btrim(value->>'previousStatus') IN (
          'queued',
          'running',
          'waiting_approval',
          'completed',
          'failed',
          'cancelled',
          'pending',
          'skipped'
        )
        AND jsonb_typeof(value->'workflow') = 'string'
        AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceType') = 'string'
        AND length(btrim(value->>'sourceType')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceId') = 'string'
        AND length(btrim(value->>'sourceId')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'controlledAt') = 'string'
        AND length(btrim(value->>'controlledAt')) BETWEEN 1 AND 128
        AND (
          (
            expected_action = 'cancel'
            AND expected_status IN ('cancelled', 'skipped')
          )
          OR (
            expected_action = 'cancel_requested'
            AND expected_status = 'running'
            AND btrim(value->>'previousStatus') = 'running'
            AND jsonb_typeof(value->'workerAttempt') = 'number'
            AND (value->>'workerAttempt') ~ '^[0-9]+$'
            AND (value->>'workerAttempt')::numeric > 0
            AND (value->>'workerAttempt')::numeric <= 1000000
            AND jsonb_typeof(value->'workerLeaseId') = 'string'
            AND length(btrim(value->>'workerLeaseId')) BETWEEN 1 AND 512
            AND jsonb_typeof(value->'workerLeaseExpiresAt') = 'string'
            AND length(btrim(value->>'workerLeaseExpiresAt')) BETWEEN 1 AND 128
          )
          OR (
            expected_action = 'resume'
            AND expected_status IN ('queued', 'pending', 'completed')
          )
          OR (
            expected_action = 'abandon'
            AND expected_status = 'cancelled'
            AND btrim(value->>'previousStatus') = 'failed'
          )
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_agent_timeline_events"
  DROP CONSTRAINT "ai_agent_timeline_manual_control_payload_check";

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_manual_control_payload_check"
  CHECK (
    "payload"->>'version' <> 'agent-runtime-manual-control/v1'
    OR ai_agent_runtime_manual_control_payload_valid(
      "payload",
      'timeline',
      CASE
        WHEN "event_type" = 'run_status'
          AND "payload"->>'action' = 'abandon'
          THEN 'abandon'
        WHEN "event_type" = 'run_cancellation'
          AND "payload"->>'action' = 'cancel_requested'
          THEN 'cancel_requested'
        WHEN "event_type" = 'run_cancellation' THEN 'cancel'
        WHEN "event_type" = 'run_status' THEN 'resume'
        ELSE "payload"->>'action'
      END,
      "status"
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION ai_agent_runtime_run_execution_result_terminal_valid()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'failed'
     AND OLD."source_type" <> 'repair_execution_request'
     AND NEW."status" = 'cancelled'
     AND NEW."completed_at" IS NOT NULL
     AND NEW."failure_code" IS NOT DISTINCT FROM OLD."failure_code"
     AND NEW."failure_message" IS NOT DISTINCT FROM OLD."failure_message"
     AND NEW."queued_at" IS NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" = OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at"
     AND EXISTS (
       SELECT 1
       FROM "ai_agent_runtime_execution_results" result
       WHERE result."run_id" = OLD."id"
         AND result."workspace_id" = OLD."workspace_id"
         AND result."actor_id" = OLD."actor_id"
         AND result."workflow" = OLD."workflow"
         AND result."source_type" = OLD."source_type"
         AND result."source_id" = OLD."source_id"
         AND result."source_type" <> 'repair_execution_request'
         AND result."worker_attempt" = OLD."worker_attempt"
         AND result."result_status" = 'failed'
         AND result."completed_at" = OLD."completed_at"
         AND result."failure_code" IS NOT DISTINCT FROM OLD."failure_code"
         AND result."failure_message" IS NOT DISTINCT FROM
           OLD."failure_message"
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'queued'
     AND OLD."status" IN ('failed', 'cancelled')
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."completed_at" IS NULL
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('completed', 'failed')
     AND EXISTS (
       SELECT 1
       FROM "ai_agent_runtime_execution_results" result
       WHERE result."run_id" = OLD."id"
         AND result."workspace_id" = OLD."workspace_id"
         AND result."worker_attempt" = OLD."worker_attempt"
     )
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_agent_runtime_execution_results" result
       WHERE result."run_id" = NEW."id"
         AND result."workspace_id" = NEW."workspace_id"
         AND result."actor_id" = NEW."actor_id"
         AND result."workflow" = NEW."workflow"
         AND result."source_type" = NEW."source_type"
         AND result."source_id" = NEW."source_id"
         AND result."source_type" <> 'repair_execution_request'
         AND result."worker_attempt" = NEW."worker_attempt"
         AND result."result_status" = NEW."status"
         AND result."completed_at" = NEW."completed_at"
         AND (
           (
             result."result_status" = 'completed'
             AND NEW."failure_code" IS NULL
             AND NEW."failure_message" IS NULL
             AND result."failure_code" IS NULL
             AND result."failure_message" IS NULL
           )
           OR (
             result."result_status" = 'failed'
             AND NEW."failure_code" = result."failure_code"
             AND NEW."failure_message" = result."failure_message"
           )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_agent_runs_execution_result_terminal_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_runs_execution_result_terminal_snapshot_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_agent_runtime_execution_results" result
    WHERE result."run_id" = NEW."id"
      AND result."workspace_id" = NEW."workspace_id"
      AND result."worker_attempt" = NEW."worker_attempt"
  )
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_agent_runtime_execution_results" result
       WHERE result."run_id" = NEW."id"
         AND result."workspace_id" = NEW."workspace_id"
         AND result."actor_id" = NEW."actor_id"
         AND result."workflow" = NEW."workflow"
         AND result."source_type" = NEW."source_type"
         AND result."source_id" = NEW."source_id"
         AND result."source_type" <> 'repair_execution_request'
         AND result."worker_attempt" = NEW."worker_attempt"
         AND result."result_status" = NEW."status"
         AND result."completed_at" = NEW."completed_at"
         AND (
           (
             result."result_status" = 'completed'
             AND NEW."failure_code" IS NULL
             AND NEW."failure_message" IS NULL
             AND result."failure_code" IS NULL
             AND result."failure_message" IS NULL
           )
           OR (
             result."result_status" = 'failed'
             AND NEW."failure_code" = result."failure_code"
             AND NEW."failure_message" = result."failure_message"
           )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_agent_runs_execution_result_terminal_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_runs_execution_result_terminal_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION ai_agent_run_abandon_timeline_required()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IS DISTINCT FROM 'failed'
     OR NEW."status" IS DISTINCT FROM 'cancelled'
     OR OLD."source_type" = 'repair_execution_request' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_agent_timeline_events" event
    WHERE event."run_id" = NEW."id"
      AND event."step_id" IS NULL
      AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
      AND event."event_type" = 'run_status'
      AND event."status" = 'cancelled'
      AND event."created_at" IS NOT DISTINCT FROM NEW."updated_at"
      AND event."created_at" >= OLD."updated_at"
      AND event."payload"->>'version' =
        'agent-runtime-manual-control/v1'
      AND event."payload"->>'action' = 'abandon'
      AND event."payload"->>'actorId' IS NOT DISTINCT FROM NEW."actor_id"
      AND event."payload"->>'previousStatus' = 'failed'
      AND event."payload"->>'workflow' IS NOT DISTINCT FROM NEW."workflow"
      AND event."payload"->>'sourceType' IS NOT DISTINCT FROM
        NEW."source_type"
      AND event."payload"->>'sourceId' IS NOT DISTINCT FROM NEW."source_id"
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_runs_abandon_timeline_required_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_agent_runs_abandon_timeline_required_check';
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_agent_runs_abandon_timeline_required_check"
AFTER UPDATE OF "status", "updated_at"
ON "ai_agent_runs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_agent_run_abandon_timeline_required();

CREATE OR REPLACE FUNCTION ai_agent_run_terminal_result_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('completed', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."timeline_fingerprint" IS NOT DISTINCT FROM
       NEW."timeline_fingerprint"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."queued_at" IS NOT DISTINCT FROM NEW."queued_at"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."worker_lease_expires_at" IS NOT DISTINCT FROM
       NEW."worker_lease_expires_at"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."worker_max_attempts" IS NOT DISTINCT FROM
       NEW."worker_max_attempts"
     AND OLD."last_attempt_at" IS NOT DISTINCT FROM NEW."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'queued'
     AND (
       OLD."status" = 'failed'
       OR (
         OLD."status" = 'cancelled'
         AND OLD."source_type" <> 'repair_execution_request'
       )
     )
     AND NEW."completed_at" IS NULL
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."queued_at" IS NOT NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" >= OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'failed'
     AND OLD."source_type" = 'repair_execution_request'
     AND NEW."status" = 'cancelled'
     AND NEW."completed_at" IS NOT NULL
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" = OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'failed'
     AND OLD."source_type" <> 'repair_execution_request'
     AND NEW."status" = 'cancelled'
     AND NEW."completed_at" IS NOT NULL
     AND NEW."failure_code" IS NOT DISTINCT FROM OLD."failure_code"
     AND NEW."failure_message" IS NOT DISTINCT FROM OLD."failure_message"
     AND NEW."queued_at" IS NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" = OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_runs_terminal_result_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_agent_runs_terminal_result_update_restrict_check';
END;
$$ LANGUAGE plpgsql;
