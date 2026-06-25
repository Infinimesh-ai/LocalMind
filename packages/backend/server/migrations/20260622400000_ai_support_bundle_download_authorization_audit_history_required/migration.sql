CREATE OR REPLACE FUNCTION
  ai_support_bundle_download_authorization_audit_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."downloaded_at" IS NOT DISTINCT FROM NEW."downloaded_at" THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW."status" = 'authorized'
     AND EXISTS (
       SELECT 1
       FROM "ai_support_bundle_audit_events" event
       WHERE event."bundle_id" = NEW."bundle_id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."event_type" = 'download_authorized'
         AND event."created_at" >= NEW."created_at"
         AND COALESCE(
           event."metadata"->>'authorizationExpired',
           'false'
         ) <> 'true'
         AND event."metadata"->>'authorizationId' IS NOT DISTINCT FROM
           NEW."id"
         AND event."metadata"->>'authorizationFingerprint' IS NOT DISTINCT FROM
           NEW."authorization_fingerprint"
         AND event."metadata"->>'artifactKind' IS NOT DISTINCT FROM
           NEW."artifact_kind"
         AND event."metadata"->>'artifactFilename' IS NOT DISTINCT FROM
           NEW."artifact_filename"
         AND event."metadata"->>'artifactMime' IS NOT DISTINCT FROM
           NEW."artifact_mime"
         AND event."metadata"->>'deliveryMethod' IS NOT DISTINCT FROM
           NEW."delivery_method"
         AND event."metadata"->>'manifestFingerprint' IS NOT DISTINCT FROM
           NEW."manifest_fingerprint"
         AND event."metadata"->>'artifactFingerprint' IS NOT DISTINCT FROM
           NEW."artifact_fingerprint"
         AND event."metadata"->>'expiresAt' IS NOT NULL
         AND (
           NEW."direct_download_expires_at" IS NULL
           OR event."metadata"->>'directDownloadExpiresAt' IS NOT NULL
         )
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'downloaded'
     AND NEW."downloaded_at" IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM "ai_support_bundle_audit_events" event
       WHERE event."bundle_id" = NEW."bundle_id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."event_type" = 'downloaded'
         AND (
           TG_OP = 'INSERT'
           OR event."created_at" >= OLD."updated_at"
         )
         AND event."metadata"->>'authorizationId' IS NOT DISTINCT FROM
           NEW."id"
         AND event."metadata"->>'authorizationFingerprint' IS NOT DISTINCT FROM
           NEW."authorization_fingerprint"
         AND event."metadata"->>'artifactKind' IS NOT DISTINCT FROM
           NEW."artifact_kind"
         AND event."metadata"->>'artifactFilename' IS NOT DISTINCT FROM
           NEW."artifact_filename"
         AND event."metadata"->>'artifactMime' IS NOT DISTINCT FROM
           NEW."artifact_mime"
         AND event."metadata"->>'manifestFingerprint' IS NOT DISTINCT FROM
           NEW."manifest_fingerprint"
         AND event."metadata"->>'artifactFingerprint' IS NOT DISTINCT FROM
           NEW."artifact_fingerprint"
         AND (
           NOT (event."metadata" ? 'deliveryMethod')
           OR event."metadata"->>'deliveryMethod' IS NOT DISTINCT FROM
             NEW."delivery_method"
         )
         AND (
           NOT (event."metadata" ? 'authorizationActorId')
           OR event."metadata"->>'authorizationActorId' IS NOT DISTINCT FROM
             NEW."actor_id"
         )
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'expired'
     AND NEW."downloaded_at" IS NULL
     AND EXISTS (
       SELECT 1
       FROM "ai_support_bundle_audit_events" event
       WHERE event."bundle_id" = NEW."bundle_id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."event_type" = 'download_authorized'
         AND (
           TG_OP = 'INSERT'
           OR event."created_at" >= OLD."updated_at"
         )
         AND event."metadata"->'authorizationExpired' = 'true'::jsonb
         AND event."metadata"->>'authorizationId' IS NOT DISTINCT FROM
           NEW."id"
         AND event."metadata"->>'authorizationFingerprint' IS NOT DISTINCT FROM
           NEW."authorization_fingerprint"
         AND event."metadata"->>'artifactKind' IS NOT DISTINCT FROM
           NEW."artifact_kind"
         AND event."metadata"->>'artifactFingerprint' IS NOT DISTINCT FROM
           NEW."artifact_fingerprint"
         AND (
           NOT (event."metadata" ? 'deliveryMethod')
           OR event."metadata"->>'deliveryMethod' IS NOT DISTINCT FROM
             NEW."delivery_method"
         )
         AND event."metadata"->>'previousStatus' = 'authorized'
         AND event."metadata"->>'status' = 'expired'
         AND event."metadata"->>'cleanupFingerprint' IS NOT NULL
         AND event."metadata"->>'cleanupScope' IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_support_bundle_download_authorizations_audit_history_required_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_support_bundle_download_authorizations_audit_history_required_check';
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_support_bundle_dl_auth_audit_history_required_check"
AFTER INSERT OR UPDATE OF
  "status",
  "downloaded_at"
ON "ai_support_bundle_download_authorizations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION
  ai_support_bundle_download_authorization_audit_history_required();
