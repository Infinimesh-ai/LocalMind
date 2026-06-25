ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_identity_shape_check"
  CHECK (
    length(btrim("provider_id")) BETWEEN 1 AND 512
    AND (
      "provider_type" IS NULL
      OR length(btrim("provider_type")) BETWEEN 1 AND 512
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_fingerprint_shape_check"
  CHECK (
    length(btrim("fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;
