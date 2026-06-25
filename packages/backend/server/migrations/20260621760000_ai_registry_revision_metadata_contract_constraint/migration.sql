CREATE OR REPLACE FUNCTION ai_registry_revision_metadata_contract_valid(
  metadata jsonb,
  direct_version text,
  repair_version text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata) = 'object'
    AND (
      NOT (
        metadata->>'version' IN (direct_version, repair_version)
      )
      OR (
        jsonb_typeof(metadata->'version') = 'string'
        AND jsonb_typeof(metadata->'publishSource') = 'string'
        AND (
          (
            btrim(metadata->>'version') = direct_version
            AND btrim(metadata->>'publishSource') = 'graphql_mutation'
          )
          OR (
            btrim(metadata->>'version') = repair_version
            AND btrim(metadata->>'publishSource') = 'repair_execution_worker'
          )
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_metadata_contract_check"
  CHECK (
    ai_registry_revision_metadata_contract_valid(
      "metadata",
      'prompt-registry-revision-direct-publish/v1',
      'prompt-registry-revision-repair-executor/v1'
    )
  ) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_metadata_contract_check"
  CHECK (
    ai_registry_revision_metadata_contract_valid(
      "metadata",
      'task-route-policy-revision-direct-publish/v1',
      'task-route-policy-revision-repair-executor/v1'
    )
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_metadata_contract_check"
  CHECK (
    ai_registry_revision_metadata_contract_valid(
      "metadata",
      'model-registry-revision-direct-publish/v1',
      'model-registry-revision-repair-executor/v1'
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_metadata_contract_check"
  CHECK (
    ai_registry_revision_metadata_contract_valid(
      "metadata",
      'provider-registry-revision-direct-publish/v1',
      'provider-registry-revision-repair-executor/v1'
    )
  ) NOT VALID;
