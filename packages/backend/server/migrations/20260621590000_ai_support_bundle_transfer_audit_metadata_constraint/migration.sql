ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_transfer_metadata_shape_check"
  CHECK (
    "event_type" <> 'downloaded'
    OR COALESCE("metadata"->>'providerTransferEvent', 'false') <> 'true'
    OR COALESCE((
      "metadata"->>'clientAcknowledged' = 'false'
      AND "metadata"->>'serverVerified' = 'true'
      AND jsonb_typeof("metadata"->'notificationAuthEvidence') = 'object'
      AND "metadata"->'notificationAuthEvidence'->>'policy' = 'internal_access_token'
      AND "metadata"->'notificationAuthEvidence'->>'status' = 'verified'
      AND "metadata"->'notificationAuthEvidence'->>'method' = 'x-access-token'
      AND (
        NOT ("metadata"->'notificationAuthEvidence' ? 'providerSignatureEvidence')
        OR (
          jsonb_typeof("metadata"->'notificationAuthEvidence'->'providerSignatureEvidence') = 'object'
          AND "metadata"->'notificationAuthEvidence'->'providerSignatureEvidence'->>'status' = 'verified_by_upstream'
        )
      )
      AND length(btrim("metadata"->>'notificationAuthEvidenceFingerprint')) BETWEEN 1 AND 128
      AND length(btrim("metadata"->>'storageKey')) BETWEEN 1 AND 1024
      AND jsonb_typeof("metadata"->'storageByteSize') = 'number'
      AND ("metadata"->>'storageByteSize') ~ '^[0-9]+$'
      AND length(btrim("metadata"->>'transferEventSource')) BETWEEN 1 AND 512
      AND length(btrim("metadata"->>'transferredAt')) BETWEEN 1 AND 128
    ), false)
  ) NOT VALID;
