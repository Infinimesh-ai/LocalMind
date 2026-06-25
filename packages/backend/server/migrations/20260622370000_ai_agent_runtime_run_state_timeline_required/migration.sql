CREATE OR REPLACE FUNCTION ai_agent_run_state_timeline_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."timeline_fingerprint" IS NOT DISTINCT FROM
       NEW."timeline_fingerprint"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."queued_at" IS NOT DISTINCT FROM NEW."queued_at"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."worker_lease_expires_at" IS NOT DISTINCT FROM
       NEW."worker_lease_expires_at"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."worker_max_attempts" IS NOT DISTINCT FROM
       NEW."worker_max_attempts"
     AND OLD."last_attempt_at" IS NOT DISTINCT FROM NEW."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_agent_timeline_events" event
    WHERE event."run_id" = NEW."id"
      AND event."step_id" IS NULL
      AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
      AND event."event_type" IN ('run_status', 'run_cancellation')
      AND event."status" IS NOT DISTINCT FROM NEW."status"
      AND event."created_at" IS NOT DISTINCT FROM NEW."updated_at"
      AND event."payload"->>'workflow' IS NOT DISTINCT FROM NEW."workflow"
      AND event."payload"->>'sourceType' IS NOT DISTINCT FROM
        NEW."source_type"
      AND event."payload"->>'sourceId' IS NOT DISTINCT FROM NEW."source_id"
      AND (
        TG_OP = 'INSERT'
        OR (
          event."created_at" >= OLD."updated_at"
          AND (
            OLD."status" IS DISTINCT FROM NEW."status"
            OR
            event."created_at" > OLD."updated_at"
            OR event."payload"->>'previousStatus' IS NOT DISTINCT FROM
              OLD."status"
            OR (
              jsonb_typeof(event."payload"->'workerAttempt') = 'number'
              AND (event."payload"->>'workerAttempt') ~ '^[0-9]+$'
              AND (event."payload"->>'workerAttempt')::numeric =
                NEW."worker_attempt"
            )
          )
        )
      )
      AND (
        NOT (event."payload" ? 'workerLeaseId')
        OR NEW."worker_lease_id" IS NULL
        OR event."payload"->>'workerLeaseId' IS NOT DISTINCT FROM
          NEW."worker_lease_id"
      )
      AND (
        NOT (event."payload" ? 'failureCode')
        OR event."payload"->>'failureCode' IS NOT DISTINCT FROM
          NEW."failure_code"
      )
      AND (
        NOT (event."payload" ? 'failureMessage')
        OR event."payload"->>'failureMessage' IS NOT DISTINCT FROM
          NEW."failure_message"
      )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_runs_state_timeline_required_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_agent_runs_state_timeline_required_check';
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_agent_runs_state_timeline_required_check"
AFTER INSERT OR UPDATE OF
  "status",
  "timeline_fingerprint",
  "completed_at",
  "failure_code",
  "failure_message",
  "queued_at",
  "worker_lease_id",
  "worker_lease_expires_at",
  "worker_attempt",
  "worker_max_attempts",
  "last_attempt_at"
ON "ai_agent_runs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_agent_run_state_timeline_required();
