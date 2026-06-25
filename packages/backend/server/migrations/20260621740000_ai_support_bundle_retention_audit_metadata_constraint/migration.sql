CREATE OR REPLACE FUNCTION ai_support_bundle_retention_cleanup_metadata_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'cleanupActorId') = 'string'
    AND length(btrim(value->>'cleanupActorId')) BETWEEN 1 AND 512
    AND jsonb_typeof(value->'cleanupFingerprint') = 'string'
    AND length(btrim(value->>'cleanupFingerprint')) BETWEEN 1 AND 128
    AND jsonb_typeof(value->'cleanupScope') = 'string'
    AND btrim(value->>'cleanupScope') IN (
      'manual_workspace',
      'scheduled_worker'
    )
    AND jsonb_typeof(value->'cleanedAt') = 'string'
    AND length(btrim(value->>'cleanedAt')) BETWEEN 1 AND 128
    AND jsonb_typeof(value->'expiredAuthorizationCount') = 'number'
    AND (value->>'expiredAuthorizationCount') ~ '^[0-9]+$'
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
      )
    )
    AND (
      NOT COALESCE(value->'archiveObjectCleanupRetry' = 'true'::jsonb, false)
      OR jsonb_typeof(value->'archiveObjectCleanupFailureCount') = 'number'
    )
    AND (
      NOT COALESCE(value->'manifestObjectRewriteRetry' = 'true'::jsonb, false)
      OR jsonb_typeof(value->'manifestObjectRewriteFailureCount') = 'number'
    ),
    false
  );
$$;

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_retention_metadata_check"
  CHECK (
    "event_type" <> 'retention_expired'
    OR ai_support_bundle_retention_cleanup_metadata_valid("metadata")
  ) NOT VALID;
