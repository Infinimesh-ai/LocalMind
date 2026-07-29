CREATE TABLE "ai_context_preferences" (
    "id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "auto_memory_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_context_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_context_strategy_revisions" (
    "id" VARCHAR NOT NULL,
    "version" VARCHAR NOT NULL,
    "fingerprint" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_context_strategy_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_context_strategy_revisions_status_check"
      CHECK ("status" IN ('active', 'archived'))
);

CREATE UNIQUE INDEX "ai_context_preferences_user_id_workspace_id_key"
  ON "ai_context_preferences"("user_id", "workspace_id");
CREATE INDEX "ai_context_preferences_workspace_id_updated_at_idx"
  ON "ai_context_preferences"("workspace_id", "updated_at");
CREATE UNIQUE INDEX "ai_context_strategy_revisions_version_key"
  ON "ai_context_strategy_revisions"("version");
CREATE INDEX "ai_context_strategy_revisions_status_created_at_idx"
  ON "ai_context_strategy_revisions"("status", "created_at");

ALTER TABLE "ai_context_preferences"
  ADD CONSTRAINT "ai_context_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
