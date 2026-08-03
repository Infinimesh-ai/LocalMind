CREATE TABLE "ai_context_projects" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "created_by_user_id" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_context_projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_projects_name_check"
      CHECK (length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "ai_context_projects_description_check"
      CHECK (length("description") <= 2000),
    CONSTRAINT "ai_context_projects_status_check"
      CHECK ("status" IN ('active', 'archived'))
);

CREATE TABLE "ai_context_project_docs" (
    "project_id" VARCHAR NOT NULL,
    "doc_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_context_project_docs_pkey" PRIMARY KEY ("project_id", "doc_id")
);

CREATE INDEX "ai_context_projects_workspace_id_status_updated_at_idx"
  ON "ai_context_projects"("workspace_id", "status", "updated_at");
CREATE INDEX "ai_context_project_docs_doc_id_project_id_idx"
  ON "ai_context_project_docs"("doc_id", "project_id");

ALTER TABLE "ai_context_projects"
  ADD CONSTRAINT "ai_context_projects_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_context_projects"
  ADD CONSTRAINT "ai_context_projects_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_context_project_docs"
  ADD CONSTRAINT "ai_context_project_docs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_context_memories"
  ADD COLUMN "project_id" VARCHAR;

UPDATE "ai_context_memories"
SET "visibility" = 'private'
WHERE "visibility" <> 'private';

UPDATE "ai_context_memories"
SET "workspace_id" = NULL
WHERE "scope" = 'user';

ALTER TABLE "ai_context_memories"
  DROP CONSTRAINT "ai_context_memories_scope_check",
  DROP CONSTRAINT "ai_context_memories_scope_shape_check",
  DROP CONSTRAINT "ai_context_memories_visibility_check";

UPDATE "ai_context_memories"
SET "scope" = 'document'
WHERE "scope" = 'project'
  AND "doc_id" IS NOT NULL;

ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_scope_check"
    CHECK ("scope" IN ('user', 'workspace', 'document', 'project')),
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
        AND "workspace_id" IS NOT NULL
        AND "doc_id" IS NULL
        AND "project_id" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "ai_context_memories_visibility_check"
    CHECK ("visibility" = 'private');

DROP INDEX "ai_context_memories_private_identity_key";
DROP INDEX "ai_context_memories_workspace_identity_key";

WITH "ranked_memories" AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY
        "owner_user_id",
        COALESCE("workspace_id", ''),
        COALESCE("doc_id", ''),
        COALESCE("project_id", ''),
        "kind",
        "fingerprint"
      ORDER BY "updated_at" DESC, "id" DESC
    ) AS "duplicate_rank"
  FROM "ai_context_memories"
)
DELETE FROM "ai_context_memories"
USING "ranked_memories"
WHERE "ai_context_memories"."id" = "ranked_memories"."id"
  AND "ranked_memories"."duplicate_rank" > 1;

CREATE UNIQUE INDEX "ai_context_memories_private_identity_key"
  ON "ai_context_memories"(
    "owner_user_id",
    COALESCE("workspace_id", ''),
    COALESCE("doc_id", ''),
    COALESCE("project_id", ''),
    "kind",
    "fingerprint"
  );

CREATE INDEX "ai_context_memories_project_id_status_updated_at_idx"
  ON "ai_context_memories"("project_id", "status", "updated_at");

ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
