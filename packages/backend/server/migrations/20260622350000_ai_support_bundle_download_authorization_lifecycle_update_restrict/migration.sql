CREATE OR REPLACE FUNCTION
  ai_support_bundle_download_authorization_lifecycle_update_restrict()
RETURNS trigger AS $$
DECLARE
  parent_bundle RECORD;
BEGIN
  IF OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."downloaded_at" IS NOT DISTINCT FROM NEW."downloaded_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'authorized'
     AND NEW."status" = 'downloaded'
     AND OLD."downloaded_at" IS NULL
     AND NEW."downloaded_at" IS NOT NULL
     AND NEW."downloaded_at" >= OLD."created_at"
     AND NEW."downloaded_at" <= OLD."expires_at"
     AND (
       OLD."direct_download_expires_at" IS NULL
       OR NEW."downloaded_at" <= OLD."direct_download_expires_at"
     ) THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'authorized'
     AND NEW."status" = 'expired'
     AND OLD."downloaded_at" IS NULL
     AND NEW."downloaded_at" IS NULL THEN
    IF CURRENT_TIMESTAMP >= OLD."expires_at"
       OR (
         OLD."direct_download_expires_at" IS NOT NULL
         AND CURRENT_TIMESTAMP >= OLD."direct_download_expires_at"
       ) THEN
      RETURN NEW;
    END IF;

    SELECT b."status", b."retention_status", b."expires_at"
    INTO parent_bundle
    FROM "ai_support_bundle_requests" b
    WHERE b."id" = OLD."bundle_id";

    IF FOUND
       AND (
         parent_bundle."status" = 'expired'
         OR parent_bundle."retention_status" = 'expired'
         OR CURRENT_TIMESTAMP >= parent_bundle."expires_at"
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'ai_support_bundle_download_authorizations_lifecycle_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_support_bundle_download_authorizations_lifecycle_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER
  "zz_ai_support_bundle_download_authorizations_lifecycle_update_restrict_check"
AFTER UPDATE OF
  "status",
  "downloaded_at"
ON "ai_support_bundle_download_authorizations"
FOR EACH ROW
EXECUTE FUNCTION
  ai_support_bundle_download_authorization_lifecycle_update_restrict();
