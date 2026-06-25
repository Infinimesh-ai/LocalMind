ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_last_error_shape_check"
  CHECK (
    "last_error" IS NULL
    OR length(btrim("last_error")) BETWEEN 1 AND 512
  ) NOT VALID;
