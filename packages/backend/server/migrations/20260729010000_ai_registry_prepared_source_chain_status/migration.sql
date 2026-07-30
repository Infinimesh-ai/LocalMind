ALTER TABLE "ai_task_route_policy_revisions"
  DROP CONSTRAINT IF EXISTS "ai_task_route_policy_revisions_source_chain_provenance_check";

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_source_chain_provenance_check"
  CHECK (
    "ai_registry_source_chain_provenance_valid"(
      "fallback_source_chain",
      ARRAY[
        'db_revision',
        'config_fallback',
        'provider_default'
      ]::text[],
      ARRAY['global', 'workspace']::text[],
      ARRAY[
        'active',
        'available',
        'disabled',
        'prepared_for_approval'
      ]::text[]
    )
  ) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  VALIDATE CONSTRAINT "ai_task_route_policy_revisions_source_chain_provenance_check";

ALTER TABLE "ai_model_registry_revisions"
  DROP CONSTRAINT IF EXISTS "ai_model_registry_revisions_source_chain_provenance_check";

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_source_chain_provenance_check"
  CHECK (
    "ai_registry_source_chain_provenance_valid"(
      "fallback_source_chain",
      ARRAY[
        'db_revision',
        'provider_profile',
        'native_registry',
        'config_fallback'
      ]::text[],
      ARRAY['global', 'workspace']::text[],
      ARRAY[
        'active',
        'available',
        'disabled',
        'prepared_for_approval',
        'provider_available'
      ]::text[]
    )
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  VALIDATE CONSTRAINT "ai_model_registry_revisions_source_chain_provenance_check";
