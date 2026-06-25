CREATE OR REPLACE FUNCTION ai_repair_execution_approval_audit_required()
RETURNS trigger AS $$
DECLARE
  required_event_type text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."approval_state" IS NOT DISTINCT FROM NEW."approval_state" THEN
    RETURN NEW;
  END IF;

  required_event_type := CASE NEW."approval_state"
    WHEN 'approved' THEN 'approval_approved'
    WHEN 'rejected' THEN 'approval_rejected'
    ELSE NULL
  END;

  IF required_event_type IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_repair_execution_audit_events" event
    WHERE event."execution_request_id" = NEW."id"
      AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
      AND event."event_type" = required_event_type
      AND (
        TG_OP = 'INSERT'
        OR event."created_at" >= OLD."updated_at"
      )
      AND (
        NOT (event."metadata" ? 'decision')
        OR event."metadata"->>'decision' IS NOT DISTINCT FROM
          CASE NEW."approval_state"
            WHEN 'approved' THEN 'approve'
            WHEN 'rejected' THEN 'reject'
          END
      )
  ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_requests_approval_audit_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_repair_execution_requests_approval_audit_required_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_repair_execution_approval_audit_required_check"
AFTER INSERT OR UPDATE OF "approval_state"
ON "ai_repair_execution_requests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_approval_audit_required();
