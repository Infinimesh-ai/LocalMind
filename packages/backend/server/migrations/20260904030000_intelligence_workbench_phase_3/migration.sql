CREATE TABLE "ai_context_project_blockers" (
  "id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "creator_user_id" VARCHAR,
  "creator_user_id_snapshot" VARCHAR NOT NULL,
  "title" VARCHAR NOT NULL,
  "type" VARCHAR NOT NULL,
  "waiting_on" VARCHAR NOT NULL,
  "due_at" TIMESTAMPTZ(3),
  "status" VARCHAR NOT NULL DEFAULT 'waiting',
  "origin" VARCHAR NOT NULL,
  "ai_suggestion_id" VARCHAR,
  "resolution_actor_user_id" VARCHAR,
  "resolution_actor_user_id_snapshot" VARCHAR,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_blockers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_project_blockers_type_check"
    CHECK ("type" IN ('wait_reply', 'wait_file', 'wait_decision', 'custom')),
  CONSTRAINT "ai_context_project_blockers_status_check"
    CHECK ("status" IN ('waiting', 'resolved', 'abandoned')),
  CONSTRAINT "ai_context_project_blockers_origin_check"
    CHECK ("origin" IN ('user_created', 'ai_suggested')),
  CONSTRAINT "ai_context_project_blockers_origin_shape_check" CHECK (
    ("origin" = 'user_created' AND "ai_suggestion_id" IS NULL) OR
    ("origin" = 'ai_suggested' AND "ai_suggestion_id" IS NOT NULL)
  ),
  CONSTRAINT "ai_context_project_blockers_identity_check" CHECK (
    length(btrim("creator_user_id_snapshot")) BETWEEN 1 AND 512 AND
    length(btrim("title")) BETWEEN 1 AND 512 AND
    length(btrim("waiting_on")) BETWEEN 1 AND 512 AND
    (
      "resolution_actor_user_id_snapshot" IS NULL OR
      length(btrim("resolution_actor_user_id_snapshot")) BETWEEN 1 AND 512
    ) AND
    (
      "ai_suggestion_id" IS NULL OR
      (
        "ai_suggestion_id" = lower("ai_suggestion_id") AND
        "ai_suggestion_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    )
  ),
  CONSTRAINT "ai_context_project_blockers_lifecycle_check" CHECK (
    (
      "status" = 'waiting' AND
      "resolution_actor_user_id" IS NULL AND
      "resolution_actor_user_id_snapshot" IS NULL AND
      "resolved_at" IS NULL
    ) OR (
      "status" IN ('resolved', 'abandoned') AND
      "resolution_actor_user_id_snapshot" IS NOT NULL AND
      "resolved_at" IS NOT NULL AND
      "resolved_at" >= "created_at"
    )
  )
);

ALTER TABLE "ai_context_project_blockers"
  ADD CONSTRAINT "ai_context_project_blockers_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_blockers_creator_user_id_fkey"
  FOREIGN KEY ("creator_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_blockers_resolution_actor_user_id_fkey"
  FOREIGN KEY ("resolution_actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_context_project_blockers_project_id_status_due_at_updat_idx"
  ON "ai_context_project_blockers"("project_id", "status", "due_at", "updated_at");
CREATE INDEX "ai_context_project_blockers_project_id_status_resolved_at_idx"
  ON "ai_context_project_blockers"("project_id", "status", "resolved_at");
CREATE INDEX "ai_context_project_blockers_creator_user_id_created_at_idx"
  ON "ai_context_project_blockers"("creator_user_id", "created_at");
CREATE INDEX "ai_context_project_blockers_resolution_actor_user_id_resolv_idx"
  ON "ai_context_project_blockers"("resolution_actor_user_id", "resolved_at");
CREATE UNIQUE INDEX "ai_context_project_blockers_project_id_ai_suggestion_id_key"
  ON "ai_context_project_blockers"("project_id", "ai_suggestion_id");
