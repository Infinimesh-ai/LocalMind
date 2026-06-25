ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_scope_workspace_check"
  CHECK (
    ("scope_type" = 'global' AND "workspace_id" IS NULL) OR
    ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_scope_workspace_check"
  CHECK (
    ("scope_type" = 'global' AND "workspace_id" IS NULL) OR
    ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_scope_workspace_check"
  CHECK (
    ("scope_type" = 'global' AND "workspace_id" IS NULL) OR
    ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_scope_workspace_check"
  CHECK (
    ("scope_type" = 'global' AND "workspace_id" IS NULL) OR
    ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
  ) NOT VALID;
