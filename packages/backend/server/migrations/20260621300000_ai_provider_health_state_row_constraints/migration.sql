ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_status_check"
  CHECK ("status" IN ('unknown', 'healthy', 'degraded', 'down')) NOT VALID;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_source_check"
  CHECK ("source" IN ('manual_override', 'probe_result')) NOT VALID;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_scope_type_check"
  CHECK ("scope_type" IN ('global', 'workspace')) NOT VALID;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_scope_workspace_check"
  CHECK (
    ("scope_type" = 'global' AND "workspace_id" IS NULL) OR
    ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_metadata_shape_check"
  CHECK (jsonb_typeof("metadata") = 'object') NOT VALID;
