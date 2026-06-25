-- CreateTable
CREATE TABLE "ai_task_route_policy_revisions" (
    "id" VARCHAR NOT NULL,
    "feature_kind" VARCHAR NOT NULL,
    "scope_type" VARCHAR NOT NULL DEFAULT 'global',
    "workspace_id" VARCHAR,
    "actor_id" VARCHAR,
    "revision" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "model_id" VARCHAR,
    "config_key" VARCHAR,
    "config_path" VARCHAR,
    "fingerprint" VARCHAR NOT NULL,
    "fallback_source_chain" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_task_route_policy_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_task_route_policy_revisions_feature_kind_check" CHECK ("feature_kind" IN ('embedding', 'workspace_indexing', 'rerank')),
    CONSTRAINT "ai_task_route_policy_revisions_scope_type_check" CHECK ("scope_type" IN ('global', 'workspace')),
    CONSTRAINT "ai_task_route_policy_revisions_status_check" CHECK ("status" IN ('active', 'archived', 'disabled'))
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_task_route_policy_revisions_global_revision_key" ON "ai_task_route_policy_revisions"("feature_kind", "revision") WHERE "scope_type" = 'global' AND "workspace_id" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ai_task_route_policy_revisions_workspace_revision_key" ON "ai_task_route_policy_revisions"("feature_kind", "workspace_id", "revision") WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "ai_task_route_policy_revisions_scope_revision_idx" ON "ai_task_route_policy_revisions"("feature_kind", "scope_type", "workspace_id", "revision");

-- CreateIndex
CREATE INDEX "ai_task_route_policy_revisions_scope_created_at_idx" ON "ai_task_route_policy_revisions"("feature_kind", "scope_type", "workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_task_route_policy_revisions_workspace_id_created_at_idx" ON "ai_task_route_policy_revisions"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_task_route_policy_revisions_actor_id_created_at_idx" ON "ai_task_route_policy_revisions"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_task_route_policy_revisions_status_created_at_idx" ON "ai_task_route_policy_revisions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "ai_task_route_policy_revisions" ADD CONSTRAINT "ai_task_route_policy_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_task_route_policy_revisions" ADD CONSTRAINT "ai_task_route_policy_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
