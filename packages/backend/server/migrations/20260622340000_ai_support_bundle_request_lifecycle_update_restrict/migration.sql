CREATE OR REPLACE FUNCTION
  ai_support_bundle_request_lifecycle_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."retention_status" IS NOT DISTINCT FROM NEW."retention_status"
     AND OLD."manifest_json" IS NOT DISTINCT FROM NEW."manifest_json"
     AND OLD."manifest_fingerprint" IS NOT DISTINCT FROM
       NEW."manifest_fingerprint"
     AND OLD."manifest_byte_size" IS NOT DISTINCT FROM NEW."manifest_byte_size"
     AND OLD."expires_at" IS NOT DISTINCT FROM NEW."expires_at"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message" THEN
    RETURN NEW;
  END IF;

  IF OLD."retention_status" = 'active'
     AND NEW."status" = 'expired'
     AND NEW."retention_status" = 'expired'
     AND CURRENT_TIMESTAMP >= OLD."expires_at"
     AND OLD."expires_at" IS NOT DISTINCT FROM NEW."expires_at"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
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
    'ai_support_bundle_requests_lifecycle_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_support_bundle_requests_lifecycle_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_support_bundle_requests_lifecycle_update_restrict_check"
AFTER UPDATE OF
  "status",
  "retention_status",
  "manifest_json",
  "manifest_fingerprint",
  "manifest_byte_size",
  "expires_at",
  "failure_code",
  "failure_message"
ON "ai_support_bundle_requests"
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_request_lifecycle_update_restrict();
