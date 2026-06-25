CREATE OR REPLACE FUNCTION ai_support_bundle_retention_retry_bounded_string(
  value jsonb,
  field_name text,
  max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value->field_name) = 'string'
    AND length(btrim(value->>field_name)) BETWEEN 1 AND max_length,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_support_bundle_retention_retry_nullable_string(
  value jsonb,
  field_name text,
  max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    value->field_name = 'null'::jsonb
    OR (
      jsonb_typeof(value->field_name) = 'string'
      AND length(btrim(value->>field_name)) BETWEEN 1 AND max_length
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_support_bundle_retention_retry_nonnegative_int(
  value jsonb,
  field_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value->field_name) = 'number'
    AND (value->>field_name) ~ '^[0-9]+$'
    AND (value->>field_name)::numeric <= 1000000000,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_support_bundle_retention_retry_positive_int(
  value jsonb,
  field_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value->field_name) = 'number'
    AND (value->>field_name) ~ '^[1-9][0-9]*$'
    AND (value->>field_name)::numeric <= 1000000000,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_support_bundle_retention_retry_metadata_valid(
  value jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND ai_support_bundle_retention_retry_bounded_string(
      value,
      'cleanupActorId',
      512
    )
    AND ai_support_bundle_retention_retry_bounded_string(
      value,
      'cleanupFingerprint',
      128
    )
    AND jsonb_typeof(value->'cleanupScope') = 'string'
    AND btrim(value->>'cleanupScope') IN (
      'manual_workspace',
      'scheduled_worker'
    )
    AND ai_support_bundle_retention_retry_bounded_string(
      value,
      'cleanedAt',
      128
    )
    AND ai_support_bundle_retention_retry_nonnegative_int(
      value,
      'expiredAuthorizationCount'
    )
    AND ai_support_bundle_retention_retry_bounded_string(
      value,
      'manifestFingerprint',
      128
    )
    AND ai_support_bundle_retention_retry_bounded_string(
      value,
      'previousManifestFingerprint',
      128
    )
    AND jsonb_typeof(value->'retentionStatus') = 'string'
    AND btrim(value->>'retentionStatus') = 'expired'
    AND (
      NOT (value ? 'archiveObjectCleanupStatus')
      OR (
        jsonb_typeof(value->'archiveObjectCleanupStatus') = 'string'
        AND btrim(value->>'archiveObjectCleanupStatus') IN (
          'deleted',
          'missing',
          'failed'
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'archiveObjectCleanupErrorCode',
          128
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'archiveObjectCleanupErrorMessage',
          512
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'archiveStorageKey',
          1024
        )
      )
    )
    AND (
      NOT (value ? 'manifestObjectRewriteStatus')
      OR (
        jsonb_typeof(value->'manifestObjectRewriteStatus') = 'string'
        AND btrim(value->>'manifestObjectRewriteStatus') IN (
          'written',
          'missing',
          'failed'
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'manifestObjectRewriteErrorCode',
          128
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'manifestObjectRewriteErrorMessage',
          512
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'manifestStorageKey',
          1024
        )
        AND (
          btrim(value->>'manifestObjectRewriteStatus') = 'missing'
          OR ai_support_bundle_retention_retry_positive_int(
            value,
            'manifestByteSize'
          )
        )
      )
    )
    AND (
      NOT COALESCE(value->'archiveObjectCleanupRetry' = 'true'::jsonb, false)
      OR (
        ai_support_bundle_retention_retry_nonnegative_int(
          value,
          'archiveObjectCleanupFailureCount'
        )
        AND jsonb_typeof(value->'archiveObjectCleanupStatus') = 'string'
        AND btrim(value->>'archiveObjectCleanupStatus') IN (
          'deleted',
          'missing',
          'failed'
        )
        AND ai_support_bundle_retention_retry_bounded_string(
          value,
          'archiveStorageKey',
          1024
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'previousArchiveObjectCleanupErrorCode',
          128
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'previousArchiveObjectCleanupErrorMessage',
          512
        )
        AND ai_support_bundle_retention_retry_bounded_string(
          value,
          'previousArchiveObjectCleanupFingerprint',
          128
        )
      )
    )
    AND (
      NOT COALESCE(value->'manifestObjectRewriteRetry' = 'true'::jsonb, false)
      OR (
        ai_support_bundle_retention_retry_nonnegative_int(
          value,
          'manifestObjectRewriteFailureCount'
        )
        AND jsonb_typeof(value->'manifestObjectRewriteStatus') = 'string'
        AND btrim(value->>'manifestObjectRewriteStatus') IN (
          'written',
          'missing',
          'failed'
        )
        AND ai_support_bundle_retention_retry_bounded_string(
          value,
          'manifestStorageKey',
          1024
        )
        AND ai_support_bundle_retention_retry_positive_int(
          value,
          'manifestByteSize'
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'previousManifestObjectRewriteErrorCode',
          128
        )
        AND ai_support_bundle_retention_retry_nullable_string(
          value,
          'previousManifestObjectRewriteErrorMessage',
          512
        )
        AND ai_support_bundle_retention_retry_bounded_string(
          value,
          'previousManifestObjectRewriteFingerprint',
          128
        )
      )
    )
    AND (
      NOT COALESCE(value->'archiveObjectCleanupEscalated' = 'true'::jsonb, false)
      OR (
        btrim(value->>'cleanupScope') = 'scheduled_worker'
        AND value->'archiveObjectCleanupRetry' = 'true'::jsonb
        AND btrim(value->>'archiveObjectCleanupStatus') = 'failed'
        AND ai_support_bundle_retention_retry_bounded_string(
          value,
          'archiveObjectCleanupEscalatedAt',
          128
        )
        AND jsonb_typeof(value->'archiveObjectCleanupEscalationReason') =
          'string'
        AND btrim(value->>'archiveObjectCleanupEscalationReason') =
          'scheduled_retry_limit_exceeded'
      )
    )
    AND (
      NOT COALESCE(value->'manifestObjectRewriteEscalated' = 'true'::jsonb, false)
      OR (
        btrim(value->>'cleanupScope') = 'scheduled_worker'
        AND value->'manifestObjectRewriteRetry' = 'true'::jsonb
        AND btrim(value->>'manifestObjectRewriteStatus') = 'failed'
        AND ai_support_bundle_retention_retry_bounded_string(
          value,
          'manifestObjectRewriteEscalatedAt',
          128
        )
        AND jsonb_typeof(value->'manifestObjectRewriteEscalationReason') =
          'string'
        AND btrim(value->>'manifestObjectRewriteEscalationReason') =
          'scheduled_retry_limit_exceeded'
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_retention_retry_metadata_check"
  CHECK (
    "event_type" <> 'retention_expired'
    OR NOT (
      "metadata" ? 'archiveObjectCleanupStatus'
      OR "metadata" ? 'archiveObjectCleanupRetry'
      OR "metadata" ? 'archiveObjectCleanupEscalated'
      OR "metadata" ? 'manifestObjectRewriteStatus'
      OR "metadata" ? 'manifestObjectRewriteRetry'
      OR "metadata" ? 'manifestObjectRewriteEscalated'
    )
    OR ai_support_bundle_retention_retry_metadata_valid("metadata")
  ) NOT VALID;
