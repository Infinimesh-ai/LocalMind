ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_state_id_fkey"
  FOREIGN KEY ("state_id")
  REFERENCES "ai_provider_health_states"("id")
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_provider_health_events"
  ADD CONSTRAINT "ai_provider_health_events_state_id_present_check"
  CHECK ("state_id" IS NOT NULL) NOT VALID;
