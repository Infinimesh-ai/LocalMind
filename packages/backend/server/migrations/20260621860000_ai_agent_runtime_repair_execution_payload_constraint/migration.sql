CREATE OR REPLACE FUNCTION ai_agent_runtime_repair_payload_bounded_string(
  value jsonb,
  field_name text,
  max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value->field_name) = 'string'
    AND length(btrim(value->>field_name)) BETWEEN 1 AND max_length,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_agent_runtime_repair_run_payload_valid(
  value jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'agent-runtime-repair-execution-run/v1'
    AND jsonb_typeof(value->'workflow') = 'string'
    AND btrim(value->>'workflow') = 'prompt_registry_repair_execution'
    AND jsonb_typeof(value->'sourceType') = 'string'
    AND btrim(value->>'sourceType') = 'repair_execution_request'
    AND ai_agent_runtime_repair_payload_bounded_string(value, 'sourceId', 512)
    AND ai_agent_runtime_repair_payload_bounded_string(
      value,
      'requestFingerprint',
      512
    )
    AND ai_agent_runtime_repair_payload_bounded_string(
      value,
      'repairJobFingerprint',
      512
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_agent_runtime_repair_step_payload_valid(
  value jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'agent-runtime-repair-execution-step/v1'
    AND ai_agent_runtime_repair_payload_bounded_string(
      value,
      'repairExecutionRequestId',
      512
    )
    AND jsonb_typeof(value->'approvalState') = 'string'
    AND btrim(value->>'approvalState') IN (
      'not_required',
      'waiting',
      'approved',
      'rejected'
    )
    AND jsonb_typeof(value->'permissionStatus') = 'string'
    AND btrim(value->>'permissionStatus') = 'granted'
    AND ai_agent_runtime_repair_payload_bounded_string(
      value,
      'runtimeExecutor',
      512
    )
    AND jsonb_typeof(value->'sideEffectsApplied') = 'boolean'
    AND (
      value->'sideEffectsApplied' = 'false'::jsonb
      OR (
        ai_agent_runtime_repair_payload_bounded_string(
          value,
          'sideEffectKind',
          512
        )
        AND ai_agent_runtime_repair_payload_bounded_string(
          value,
          'sideEffectRecordId',
          512
        )
        AND ai_agent_runtime_repair_payload_bounded_string(
          value,
          'sideEffectFingerprint',
          128
        )
        AND jsonb_typeof(value->'sideEffectRollbackContract') = 'object'
        AND jsonb_typeof(value->'sideEffectRollbackContract'->'version') = 'string'
        AND btrim(value->'sideEffectRollbackContract'->>'version') =
          'repair-execution-side-effect-rollback-contract/v1'
        AND value->'sideEffectRollbackContract'->'supported' = 'false'::jsonb
        AND jsonb_typeof(value->'sideEffectRollbackContract'->'mode') = 'string'
        AND btrim(value->'sideEffectRollbackContract'->>'mode') =
          'forward_only_followup_revision'
        AND jsonb_typeof(value->'sideEffectRollbackContract'->'recoveryPath') =
          'string'
        AND btrim(value->'sideEffectRollbackContract'->>'recoveryPath') =
          'publish_follow_up_registry_revision'
        AND ai_agent_runtime_repair_payload_bounded_string(
          value->'sideEffectRollbackContract',
          'reason',
          512
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_repair_execution_payload_check"
  CHECK (
    btrim(COALESCE("output_summary"->>'version', '')) <>
      'agent-runtime-repair-execution-step/v1'
    OR ai_agent_runtime_repair_step_payload_valid("output_summary")
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_repair_execution_payload_check"
  CHECK (
    (
      btrim(COALESCE("payload"->>'version', '')) <>
        'agent-runtime-repair-execution-run/v1'
      OR ai_agent_runtime_repair_run_payload_valid("payload")
    )
    AND (
      btrim(COALESCE("payload"->>'version', '')) <>
        'agent-runtime-repair-execution-step/v1'
      OR ai_agent_runtime_repair_step_payload_valid("payload")
    )
  ) NOT VALID;
