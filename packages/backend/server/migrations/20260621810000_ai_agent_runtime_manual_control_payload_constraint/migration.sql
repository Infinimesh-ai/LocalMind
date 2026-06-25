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
      OR expected_status IN ('queued', 'cancelled')
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
          'cancelled'
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
            AND expected_status = 'cancelled'
          )
          OR (
            expected_action = 'resume'
            AND expected_status = 'queued'
          )
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_manual_control_payload_check"
  CHECK (
    NOT ("output_summary" ? 'manualControl')
    OR ai_agent_runtime_manual_control_payload_valid(
      "output_summary"->'manualControl',
      'step_summary',
      "output_summary"->'manualControl'->>'action',
      NULL
    )
  ) NOT VALID;

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
        ELSE NULL
      END,
      "status"
    )
  ) NOT VALID;
