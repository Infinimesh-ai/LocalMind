CREATE OR REPLACE FUNCTION ai_support_bundle_provider_sig_evidence_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'provider') = 'string'
    AND value->>'provider' IN ('aws_s3', 'cloudflare_r2', 's3_compatible')
    AND jsonb_typeof(value->'status') = 'string'
    AND value->>'status' = 'verified_by_upstream'
    AND jsonb_typeof(value->'verifier') = 'string'
    AND length(btrim(value->>'verifier')) BETWEEN 1 AND 128
    AND jsonb_typeof(value->'signatureFingerprint') = 'string'
    AND value->>'signatureFingerprint' ~ '^[a-f0-9]{16,64}$'
    AND jsonb_typeof(value->'policy') = 'string'
    AND length(btrim(value->>'policy')) BETWEEN 1 AND 128
    AND (
      NOT (value ? 'keyId')
      OR (
        jsonb_typeof(value->'keyId') = 'string'
        AND length(btrim(value->>'keyId')) BETWEEN 1 AND 512
      )
    )
    AND (
      NOT (value ? 'algorithm')
      OR (
        jsonb_typeof(value->'algorithm') = 'string'
        AND length(btrim(value->>'algorithm')) BETWEEN 1 AND 128
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_provider_sig_evidence_check"
  CHECK (
    "event_type" <> 'downloaded'
    OR COALESCE("metadata"->>'providerTransferEvent', 'false') <> 'true'
    OR COALESCE(
      (
        (
          "metadata"->>'transferEventSource' NOT IN ('aws:s3', 'aws.s3')
          OR COALESCE(
            "metadata"->'notificationAuthEvidence'
              ? 'providerSignatureEvidence',
            false
          )
        )
        AND (
          NOT COALESCE(
            "metadata"->'notificationAuthEvidence'
              ? 'providerSignatureEvidence',
            false
          )
          OR ai_support_bundle_provider_sig_evidence_valid(
            "metadata"->'notificationAuthEvidence'
              ->'providerSignatureEvidence'
          )
        )
      ),
      false
    )
  ) NOT VALID;
