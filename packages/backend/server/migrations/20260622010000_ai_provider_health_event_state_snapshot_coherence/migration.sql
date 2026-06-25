ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_event_identity_key"
  UNIQUE ("id", "provider_id", "scope_type");

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_event_workspace_key"
  UNIQUE ("id", "provider_id", "scope_type", "workspace_id");

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_state_identity_fkey"
  FOREIGN KEY (
    "state_id",
    "provider_id",
    "scope_type"
  )
  REFERENCES "ai_provider_health_states"(
    "id",
    "provider_id",
    "scope_type"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_state_workspace_fkey"
  FOREIGN KEY (
    "state_id",
    "provider_id",
    "scope_type",
    "workspace_id"
  )
  REFERENCES "ai_provider_health_states"(
    "id",
    "provider_id",
    "scope_type",
    "workspace_id"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;
