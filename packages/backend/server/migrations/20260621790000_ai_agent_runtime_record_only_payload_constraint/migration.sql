CREATE OR REPLACE FUNCTION ai_agent_runtime_record_only_payload_valid(
  value jsonb,
  payload_scope text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    payload_scope IN ('step_summary', 'step_timeline', 'run_timeline')
    AND jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'agent-runtime-record-only-execution/v1'
    AND jsonb_typeof(value->'executor') = 'string'
    AND btrim(value->>'executor') = 'agent_runtime_record_only_adapter'
    AND jsonb_typeof(value->'summary') = 'string'
    AND length(btrim(value->>'summary')) BETWEEN 1 AND 1024
    AND jsonb_typeof(value->'workerAttempt') = 'number'
    AND (value->>'workerAttempt') ~ '^[0-9]+$'
    AND (value->>'workerAttempt')::numeric > 0
    AND (value->>'workerAttempt')::numeric <= 1000000
    AND jsonb_typeof(value->'workerLeaseId') = 'string'
    AND length(btrim(value->>'workerLeaseId')) BETWEEN 1 AND 512
    AND (
      payload_scope <> 'run_timeline'
      OR (
        jsonb_typeof(value->'sideEffectsApplied') = 'boolean'
        AND (value->>'sideEffectsApplied')::boolean = false
        AND jsonb_typeof(value->'workerMaxAttempts') = 'number'
        AND (value->>'workerMaxAttempts') ~ '^[0-9]+$'
        AND (value->>'workerMaxAttempts')::numeric > 0
        AND (value->>'workerMaxAttempts')::numeric <= 1000000
        AND jsonb_typeof(value->'workflow') = 'string'
        AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceType') = 'string'
        AND length(btrim(value->>'sourceType')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceId') = 'string'
        AND length(btrim(value->>'sourceId')) BETWEEN 1 AND 512
      )
    )
    AND (
      payload_scope <> 'step_summary'
      OR (
        jsonb_typeof(value->'sideEffectsApplied') = 'boolean'
        AND (value->>'sideEffectsApplied')::boolean = false
      )
    )
    AND (
      payload_scope <> 'step_timeline'
      OR (
        jsonb_typeof(value->'stepKey') = 'string'
        AND length(btrim(value->>'stepKey')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'stepType') = 'string'
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
  ADD CONSTRAINT "ai_agent_steps_record_only_payload_check"
  CHECK (
    NOT ("output_summary" ? 'recordOnlyExecution')
    OR ai_agent_runtime_record_only_payload_valid(
      "output_summary"->'recordOnlyExecution',
      'step_summary'
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_record_only_payload_check"
  CHECK (
    "payload"->>'version' <> 'agent-runtime-record-only-execution/v1'
    OR ai_agent_runtime_record_only_payload_valid(
      "payload",
      CASE
        WHEN "event_type" = 'run_status' THEN 'run_timeline'
        ELSE 'step_timeline'
      END
    )
  ) NOT VALID;
