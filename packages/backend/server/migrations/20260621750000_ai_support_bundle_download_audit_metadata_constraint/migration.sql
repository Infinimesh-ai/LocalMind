CREATE OR REPLACE FUNCTION ai_support_bundle_download_authorized_metadata_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND (
      (
        COALESCE(value->'authorizationExpired' = 'true'::jsonb, false)
        AND jsonb_typeof(value->'version') = 'string'
        AND btrim(value->>'version') = 'copilot-support-bundle-download-authorization-expired-audit/v1'
        AND jsonb_typeof(value->'authorizationId') = 'string'
        AND length(btrim(value->>'authorizationId')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'authorizationFingerprint') = 'string'
        AND length(btrim(value->>'authorizationFingerprint')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'artifactKind') = 'string'
        AND btrim(value->>'artifactKind') IN ('manifest_json', 'archive_json')
        AND jsonb_typeof(value->'artifactFingerprint') = 'string'
        AND length(btrim(value->>'artifactFingerprint')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'cleanupActorId') = 'string'
        AND length(btrim(value->>'cleanupActorId')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'cleanupFingerprint') = 'string'
        AND length(btrim(value->>'cleanupFingerprint')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'cleanupScope') = 'string'
        AND btrim(value->>'cleanupScope') IN (
          'scheduled_worker',
          'retention_cleanup',
          'api_proxy_consume',
          'direct_download_acknowledge',
          'direct_download_transfer_event'
        )
        AND jsonb_typeof(value->'cleanedAt') = 'string'
        AND length(btrim(value->>'cleanedAt')) BETWEEN 1 AND 128
        AND (
          NOT (value ? 'deliveryMethod')
          OR (
            jsonb_typeof(value->'deliveryMethod') = 'string'
            AND btrim(value->>'deliveryMethod') IN (
              'api_proxy',
              'object_storage_signed_url'
            )
          )
        )
        AND jsonb_typeof(value->'expiresAt') = 'string'
        AND length(btrim(value->>'expiresAt')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'previousStatus') = 'string'
        AND btrim(value->>'previousStatus') = 'authorized'
        AND jsonb_typeof(value->'status') = 'string'
        AND btrim(value->>'status') = 'expired'
      )
      OR (
        NOT COALESCE(value->'authorizationExpired' = 'true'::jsonb, false)
        AND jsonb_typeof(value->'version') = 'string'
        AND btrim(value->>'version') = 'copilot-support-bundle-download-authorized-audit/v1'
        AND jsonb_typeof(value->'authorizationId') = 'string'
        AND length(btrim(value->>'authorizationId')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'authorizationFingerprint') = 'string'
        AND length(btrim(value->>'authorizationFingerprint')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'artifactKind') = 'string'
        AND btrim(value->>'artifactKind') IN ('manifest_json', 'archive_json')
        AND jsonb_typeof(value->'artifactFilename') = 'string'
        AND length(btrim(value->>'artifactFilename')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'artifactMime') = 'string'
        AND length(btrim(value->>'artifactMime')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'deliveryMethod') = 'string'
        AND btrim(value->>'deliveryMethod') IN (
          'api_proxy',
          'object_storage_signed_url'
        )
        AND (
          value->'directDownloadExpiresAt' = 'null'::jsonb
          OR (
            jsonb_typeof(value->'directDownloadExpiresAt') = 'string'
            AND length(btrim(value->>'directDownloadExpiresAt')) BETWEEN 1 AND 128
          )
        )
        AND jsonb_typeof(value->'hasDirectDownloadUrl') = 'boolean'
        AND jsonb_typeof(value->'manifestFingerprint') = 'string'
        AND length(btrim(value->>'manifestFingerprint')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'artifactFingerprint') = 'string'
        AND length(btrim(value->>'artifactFingerprint')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'expiresAt') = 'string'
        AND length(btrim(value->>'expiresAt')) BETWEEN 1 AND 128
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_download_metadata_check"
  CHECK (
    "event_type" <> 'download_authorized'
    OR ai_support_bundle_download_authorized_metadata_valid("metadata")
  ) NOT VALID;
