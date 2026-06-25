ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_timestamp_coherence_check"
  CHECK (
    "updated_at" >= "checked_at"
  ) NOT VALID;
