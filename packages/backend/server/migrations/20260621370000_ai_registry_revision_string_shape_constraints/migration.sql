ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_revision_shape_check"
  CHECK (
    length("revision") BETWEEN 1 AND 512
    AND "revision" ~ '^[a-zA-Z0-9._:-]+$'
  ) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_revision_shape_check"
  CHECK (
    length("revision") BETWEEN 1 AND 512
    AND "revision" ~ '^[a-zA-Z0-9._:-]+$'
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_revision_shape_check"
  CHECK (
    length("revision") BETWEEN 1 AND 512
    AND "revision" ~ '^[a-zA-Z0-9._:-]+$'
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_revision_shape_check"
  CHECK (
    length("revision") BETWEEN 1 AND 512
    AND "revision" ~ '^[a-zA-Z0-9._:-]+$'
  ) NOT VALID;
