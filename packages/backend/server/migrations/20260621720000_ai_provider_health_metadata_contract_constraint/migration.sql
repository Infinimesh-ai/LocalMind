CREATE OR REPLACE FUNCTION ai_provider_health_metadata_contract_valid(
  metadata jsonb,
  source text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata) = 'object'
    AND jsonb_typeof(metadata->'version') = 'string'
    AND btrim(metadata->>'version') = 'provider-health-state-metadata/v1'
    AND jsonb_typeof(metadata->'publishSource') = 'string'
    AND (
      (
        source = 'manual_override'
        AND btrim(metadata->>'publishSource') = 'graphql_mutation'
      )
      OR (
        source = 'probe_result'
        AND btrim(metadata->>'publishSource') IN (
          'workspace_provider_health_probe_result',
          'configured_provider_health_snapshot_worker',
          'configured_provider_health_snapshot_cleanup_worker',
          'provider_health_probe_result_stale_cleanup_worker'
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_metadata_contract_check"
  CHECK (
    ai_provider_health_metadata_contract_valid("metadata", "source")
  ) NOT VALID;
