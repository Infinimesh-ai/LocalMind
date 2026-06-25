CREATE OR REPLACE FUNCTION ai_provider_health_event_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."state_id" IS NOT DISTINCT FROM NEW."state_id"
     AND OLD."provider_id" IS NOT DISTINCT FROM NEW."provider_id"
     AND OLD."provider_type" IS NOT DISTINCT FROM NEW."provider_type"
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."checked_at" IS NOT DISTINCT FROM NEW."checked_at"
     AND OLD."last_error" IS NOT DISTINCT FROM NEW."last_error"
     AND OLD."source" IS NOT DISTINCT FROM NEW."source"
     AND OLD."event_type" IS NOT DISTINCT FROM NEW."event_type"
     AND OLD."fingerprint" IS NOT DISTINCT FROM NEW."fingerprint"
     AND OLD."state_fingerprint" IS NOT DISTINCT FROM
       NEW."state_fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_provider_health_events_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_provider_health_events_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_provider_health_events_content_update_restrict_check"
AFTER UPDATE
ON "ai_provider_health_events"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_event_content_update_restrict();
