CREATE OR REPLACE FUNCTION ai_repair_execution_audit_event_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."execution_request_id" IS NOT DISTINCT FROM
       NEW."execution_request_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."event_type" IS NOT DISTINCT FROM NEW."event_type"
     AND OLD."event_fingerprint" IS NOT DISTINCT FROM
       NEW."event_fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_repair_execution_audit_events_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_repair_execution_audit_events_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_repair_execution_audit_events_content_update_restrict_check"
AFTER UPDATE
ON "ai_repair_execution_audit_events"
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_audit_event_content_update_restrict();
