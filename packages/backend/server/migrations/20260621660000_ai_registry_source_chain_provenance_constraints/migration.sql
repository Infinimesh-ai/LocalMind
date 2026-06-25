CREATE OR REPLACE FUNCTION "ai_registry_source_chain_provenance_valid"(
  "source_chain" jsonb,
  "allowed_sources" text[],
  "allowed_scopes" text[],
  "allowed_statuses" text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof("source_chain") = 'array' THEN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements("source_chain") AS "entry"("value")
      WHERE jsonb_typeof("entry"."value") IS DISTINCT FROM 'object'
        OR jsonb_typeof("entry"."value"->'source') IS DISTINCT FROM 'string'
        OR jsonb_typeof("entry"."value"->'scope') IS DISTINCT FROM 'string'
        OR jsonb_typeof("entry"."value"->'status') IS DISTINCT FROM 'string'
        OR "entry"."value"->>'source' <> ALL("allowed_sources")
        OR "entry"."value"->>'scope' <> ALL("allowed_scopes")
        OR "entry"."value"->>'status' <> ALL("allowed_statuses")
    )
    ELSE false
  END;
$$;

ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_source_chain_provenance_check"
  CHECK (
    "ai_registry_source_chain_provenance_valid"(
      "fallback_source_chain",
      ARRAY[
        'db_revision',
        'legacy_registry',
        'config_fallback',
        'publish_gate_route_review',
        'direct_publish',
        'repair_execution_request'
      ]::text[],
      ARRAY['global', 'workspace']::text[],
      ARRAY[
        'active',
        'allowed',
        'available',
        'blocked',
        'disabled',
        'prepared_for_approval',
        'ready',
        'reviewed',
        'route_ready'
      ]::text[]
    )
  ) NOT VALID;

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
      ARRAY['active', 'available', 'disabled']::text[]
    )
  ) NOT VALID;

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
        'provider_available'
      ]::text[]
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_source_chain_provenance_check"
  CHECK (
    "ai_registry_source_chain_provenance_valid"(
      "fallback_source_chain",
      ARRAY[
        'db_revision',
        'provider_profile',
        'legacy_profile',
        'config_fallback'
      ]::text[],
      ARRAY['global', 'workspace']::text[],
      ARRAY['active', 'available', 'disabled']::text[]
    )
  ) NOT VALID;
