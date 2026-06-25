CREATE OR REPLACE FUNCTION
  ai_support_bundle_download_authorization_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_support_bundle_requests" bundle
    WHERE bundle."id" = OLD."bundle_id"
  ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_download_authorizations_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_support_bundle_download_authorizations_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_support_bundle_dl_auth_delete_restrict_check"
AFTER DELETE
ON "ai_support_bundle_download_authorizations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION
  ai_support_bundle_download_authorization_delete_restrict();
