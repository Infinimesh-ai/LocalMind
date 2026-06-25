CREATE OR REPLACE FUNCTION ai_agent_runtime_worker_lease_payload_valid(
  value jsonb,
  step_payload boolean,
  require_context boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = CASE
      WHEN step_payload THEN 'agent-runtime-worker-step-lease/v1'
      ELSE 'agent-runtime-worker-lease/v1'
    END
    AND jsonb_typeof(value->'executor') = 'string'
    AND btrim(value->>'executor') = 'agent_runtime_worker'
    AND jsonb_typeof(value->'workerAttempt') = 'number'
    AND (value->>'workerAttempt') ~ '^[0-9]+$'
    AND (value->>'workerAttempt')::numeric > 0
    AND (value->>'workerAttempt')::numeric <= 1000000
    AND jsonb_typeof(value->'workerLeaseId') = 'string'
    AND length(btrim(value->>'workerLeaseId')) BETWEEN 1 AND 512
    AND (
      step_payload
      OR (
        jsonb_typeof(value->'workerLeaseExpiresAt') = 'string'
        AND length(btrim(value->>'workerLeaseExpiresAt')) BETWEEN 1 AND 128
      )
    )
    AND (
      NOT require_context
      OR (
        jsonb_typeof(value->'workflow') = 'string'
        AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceType') = 'string'
        AND length(btrim(value->>'sourceType')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceId') = 'string'
        AND length(btrim(value->>'sourceId')) BETWEEN 1 AND 512
      )
    )
    AND (
      value->>'version' <> 'agent-runtime-worker-step-lease/v1'
      OR (
        NOT require_context
        AND NOT (value ? 'stepKey')
      )
      OR (
        jsonb_typeof(value->'stepKey') = 'string'
        AND length(btrim(value->>'stepKey')) BETWEEN 1 AND 512
      )
    )
    AND (
      value->>'version' <> 'agent-runtime-worker-step-lease/v1'
      OR (
        NOT require_context
        AND NOT (value ? 'stepType')
      )
      OR (
        jsonb_typeof(value->'stepType') = 'string'
        AND btrim(value->>'stepType') IN (
          'approval',
          'codex',
          'handoff',
          'mcp',
          'model',
          'tool'
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_worker_lease_payload_check"
  CHECK (
    NOT ("output_summary" ? 'workerLease')
    OR ai_agent_runtime_worker_lease_payload_valid(
      "output_summary"->'workerLease',
      true,
      false
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_worker_lease_payload_check"
  CHECK (
    NOT (
      "payload"->>'version' IN (
        'agent-runtime-worker-lease/v1',
        'agent-runtime-worker-step-lease/v1'
      )
    )
    OR ai_agent_runtime_worker_lease_payload_valid(
      "payload",
      "payload"->>'version' = 'agent-runtime-worker-step-lease/v1',
      true
    )
  ) NOT VALID;
