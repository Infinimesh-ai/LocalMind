CREATE OR REPLACE FUNCTION ai_provider_health_state_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."workspace_id" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM "workspaces" workspace
       WHERE workspace."id" = OLD."workspace_id"
     ) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_provider_health_events" event
    WHERE event."state_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION
      'ai_provider_health_states_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_provider_health_states_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_health_states_delete_restrict_check"
BEFORE DELETE
ON "ai_provider_health_states"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_state_delete_restrict();

CREATE OR REPLACE FUNCTION ai_provider_health_event_delete_restrict_immediate()
RETURNS trigger AS $$
BEGIN
  IF OLD."workspace_id" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM "workspaces" workspace
       WHERE workspace."id" = OLD."workspace_id"
     ) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_provider_health_states" state
    WHERE state."id" = OLD."state_id"
  ) THEN
    RAISE EXCEPTION
      'ai_provider_health_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_provider_health_events_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_health_events_delete_restrict_immediate_check"
BEFORE DELETE
ON "ai_provider_health_events"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_event_delete_restrict_immediate();
