CREATE OR REPLACE FUNCTION ai_support_bundle_transfer_event_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_support_bundle_download_authorizations" auth
    WHERE auth."id" = OLD."authorization_id"
  ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_transfer_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_support_bundle_transfer_events_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_support_bundle_transfer_events_delete_restrict_check"
AFTER DELETE
ON "ai_support_bundle_transfer_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_transfer_event_delete_restrict();

CREATE OR REPLACE FUNCTION ai_provider_health_event_delete_restrict()
RETURNS trigger AS $$
BEGIN
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

CREATE CONSTRAINT TRIGGER
  "zz_ai_provider_health_events_delete_restrict_check"
AFTER DELETE
ON "ai_provider_health_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_provider_health_event_delete_restrict();
