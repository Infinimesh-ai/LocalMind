CREATE OR REPLACE FUNCTION ai_agent_timeline_event_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."run_id" IS NOT DISTINCT FROM NEW."run_id"
     AND OLD."step_id" IS NOT DISTINCT FROM NEW."step_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."event_type" IS NOT DISTINCT FROM NEW."event_type"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."ordinal" IS NOT DISTINCT FROM NEW."ordinal"
     AND OLD."summary" IS NOT DISTINCT FROM NEW."summary"
     AND OLD."payload" IS NOT DISTINCT FROM NEW."payload"
     AND OLD."event_fingerprint" IS NOT DISTINCT FROM
       NEW."event_fingerprint"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_timeline_events_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_agent_timeline_events_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_agent_timeline_events_content_update_restrict_check"
AFTER UPDATE
ON "ai_agent_timeline_events"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_timeline_event_content_update_restrict();
