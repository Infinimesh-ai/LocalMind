ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_scope_type_check"
  CHECK ("scope_type" IN ('global', 'workspace')) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_status_check"
  CHECK ("status" IN ('active', 'archived', 'disabled')) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_scope_type_check"
  CHECK ("scope_type" IN ('global', 'workspace')) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_status_check"
  CHECK ("status" IN ('active', 'archived', 'disabled')) NOT VALID;
