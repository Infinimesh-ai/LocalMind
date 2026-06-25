CREATE OR REPLACE FUNCTION ai_provider_health_event_write_snapshot_valid()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_provider_health_states" state
    WHERE state."id" = NEW."state_id"
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."state_id" IS NOT DISTINCT FROM NEW."state_id"
     AND OLD."state_fingerprint" IS NOT DISTINCT FROM NEW."state_fingerprint"
     AND OLD."actor_id" IS DISTINCT FROM NEW."actor_id"
     AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_provider_health_states" state
    WHERE state."id" = NEW."state_id"
      AND state."fingerprint" = NEW."state_fingerprint"
      AND state."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
  ) THEN
    RAISE EXCEPTION
      'ai_provider_health_events_write_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_provider_health_events_write_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_health_events_write_snapshot_check"
BEFORE INSERT OR UPDATE OF "state_id", "actor_id", "state_fingerprint"
ON "ai_provider_health_events"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_event_write_snapshot_valid();
