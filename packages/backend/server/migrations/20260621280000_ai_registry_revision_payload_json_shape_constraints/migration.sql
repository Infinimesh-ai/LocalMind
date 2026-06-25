ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_payload_json_shape_check"
  CHECK (
    jsonb_typeof("model_definition") = 'object'
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_payload_json_shape_check"
  CHECK (
    jsonb_typeof("provider_profile") = 'object'
  ) NOT VALID;
