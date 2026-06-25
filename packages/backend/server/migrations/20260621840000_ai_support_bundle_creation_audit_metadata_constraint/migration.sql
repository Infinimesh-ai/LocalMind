CREATE OR REPLACE FUNCTION ai_support_bundle_audit_bounded_string(
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

CREATE OR REPLACE FUNCTION ai_support_bundle_audit_positive_int(
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
    AND (value->>field_name)::numeric > 0
    AND (value->>field_name)::numeric <= 1000000000,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_support_bundle_creation_audit_metadata_valid(
  event_type text,
  metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata) = 'object'
    AND CASE event_type
      WHEN 'created' THEN
        ai_support_bundle_audit_bounded_string(
          metadata,
          'manifestFingerprint',
          128
        )
        AND ai_support_bundle_audit_positive_int(metadata, 'manifestByteSize')
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'manifestFilename',
          512
        )
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'manifestMime',
          128
        )
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'manifestStorageKey',
          1024
        )
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'sourceEvidenceSetFingerprint',
          128
        )
        AND jsonb_typeof(metadata->'retentionStatus') = 'string'
        AND btrim(metadata->>'retentionStatus') = 'active'
      WHEN 'archive_created' THEN
        ai_support_bundle_audit_positive_int(metadata, 'archiveByteSize')
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'archiveFilename',
          512
        )
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'archiveFingerprint',
          128
        )
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'archiveMime',
          128
        )
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'archiveStorageKey',
          1024
        )
        AND ai_support_bundle_audit_bounded_string(
          metadata,
          'manifestFingerprint',
          128
        )
      ELSE true
    END,
    false
  );
$$;

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_creation_metadata_check"
  CHECK (
    ai_support_bundle_creation_audit_metadata_valid("event_type", "metadata")
  ) NOT VALID;
