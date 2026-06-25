CREATE OR REPLACE FUNCTION ai_provider_health_metadata_bounded_string(
  metadata jsonb,
  field_name text,
  max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata->field_name) = 'string'
    AND length(btrim(metadata->>field_name)) BETWEEN 1 AND max_length,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_provider_health_metadata_nullable_string(
  metadata jsonb,
  field_name text,
  max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    metadata->field_name = 'null'::jsonb
    OR (
      jsonb_typeof(metadata->field_name) = 'string'
      AND length(btrim(metadata->>field_name)) BETWEEN 1 AND max_length
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_provider_health_metadata_positive_number(
  metadata jsonb,
  field_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata->field_name) = 'number'
    AND (metadata->>field_name)::numeric > 0
    AND (metadata->>field_name)::numeric <= 31536000000,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_provider_health_cleanup_metadata_valid(
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
    )
    AND ai_provider_health_metadata_nullable_string(
      metadata,
      'providerProfileSource',
      128
    )
    AND (
      NOT (metadata ? 'providerProfileId')
      OR ai_provider_health_metadata_bounded_string(
        metadata,
        'providerProfileId',
        512
      )
    )
    AND (
      btrim(metadata->>'publishSource') <> 'configured_provider_health_snapshot_worker'
      OR (
        ai_provider_health_metadata_bounded_string(
          metadata,
          'providerProfileId',
          512
        )
        AND ai_provider_health_metadata_bounded_string(
          metadata,
          'providerProfileSnapshotSource',
          128
        )
        AND (
          NOT (metadata ? 'providerProfileConfigPath')
          OR ai_provider_health_metadata_bounded_string(
            metadata,
            'providerProfileConfigPath',
            1024
          )
        )
      )
    )
    AND (
      btrim(metadata->>'publishSource') <>
        'configured_provider_health_snapshot_cleanup_worker'
      OR (
        ai_provider_health_metadata_bounded_string(
          metadata,
          'providerProfileId',
          512
        )
        AND jsonb_typeof(metadata->'providerProfileSnapshotCleanupReason') =
          'string'
        AND btrim(metadata->>'providerProfileSnapshotCleanupReason') =
          'configured_provider_health_snapshot_missing'
        AND ai_provider_health_metadata_bounded_string(
          metadata,
          'previousCheckedAt',
          128
        )
        AND ai_provider_health_metadata_bounded_string(
          metadata,
          'previousFingerprint',
          128
        )
        AND ai_provider_health_metadata_nullable_string(
          metadata,
          'previousLastError',
          512
        )
        AND ai_provider_health_metadata_nullable_string(
          metadata,
          'previousPublishSource',
          128
        )
        AND jsonb_typeof(metadata->'previousStatus') = 'string'
        AND btrim(metadata->>'previousStatus') IN (
          'unknown',
          'healthy',
          'degraded',
          'down'
        )
      )
    )
    AND (
      btrim(metadata->>'publishSource') <>
        'provider_health_probe_result_stale_cleanup_worker'
      OR (
        ai_provider_health_metadata_bounded_string(
          metadata,
          'providerProfileId',
          512
        )
        AND jsonb_typeof(metadata->'providerHealthProbeResultCleanupReason') =
          'string'
        AND btrim(metadata->>'providerHealthProbeResultCleanupReason') =
          'provider_health_probe_result_stale'
        AND ai_provider_health_metadata_bounded_string(
          metadata,
          'previousCheckedAt',
          128
        )
        AND ai_provider_health_metadata_bounded_string(
          metadata,
          'previousFingerprint',
          128
        )
        AND ai_provider_health_metadata_nullable_string(
          metadata,
          'previousLastError',
          512
        )
        AND ai_provider_health_metadata_nullable_string(
          metadata,
          'previousPublishSource',
          128
        )
        AND jsonb_typeof(metadata->'previousSource') = 'string'
        AND btrim(metadata->>'previousSource') = 'probe_result'
        AND jsonb_typeof(metadata->'previousStatus') = 'string'
        AND btrim(metadata->>'previousStatus') IN (
          'unknown',
          'healthy',
          'degraded',
          'down'
        )
        AND ai_provider_health_metadata_positive_number(
          metadata,
          'probeResultMaxAgeMs'
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_cleanup_metadata_contract_check"
  CHECK (
    btrim(COALESCE("metadata"->>'version', '')) <>
      'provider-health-state-metadata/v1'
    OR ai_provider_health_cleanup_metadata_valid("metadata", "source")
  ) NOT VALID;
