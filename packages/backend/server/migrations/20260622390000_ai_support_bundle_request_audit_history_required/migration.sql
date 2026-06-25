CREATE OR REPLACE FUNCTION ai_support_bundle_request_audit_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."retention_status" IS NOT DISTINCT FROM NEW."retention_status"
     AND OLD."manifest_json" IS NOT DISTINCT FROM NEW."manifest_json"
     AND OLD."manifest_fingerprint" IS NOT DISTINCT FROM
       NEW."manifest_fingerprint"
     AND OLD."manifest_byte_size" IS NOT DISTINCT FROM
       NEW."manifest_byte_size"
     AND OLD."expires_at" IS NOT DISTINCT FROM NEW."expires_at"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message" THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_support_bundle_audit_events" event
       WHERE event."bundle_id" = NEW."id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
         AND event."event_type" = 'created'
         AND event."created_at" >= NEW."created_at"
         AND event."metadata"->>'manifestFingerprint' IS NOT DISTINCT FROM
           NEW."manifest_fingerprint"
         AND event."metadata"->>'sourceEvidenceSetFingerprint' IS NOT DISTINCT FROM
           NEW."source_evidence_set_fingerprint"
         AND event."metadata"->>'retentionStatus' IS NOT DISTINCT FROM
           NEW."retention_status"
         AND (
           NEW."manifest_storage_key" IS NULL
           OR event."metadata"->>'manifestStorageKey' IS NOT DISTINCT FROM
             NEW."manifest_storage_key"
         )
         AND (
           NEW."manifest_mime" IS NULL
           OR event."metadata"->>'manifestMime' IS NOT DISTINCT FROM
             NEW."manifest_mime"
         )
         AND (
           NEW."manifest_filename" IS NULL
           OR event."metadata"->>'manifestFilename' IS NOT DISTINCT FROM
             NEW."manifest_filename"
         )
         AND (
           NEW."manifest_byte_size" IS NULL
           OR (
             jsonb_typeof(event."metadata"->'manifestByteSize') = 'number'
             AND (event."metadata"->>'manifestByteSize') ~ '^[0-9]+$'
             AND (event."metadata"->>'manifestByteSize')::numeric =
               NEW."manifest_byte_size"
           )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_requests_audit_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_support_bundle_requests_audit_history_required_check';
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW."archive_storage_key" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_support_bundle_audit_events" event
       WHERE event."bundle_id" = NEW."id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
         AND event."event_type" = 'archive_created'
         AND event."created_at" >= NEW."created_at"
         AND event."metadata"->>'archiveFingerprint' IS NOT DISTINCT FROM
           NEW."archive_fingerprint"
         AND event."metadata"->>'manifestFingerprint' IS NOT DISTINCT FROM
           NEW."manifest_fingerprint"
         AND (
           NEW."archive_storage_key" IS NULL
           OR event."metadata"->>'archiveStorageKey' IS NOT DISTINCT FROM
             NEW."archive_storage_key"
         )
         AND (
           NEW."archive_mime" IS NULL
           OR event."metadata"->>'archiveMime' IS NOT DISTINCT FROM
             NEW."archive_mime"
         )
         AND (
           NEW."archive_filename" IS NULL
           OR event."metadata"->>'archiveFilename' IS NOT DISTINCT FROM
             NEW."archive_filename"
         )
         AND (
           NEW."archive_byte_size" IS NULL
           OR (
             jsonb_typeof(event."metadata"->'archiveByteSize') = 'number'
             AND (event."metadata"->>'archiveByteSize') ~ '^[0-9]+$'
             AND (event."metadata"->>'archiveByteSize')::numeric =
               NEW."archive_byte_size"
           )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_requests_audit_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_support_bundle_requests_audit_history_required_check';
  END IF;

  IF NEW."status" = 'expired'
     AND NEW."retention_status" = 'expired'
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_support_bundle_audit_events" event
       WHERE event."bundle_id" = NEW."id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
         AND event."event_type" = 'retention_expired'
         AND (
           TG_OP = 'INSERT'
           OR event."created_at" >= OLD."updated_at"
         )
         AND event."metadata"->>'retentionStatus' = 'expired'
         AND event."metadata"->>'manifestFingerprint' IS NOT DISTINCT FROM
           NEW."manifest_fingerprint"
         AND (
           TG_OP = 'INSERT'
           OR event."metadata"->>'previousManifestFingerprint' IS NOT DISTINCT FROM
             OLD."manifest_fingerprint"
         )
         AND (
           NEW."manifest_storage_key" IS NULL
           OR event."metadata"->>'manifestStorageKey' IS NOT DISTINCT FROM
             NEW."manifest_storage_key"
         )
         AND (
           NEW."manifest_byte_size" IS NULL
           OR (
             jsonb_typeof(event."metadata"->'manifestByteSize') = 'number'
             AND (event."metadata"->>'manifestByteSize') ~ '^[0-9]+$'
             AND (event."metadata"->>'manifestByteSize')::numeric =
               NEW."manifest_byte_size"
           )
         )
         AND (
           NOT (event."metadata" ? 'cleanupActorId')
           OR length(btrim(event."metadata"->>'cleanupActorId')) BETWEEN 1 AND 512
         )
         AND (
           NOT (event."metadata" ? 'cleanupFingerprint')
           OR length(btrim(event."metadata"->>'cleanupFingerprint')) BETWEEN 1 AND 128
         )
     ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_requests_audit_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_support_bundle_requests_audit_history_required_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_support_bundle_requests_audit_history_required_check"
AFTER INSERT OR UPDATE OF
  "status",
  "retention_status",
  "manifest_json",
  "manifest_fingerprint",
  "manifest_byte_size",
  "expires_at",
  "failure_code",
  "failure_message"
ON "ai_support_bundle_requests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_request_audit_history_required();
