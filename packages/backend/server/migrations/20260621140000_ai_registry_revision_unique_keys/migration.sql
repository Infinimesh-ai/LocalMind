CREATE UNIQUE INDEX "ai_model_registry_revisions_global_revision_key"
  ON "ai_model_registry_revisions"("provider_id", "model_id", "revision")
  WHERE "scope_type" = 'global' AND "workspace_id" IS NULL;

CREATE UNIQUE INDEX "ai_model_registry_revisions_workspace_revision_key"
  ON "ai_model_registry_revisions"("provider_id", "model_id", "workspace_id", "revision")
  WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL;

CREATE UNIQUE INDEX "ai_provider_registry_revisions_global_revision_key"
  ON "ai_provider_registry_revisions"("provider_id", "revision")
  WHERE "scope_type" = 'global' AND "workspace_id" IS NULL;

CREATE UNIQUE INDEX "ai_provider_registry_revisions_workspace_revision_key"
  ON "ai_provider_registry_revisions"("provider_id", "workspace_id", "revision")
  WHERE "scope_type" = 'workspace' AND "workspace_id" IS NOT NULL;
