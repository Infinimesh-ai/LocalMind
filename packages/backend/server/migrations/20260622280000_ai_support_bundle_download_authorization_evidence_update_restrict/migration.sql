CREATE OR REPLACE FUNCTION
  ai_support_bundle_download_authorization_evidence_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."bundle_id" IS NOT DISTINCT FROM NEW."bundle_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."artifact_kind" IS NOT DISTINCT FROM NEW."artifact_kind"
     AND OLD."artifact_filename" IS NOT DISTINCT FROM
       NEW."artifact_filename"
     AND OLD."artifact_mime" IS NOT DISTINCT FROM NEW."artifact_mime"
     AND OLD."manifest_fingerprint" IS NOT DISTINCT FROM
       NEW."manifest_fingerprint"
     AND OLD."artifact_fingerprint" IS NOT DISTINCT FROM
       NEW."artifact_fingerprint"
     AND OLD."authorization_fingerprint" IS NOT DISTINCT FROM
       NEW."authorization_fingerprint"
     AND OLD."token_fingerprint" IS NOT DISTINCT FROM
       NEW."token_fingerprint"
     AND OLD."delivery_method" IS NOT DISTINCT FROM NEW."delivery_method"
     AND OLD."direct_download_url" IS NOT DISTINCT FROM
       NEW."direct_download_url"
     AND OLD."direct_download_expires_at" IS NOT DISTINCT FROM
       NEW."direct_download_expires_at"
     AND OLD."expires_at" IS NOT DISTINCT FROM NEW."expires_at"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_support_bundle_download_authorizations_evidence_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_support_bundle_download_authorizations_evidence_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER
  "zz_ai_support_bundle_download_authorizations_evidence_update_restrict_check"
AFTER UPDATE
ON "ai_support_bundle_download_authorizations"
FOR EACH ROW
EXECUTE FUNCTION
  ai_support_bundle_download_authorization_evidence_update_restrict();
