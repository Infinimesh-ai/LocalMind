CREATE OR REPLACE FUNCTION ai_provider_health_state_event_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."provider_id" IS NOT DISTINCT FROM NEW."provider_id"
     AND OLD."provider_type" IS NOT DISTINCT FROM NEW."provider_type"
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."checked_at" IS NOT DISTINCT FROM NEW."checked_at"
     AND OLD."last_error" IS NOT DISTINCT FROM NEW."last_error"
     AND OLD."source" IS NOT DISTINCT FROM NEW."source"
     AND OLD."fingerprint" IS NOT DISTINCT FROM NEW."fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_provider_health_events" event
    WHERE event."state_id" = NEW."id"
      AND event."provider_id" IS NOT DISTINCT FROM NEW."provider_id"
      AND event."provider_type" IS NOT DISTINCT FROM NEW."provider_type"
      AND event."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
      AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
      AND event."status" IS NOT DISTINCT FROM NEW."status"
      AND event."checked_at" IS NOT DISTINCT FROM NEW."checked_at"
      AND event."last_error" IS NOT DISTINCT FROM NEW."last_error"
      AND event."source" IS NOT DISTINCT FROM NEW."source"
      AND event."state_fingerprint" IS NOT DISTINCT FROM NEW."fingerprint"
      AND event."metadata" IS NOT DISTINCT FROM NEW."metadata"
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_provider_health_states_event_history_required_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_provider_health_states_event_history_required_check';
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_provider_health_states_event_history_required_check"
AFTER INSERT OR UPDATE OF
  "provider_id",
  "provider_type",
  "scope_type",
  "workspace_id",
  "actor_id",
  "status",
  "checked_at",
  "last_error",
  "source",
  "fingerprint",
  "metadata"
ON "ai_provider_health_states"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_state_event_history_required();
