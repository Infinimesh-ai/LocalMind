-- CreateTable
CREATE TABLE "ai_prompt_registry_revisions" (
    "id" VARCHAR NOT NULL,
    "prompt_name" VARCHAR(32) NOT NULL,
    "scope_type" VARCHAR NOT NULL DEFAULT 'global',
    "workspace_id" VARCHAR,
    "actor_id" VARCHAR,
    "revision" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "fingerprint" VARCHAR NOT NULL,
    "fallback_source_chain" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_registry_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_prompt_registry_revisions_scope_type_check" CHECK ("scope_type" IN ('global', 'workspace')),
    CONSTRAINT "ai_prompt_registry_revisions_status_check" CHECK ("status" IN ('active', 'archived', 'disabled'))
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_registry_revisions_global_revision_key" ON "ai_prompt_registry_revisions"("prompt_name", "revision") WHERE "scope_type" = 'global' AND "workspace_id" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_registry_revisions_workspace_revision_key" ON "ai_prompt_registry_revisions"("prompt_name", "workspace_id", "revision") WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "ai_prompt_registry_revisions_scope_revision_idx" ON "ai_prompt_registry_revisions"("prompt_name", "scope_type", "workspace_id", "revision");

-- CreateIndex
CREATE INDEX "ai_prompt_registry_revisions_scope_created_at_idx" ON "ai_prompt_registry_revisions"("prompt_name", "scope_type", "workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_prompt_registry_revisions_workspace_id_created_at_idx" ON "ai_prompt_registry_revisions"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_prompt_registry_revisions_actor_id_created_at_idx" ON "ai_prompt_registry_revisions"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_prompt_registry_revisions_status_created_at_idx" ON "ai_prompt_registry_revisions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ai_prompt_registry_revisions" ADD CONSTRAINT "ai_prompt_registry_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_registry_revisions" ADD CONSTRAINT "ai_prompt_registry_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
