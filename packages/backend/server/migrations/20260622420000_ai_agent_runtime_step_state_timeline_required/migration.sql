CREATE OR REPLACE FUNCTION ai_agent_runtime_manual_control_payload_valid(
  value jsonb,
  payload_scope text,
  expected_action text,
  expected_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    payload_scope IN ('step_summary', 'timeline')
    AND expected_action IN ('cancel', 'resume')
    AND (
      expected_status IS NULL
      OR expected_status IN (
        'queued',
        'cancelled',
        'pending',
        'skipped',
        'completed'
      )
    )
    AND jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'agent-runtime-manual-control/v1'
    AND jsonb_typeof(value->'action') = 'string'
    AND btrim(value->>'action') = expected_action
    AND jsonb_typeof(value->'actorId') = 'string'
    AND length(btrim(value->>'actorId')) BETWEEN 1 AND 512
    AND (
      NOT (value ? 'reason')
      OR value->'reason' = 'null'::jsonb
      OR (
        jsonb_typeof(value->'reason') = 'string'
        AND length(btrim(value->>'reason')) BETWEEN 1 AND 1024
      )
    )
    AND (
      payload_scope <> 'timeline'
      OR (
        expected_status IS NOT NULL
        AND jsonb_typeof(value->'previousStatus') = 'string'
        AND btrim(value->>'previousStatus') IN (
          'queued',
          'running',
          'waiting_approval',
          'completed',
          'failed',
          'cancelled',
          'pending',
          'skipped'
        )
        AND jsonb_typeof(value->'workflow') = 'string'
        AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceType') = 'string'
        AND length(btrim(value->>'sourceType')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceId') = 'string'
        AND length(btrim(value->>'sourceId')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'controlledAt') = 'string'
        AND length(btrim(value->>'controlledAt')) BETWEEN 1 AND 128
        AND (
          (
            expected_action = 'cancel'
            AND expected_status IN ('cancelled', 'skipped')
          )
          OR (
            expected_action = 'resume'
            AND expected_status IN ('queued', 'pending', 'completed')
          )
        )
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_agent_runtime_stale_lease_payload_valid(
  value jsonb,
  payload_scope text,
  event_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    payload_scope IN ('step_summary', 'timeline')
    AND jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'agent-runtime-stale-lease-recovery/v1'
    AND jsonb_typeof(value->'executor') = 'string'
    AND btrim(value->>'executor') = 'agent_runtime_stale_recovery_worker'
    AND jsonb_typeof(value->'reason') = 'string'
    AND length(btrim(value->>'reason')) BETWEEN 1 AND 1024
    AND jsonb_typeof(value->'retryScheduled') = 'boolean'
    AND jsonb_typeof(value->'nextStatus') = 'string'
    AND btrim(value->>'nextStatus') IN ('queued', 'failed', 'pending')
    AND (
      (
        (value->>'retryScheduled')::boolean = true
        AND btrim(value->>'nextStatus') IN ('queued', 'pending')
      )
      OR (
        (value->>'retryScheduled')::boolean = false
        AND btrim(value->>'nextStatus') = 'failed'
      )
    )
    AND jsonb_typeof(value->'workerAttempt') = 'number'
    AND (value->>'workerAttempt') ~ '^[0-9]+$'
    AND (value->>'workerAttempt')::numeric > 0
    AND (value->>'workerAttempt')::numeric <= 1000000
    AND jsonb_typeof(value->'workerMaxAttempts') = 'number'
    AND (value->>'workerMaxAttempts') ~ '^[0-9]+$'
    AND (value->>'workerMaxAttempts')::numeric > 0
    AND (value->>'workerMaxAttempts')::numeric <= 1000000
    AND (value->>'workerAttempt')::numeric <=
      (value->>'workerMaxAttempts')::numeric
    AND jsonb_typeof(value->'previousWorkerLeaseId') = 'string'
    AND length(btrim(value->>'previousWorkerLeaseId')) BETWEEN 1 AND 512
    AND jsonb_typeof(value->'previousWorkerLeaseExpiresAt') = 'string'
    AND length(btrim(value->>'previousWorkerLeaseExpiresAt')) BETWEEN 1 AND 128
    AND (
      payload_scope <> 'timeline'
      OR (
        event_status IN ('queued', 'failed', 'pending')
        AND (
          btrim(value->>'nextStatus') = event_status
          OR (
            btrim(value->>'nextStatus') = 'pending'
            AND event_status = 'queued'
          )
        )
        AND jsonb_typeof(value->'previousStatus') = 'string'
        AND btrim(value->>'previousStatus') IN (
          'running',
          'pending',
          'waiting_approval'
        )
        AND jsonb_typeof(value->'workflow') = 'string'
        AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceType') = 'string'
        AND length(btrim(value->>'sourceType')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceId') = 'string'
        AND length(btrim(value->>'sourceId')) BETWEEN 1 AND 512
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_agent_timeline_events"
  DROP CONSTRAINT "ai_agent_timeline_manual_control_payload_check";

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_manual_control_payload_check"
  CHECK (
    "payload"->>'version' <> 'agent-runtime-manual-control/v1'
    OR ai_agent_runtime_manual_control_payload_valid(
      "payload",
      'timeline',
      CASE
        WHEN "event_type" = 'run_cancellation' THEN 'cancel'
        WHEN "event_type" = 'run_status' THEN 'resume'
        ELSE "payload"->>'action'
      END,
      "status"
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION ai_agent_step_state_timeline_required()
RETURNS trigger AS $$
DECLARE
  step_event_type text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."started_at" IS NOT DISTINCT FROM NEW."started_at"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at" THEN
    RETURN NEW;
  END IF;

  step_event_type := CASE NEW."step_type"
    WHEN 'approval' THEN 'approval_step'
    WHEN 'codex' THEN 'codex_step'
    WHEN 'handoff' THEN 'handoff_step'
    WHEN 'mcp' THEN 'mcp_step'
    WHEN 'tool' THEN 'tool_step'
    ELSE 'model_step'
  END;

  IF EXISTS (
    SELECT 1
    FROM "ai_agent_timeline_events" event
    WHERE event."run_id" = NEW."run_id"
      AND event."step_id" = NEW."id"
      AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
      AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
      AND event."event_type" IN (step_event_type, 'step_output', 'step_error')
      AND event."status" IS NOT DISTINCT FROM NEW."status"
      AND event."created_at" IS NOT DISTINCT FROM NEW."updated_at"
      AND (
        NOT (event."payload" ? 'stepKey')
        OR event."payload"->>'stepKey' IS NOT DISTINCT FROM NEW."step_key"
      )
      AND (
        NOT (event."payload" ? 'stepType')
        OR event."payload"->>'stepType' IS NOT DISTINCT FROM NEW."step_type"
      )
      AND (
        TG_OP = 'INSERT'
        OR event."created_at" >= OLD."updated_at"
      )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_steps_state_timeline_required_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_agent_steps_state_timeline_required_check';
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_agent_steps_state_timeline_required_check"
AFTER INSERT OR UPDATE OF
  "status",
  "started_at",
  "completed_at"
ON "ai_agent_steps"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_agent_step_state_timeline_required();
