CREATE OR REPLACE FUNCTION ai_repair_execution_audit_event_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_repair_execution_requests" request
    WHERE request."id" = OLD."execution_request_id"
  ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_audit_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_repair_execution_audit_events_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_repair_exec_audit_events_delete_restrict_check"
AFTER DELETE
ON "ai_repair_execution_audit_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_audit_event_delete_restrict();

CREATE OR REPLACE FUNCTION ai_support_bundle_audit_event_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_support_bundle_requests" bundle
    WHERE bundle."id" = OLD."bundle_id"
  ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_audit_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_support_bundle_audit_events_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_support_bundle_audit_events_delete_restrict_check"
AFTER DELETE
ON "ai_support_bundle_audit_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_audit_event_delete_restrict();
