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
    AND btrim(value->>'nextStatus') IN ('queued', 'failed')
    AND (
      (
        (value->>'retryScheduled')::boolean = true
        AND btrim(value->>'nextStatus') = 'queued'
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
    AND (value->>'workerAttempt')::numeric <= (value->>'workerMaxAttempts')::numeric
    AND jsonb_typeof(value->'previousWorkerLeaseId') = 'string'
    AND length(btrim(value->>'previousWorkerLeaseId')) BETWEEN 1 AND 512
    AND jsonb_typeof(value->'previousWorkerLeaseExpiresAt') = 'string'
    AND length(btrim(value->>'previousWorkerLeaseExpiresAt')) BETWEEN 1 AND 128
    AND (
      payload_scope <> 'timeline'
      OR (
        event_status IN ('queued', 'failed')
        AND btrim(value->>'nextStatus') = event_status
        AND jsonb_typeof(value->'previousStatus') = 'string'
        AND btrim(value->>'previousStatus') = 'running'
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

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_stale_lease_payload_check"
  CHECK (
    NOT ("output_summary" ? 'staleLeaseRecovery')
    OR ai_agent_runtime_stale_lease_payload_valid(
      "output_summary"->'staleLeaseRecovery',
      'step_summary',
      NULL
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_stale_lease_payload_check"
  CHECK (
    "payload"->>'version' <> 'agent-runtime-stale-lease-recovery/v1'
    OR ai_agent_runtime_stale_lease_payload_valid(
      "payload",
      'timeline',
      "status"
    )
  ) NOT VALID;
