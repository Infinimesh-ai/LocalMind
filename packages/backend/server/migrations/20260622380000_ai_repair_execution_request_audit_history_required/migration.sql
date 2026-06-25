CREATE OR REPLACE FUNCTION ai_repair_execution_request_audit_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."approval_state" IS NOT DISTINCT FROM NEW."approval_state"
     AND OLD."runtime_result" IS NOT DISTINCT FROM NEW."runtime_result"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."queued_at" IS NOT DISTINCT FROM NEW."queued_at"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."worker_lease_expires_at" IS NOT DISTINCT FROM
       NEW."worker_lease_expires_at"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."worker_max_attempts" IS NOT DISTINCT FROM
       NEW."worker_max_attempts"
     AND OLD."last_attempt_at" IS NOT DISTINCT FROM NEW."last_attempt_at"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at" THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_repair_execution_audit_events" event
       WHERE event."execution_request_id" = NEW."id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
         AND event."event_type" = 'requested'
         AND event."created_at" >= NEW."created_at"
     ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_requests_audit_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_repair_execution_requests_audit_history_required_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_repair_execution_audit_events" event
    WHERE event."execution_request_id" = NEW."id"
      AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
      AND (
        event."event_type" IS NOT DISTINCT FROM NEW."status"
        OR (
          NEW."status" = 'queued'
          AND event."event_type" = 'retry_scheduled'
          AND event."metadata"->>'nextStatus' = 'queued'
        )
      )
      AND (
        TG_OP = 'INSERT'
        OR event."created_at" >= OLD."updated_at"
      )
      AND (
        NOT (event."metadata" ? 'approvalState')
        OR event."metadata"->>'approvalState' IS NOT DISTINCT FROM
          NEW."approval_state"
      )
      AND (
        NOT (event."metadata" ? 'sideEffectsApplied')
        OR event."metadata"->'sideEffectsApplied' IS NOT DISTINCT FROM
          NEW."runtime_result"->'sideEffectsApplied'
      )
      AND (
        NEW."failure_code" IS NULL
        OR NOT (event."metadata" ? 'failureCode')
        OR event."metadata"->>'failureCode' IS NOT DISTINCT FROM
          NEW."failure_code"
      )
      AND (
        NEW."failure_message" IS NULL
        OR NOT (event."metadata" ? 'failureMessage')
        OR event."metadata"->>'failureMessage' IS NOT DISTINCT FROM
          NEW."failure_message"
      )
      AND (
        NOT (event."metadata" ? 'workerAttempt')
        OR (
          jsonb_typeof(event."metadata"->'workerAttempt') = 'number'
          AND (event."metadata"->>'workerAttempt') ~ '^[0-9]+$'
          AND (event."metadata"->>'workerAttempt')::numeric =
            NEW."worker_attempt"
        )
      )
      AND (
        NOT (event."metadata" ? 'workerMaxAttempts')
        OR (
          jsonb_typeof(event."metadata"->'workerMaxAttempts') = 'number'
          AND (event."metadata"->>'workerMaxAttempts') ~ '^[0-9]+$'
          AND (event."metadata"->>'workerMaxAttempts')::numeric =
            NEW."worker_max_attempts"
        )
      )
      AND (
        NOT (event."metadata" ? 'workerLeaseId')
        OR NEW."worker_lease_id" IS NULL
        OR event."metadata"->>'workerLeaseId' IS NOT DISTINCT FROM
          NEW."worker_lease_id"
      )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_repair_execution_requests_audit_history_required_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_repair_execution_requests_audit_history_required_check';
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_repair_execution_requests_audit_history_required_check"
AFTER INSERT OR UPDATE OF
  "status",
  "approval_state",
  "runtime_result",
  "failure_code",
  "failure_message",
  "queued_at",
  "worker_lease_id",
  "worker_lease_expires_at",
  "worker_attempt",
  "worker_max_attempts",
  "last_attempt_at",
  "completed_at"
ON "ai_repair_execution_requests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_request_audit_history_required();
