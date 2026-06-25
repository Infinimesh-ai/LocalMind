CREATE OR REPLACE FUNCTION ai_support_bundle_request_evidence_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."source_evidence_summary" IS NOT DISTINCT FROM
       NEW."source_evidence_summary"
     AND OLD."source_evidence_set_fingerprint" IS NOT DISTINCT FROM
       NEW."source_evidence_set_fingerprint"
     AND OLD."manifest_storage_key" IS NOT DISTINCT FROM
       NEW."manifest_storage_key"
     AND OLD."manifest_mime" IS NOT DISTINCT FROM NEW."manifest_mime"
     AND OLD."manifest_filename" IS NOT DISTINCT FROM
       NEW."manifest_filename"
     AND OLD."archive_storage_key" IS NOT DISTINCT FROM
       NEW."archive_storage_key"
     AND OLD."archive_byte_size" IS NOT DISTINCT FROM
       NEW."archive_byte_size"
     AND OLD."archive_fingerprint" IS NOT DISTINCT FROM
       NEW."archive_fingerprint"
     AND OLD."archive_mime" IS NOT DISTINCT FROM NEW."archive_mime"
     AND OLD."archive_filename" IS NOT DISTINCT FROM
       NEW."archive_filename"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    IF OLD."manifest_json" IS NOT DISTINCT FROM NEW."manifest_json"
       AND OLD."manifest_fingerprint" IS NOT DISTINCT FROM
         NEW."manifest_fingerprint"
       AND OLD."manifest_byte_size" IS NOT DISTINCT FROM
         NEW."manifest_byte_size" THEN
      RETURN NEW;
    END IF;

    IF OLD."retention_status" = 'active'
       AND NEW."status" = 'expired'
       AND NEW."retention_status" = 'expired'
       AND jsonb_typeof(NEW."manifest_json"->'retention') = 'object'
       AND btrim(NEW."manifest_json"->'retention'->>'status') = 'expired'
       AND (
         OLD."manifest_json" #- '{retention,status}' #- '{retention,expiresAt}'
       ) IS NOT DISTINCT FROM (
         NEW."manifest_json" #- '{retention,status}' #- '{retention,expiresAt}'
       ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'ai_support_bundle_requests_evidence_update_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_support_bundle_requests_evidence_update_restrict_check';
  END IF;

  RAISE EXCEPTION
    'ai_support_bundle_requests_evidence_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_support_bundle_requests_evidence_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_support_bundle_requests_evidence_update_restrict_check"
AFTER UPDATE
ON "ai_support_bundle_requests"
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_request_evidence_update_restrict();
