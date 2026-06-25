ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_json_shape_check"
  CHECK (
    jsonb_typeof("fallback_source_chain") = 'array'
    AND jsonb_typeof("metadata") = 'object'
  ) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_json_shape_check"
  CHECK (
    jsonb_typeof("fallback_source_chain") = 'array'
    AND jsonb_typeof("metadata") = 'object'
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_json_shape_check"
  CHECK (
    jsonb_typeof("fallback_source_chain") = 'array'
    AND jsonb_typeof("metadata") = 'object'
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_json_shape_check"
  CHECK (
    jsonb_typeof("fallback_source_chain") = 'array'
    AND jsonb_typeof("metadata") = 'object'
  ) NOT VALID;
