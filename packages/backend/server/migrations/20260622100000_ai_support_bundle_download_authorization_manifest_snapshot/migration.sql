CREATE OR REPLACE FUNCTION ai_support_bundle_authorization_manifest_snapshot_valid()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_support_bundle_requests" bundle
    WHERE bundle."id" = NEW."bundle_id"
      AND bundle."workspace_id" = NEW."workspace_id"
      AND bundle."manifest_fingerprint" = NEW."manifest_fingerprint"
  ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_download_authorizations_manifest_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_support_bundle_download_authorizations_manifest_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_support_bundle_download_authorizations_manifest_snapshot_check"
BEFORE INSERT OR UPDATE OF "bundle_id", "manifest_fingerprint"
ON "ai_support_bundle_download_authorizations"
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_authorization_manifest_snapshot_valid();
