CREATE TABLE "ai_model_registry_revisions" (
  "id" VARCHAR NOT NULL,
  "provider_id" VARCHAR NOT NULL,
  "model_id" VARCHAR NOT NULL,
  "scope_type" VARCHAR NOT NULL DEFAULT 'global',
  "workspace_id" VARCHAR,
  "actor_id" VARCHAR,
  "revision" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'active',
  "fingerprint" VARCHAR NOT NULL,
  "model_definition" JSONB NOT NULL,
  "fallback_source_chain" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_model_registry_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_model_registry_revisions_scope_revision_idx"
  ON "ai_model_registry_revisions"("provider_id", "model_id", "scope_type", "workspace_id", "revision");

CREATE INDEX "ai_model_registry_revisions_scope_created_at_idx"
  ON "ai_model_registry_revisions"("provider_id", "model_id", "scope_type", "workspace_id", "created_at");

CREATE INDEX "ai_model_registry_revisions_workspace_id_created_at_idx"
  ON "ai_model_registry_revisions"("workspace_id", "created_at");

CREATE INDEX "ai_model_registry_revisions_actor_id_created_at_idx"
  ON "ai_model_registry_revisions"("actor_id", "created_at");

CREATE INDEX "ai_model_registry_revisions_status_created_at_idx"
  ON "ai_model_registry_revisions"("status", "created_at");

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
