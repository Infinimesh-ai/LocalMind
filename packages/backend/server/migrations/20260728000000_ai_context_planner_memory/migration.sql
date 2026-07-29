CREATE TABLE "ai_context_memories" (
    "id" VARCHAR NOT NULL,
    "owner_user_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR,
    "doc_id" VARCHAR,
    "source_session_id" VARCHAR,
    "scope" VARCHAR NOT NULL,
    "kind" VARCHAR NOT NULL,
    "visibility" VARCHAR NOT NULL DEFAULT 'private',
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "content" TEXT NOT NULL,
    "fingerprint" VARCHAR NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_context_memories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_memories_scope_check"
      CHECK ("scope" IN ('user', 'workspace', 'project')),
    CONSTRAINT "ai_context_memories_kind_check"
      CHECK ("kind" IN ('rule', 'auto_memory', 'project_summary')),
    CONSTRAINT "ai_context_memories_visibility_check"
      CHECK ("visibility" IN ('private', 'workspace')),
    CONSTRAINT "ai_context_memories_status_check"
      CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "ai_context_memories_scope_shape_check"
      CHECK (
        ("scope" = 'user' AND "doc_id" IS NULL) OR
        ("scope" = 'workspace' AND "workspace_id" IS NOT NULL AND "doc_id" IS NULL) OR
        ("scope" = 'project' AND "workspace_id" IS NOT NULL AND "doc_id" IS NOT NULL)
      ),
    CONSTRAINT "ai_context_memories_visibility_shape_check"
      CHECK ("visibility" = 'private' OR "workspace_id" IS NOT NULL),
    CONSTRAINT "ai_context_memories_content_check"
      CHECK (length(btrim("content")) > 0)
);

CREATE TABLE "ai_context_checkpoints" (
    "id" VARCHAR NOT NULL,
    "session_id" VARCHAR NOT NULL,
    "strategy_version" VARCHAR NOT NULL,
    "strategy_fingerprint" VARCHAR NOT NULL,
    "summary" TEXT NOT NULL,
    "summarized_message_count" INTEGER NOT NULL DEFAULT 0,
    "source_fingerprint" VARCHAR NOT NULL,
    "diagnostics" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_context_checkpoints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_checkpoints_message_count_check"
      CHECK ("summarized_message_count" >= 0)
);

CREATE INDEX "ai_context_memories_owner_user_id_status_updated_at_idx"
  ON "ai_context_memories"("owner_user_id", "status", "updated_at");
CREATE INDEX "ai_context_memories_workspace_id_doc_id_status_updated_at_idx"
  ON "ai_context_memories"("workspace_id", "doc_id", "status", "updated_at");
CREATE INDEX "ai_context_memories_source_session_id_idx"
  ON "ai_context_memories"("source_session_id");
CREATE INDEX "ai_context_memories_fingerprint_idx"
  ON "ai_context_memories"("fingerprint");
CREATE UNIQUE INDEX "ai_context_memories_private_identity_key"
  ON "ai_context_memories"(
    "owner_user_id",
    COALESCE("workspace_id", ''),
    COALESCE("doc_id", ''),
    "kind",
    "fingerprint"
  )
  WHERE "visibility" = 'private';
CREATE UNIQUE INDEX "ai_context_memories_workspace_identity_key"
  ON "ai_context_memories"(
    "workspace_id",
    COALESCE("doc_id", ''),
    "kind",
    "fingerprint"
  )
  WHERE "visibility" = 'workspace';

CREATE UNIQUE INDEX "ai_context_checkpoints_session_id_strategy_version_key"
  ON "ai_context_checkpoints"("session_id", "strategy_version");
CREATE INDEX "ai_context_checkpoints_strategy_version_updated_at_idx"
  ON "ai_context_checkpoints"("strategy_version", "updated_at");

ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_source_session_id_fkey"
  FOREIGN KEY ("source_session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_context_checkpoints"
  ADD CONSTRAINT "ai_context_checkpoints_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
