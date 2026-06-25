CREATE OR REPLACE FUNCTION ai_support_bundle_transfer_event_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."authorization_id" IS NOT DISTINCT FROM NEW."authorization_id"
     AND OLD."bundle_id" IS NOT DISTINCT FROM NEW."bundle_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."artifact_kind" IS NOT DISTINCT FROM NEW."artifact_kind"
     AND OLD."manifest_fingerprint" IS NOT DISTINCT FROM
       NEW."manifest_fingerprint"
     AND OLD."artifact_fingerprint" IS NOT DISTINCT FROM
       NEW."artifact_fingerprint"
     AND OLD."authorization_fingerprint" IS NOT DISTINCT FROM
       NEW."authorization_fingerprint"
     AND OLD."delivery_method" IS NOT DISTINCT FROM NEW."delivery_method"
     AND OLD."event_id" IS NOT DISTINCT FROM NEW."event_id"
     AND OLD."event_source" IS NOT DISTINCT FROM NEW."event_source"
     AND OLD."transferred_at" IS NOT DISTINCT FROM NEW."transferred_at"
     AND OLD."notification_auth_evidence" IS NOT DISTINCT FROM
       NEW."notification_auth_evidence"
     AND OLD."notification_auth_evidence_fingerprint" IS NOT DISTINCT FROM
       NEW."notification_auth_evidence_fingerprint"
     AND OLD."storage_key" IS NOT DISTINCT FROM NEW."storage_key"
     AND OLD."storage_byte_size" IS NOT DISTINCT FROM NEW."storage_byte_size"
     AND OLD."storage_content_type" IS NOT DISTINCT FROM
       NEW."storage_content_type"
     AND OLD."event_fingerprint" IS NOT DISTINCT FROM
       NEW."event_fingerprint"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_support_bundle_transfer_events_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_support_bundle_transfer_events_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_support_bundle_transfer_events_content_update_restrict_check"
AFTER UPDATE
ON "ai_support_bundle_transfer_events"
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_transfer_event_content_update_restrict();
