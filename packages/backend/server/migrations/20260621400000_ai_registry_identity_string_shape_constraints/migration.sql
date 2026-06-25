ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_prompt_name_shape_check"
  CHECK (
    length(btrim("prompt_name")) BETWEEN 1 AND 32
  ) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_model_id_shape_check"
  CHECK (
    "model_id" IS NULL
    OR length(btrim("model_id")) BETWEEN 1 AND 512
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_identity_shape_check"
  CHECK (
    length(btrim("provider_id")) BETWEEN 1 AND 512
    AND length(btrim("model_id")) BETWEEN 1 AND 512
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_provider_id_shape_check"
  CHECK (
    length(btrim("provider_id")) BETWEEN 1 AND 512
  ) NOT VALID;
