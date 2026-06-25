CREATE OR REPLACE FUNCTION ai_agent_runtime_adapter_resolution_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'agent-runtime-worker-adapter-resolution/v1'
    AND jsonb_typeof(value->'status') = 'string'
    AND btrim(value->>'status') IN (
      'unsupported_workflow',
      'unsupported_contract',
      'execution_failed',
      'invalid_executor_result',
      'incomplete_execution'
    )
    AND jsonb_typeof(value->'workflow') = 'string'
    AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
    AND jsonb_typeof(value->'requestedStepTypes') = 'array'
    AND jsonb_array_length(value->'requestedStepTypes') BETWEEN 1 AND 32
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value->'requestedStepTypes') AS "step"("item")
      WHERE jsonb_typeof("step"."item") <> 'string'
        OR btrim("step"."item"#>>'{}') NOT IN (
          'model',
          'tool',
          'approval',
          'handoff',
          'codex',
          'mcp'
        )
    ),
    false
  );
$$;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_worker_failure_adapter_resolution_check"
  CHECK (
    NOT (
      "output_summary" ? 'workerFailure'
      AND "output_summary"->'workerFailure' ? 'adapterResolution'
    )
    OR ai_agent_runtime_adapter_resolution_valid(
      "output_summary"->'workerFailure'->'adapterResolution'
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_adapter_resolution_check"
  CHECK (
    NOT ("payload" ? 'adapterResolution')
    OR ai_agent_runtime_adapter_resolution_valid("payload"->'adapterResolution')
  ) NOT VALID;
