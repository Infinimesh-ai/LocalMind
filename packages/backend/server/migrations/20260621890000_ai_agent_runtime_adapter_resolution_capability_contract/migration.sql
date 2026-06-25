CREATE OR REPLACE FUNCTION ai_agent_runtime_adapter_resolution_step_types_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'array' THEN false
    WHEN jsonb_array_length(value) NOT BETWEEN 1 AND 32 THEN false
    ELSE COALESCE(
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value) AS "step"("item")
        WHERE jsonb_typeof("step"."item") <> 'string'
          OR btrim("step"."item"#>>'{}') NOT IN (
            'model',
            'tool',
            'approval',
            'handoff',
            'codex',
            'mcp'
          )
      )
      AND (
        SELECT COUNT(DISTINCT btrim("step"."item"#>>'{}'))
        FROM jsonb_array_elements(value) AS "step"("item")
        WHERE jsonb_typeof("step"."item") = 'string'
      ) = jsonb_array_length(value),
      false
    )
  END;
$$;

CREATE OR REPLACE FUNCTION ai_agent_runtime_adapter_resolution_snapshot_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'workflow') = 'string'
    AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
    AND ai_agent_runtime_adapter_resolution_step_types_valid(
      value->'supportedStepTypes'
    )
    AND jsonb_typeof(value->'sideEffectMode') = 'string'
    AND btrim(value->>'sideEffectMode') IN (
      'none',
      'workspace_write',
      'external_tool'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_agent_runtime_adapter_resolution_snapshot_matches(
  left_value jsonb,
  right_value jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    ai_agent_runtime_adapter_resolution_snapshot_valid(left_value)
    AND ai_agent_runtime_adapter_resolution_snapshot_valid(right_value)
    AND btrim(left_value->>'workflow') = btrim(right_value->>'workflow')
    AND btrim(left_value->>'sideEffectMode') =
      btrim(right_value->>'sideEffectMode')
    AND jsonb_array_length(left_value->'supportedStepTypes') =
      jsonb_array_length(right_value->'supportedStepTypes')
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(left_value->'supportedStepTypes') AS "left_step"("item")
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(right_value->'supportedStepTypes') AS "right_step"("item")
        WHERE btrim("right_step"."item"#>>'{}') =
          btrim("left_step"."item"#>>'{}')
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_agent_runtime_adapter_resolution_snapshot_list_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'array' THEN false
    WHEN jsonb_array_length(value) NOT BETWEEN 1 AND 24 THEN false
    ELSE COALESCE(
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value) AS "adapter"("item")
        WHERE NOT ai_agent_runtime_adapter_resolution_snapshot_valid(
          "adapter"."item"
        )
      )
      AND (
        SELECT COUNT(DISTINCT btrim("adapter"."item"->>'workflow'))
        FROM jsonb_array_elements(value) AS "adapter"("item")
        WHERE jsonb_typeof("adapter"."item") = 'object'
          AND jsonb_typeof("adapter"."item"->'workflow') = 'string'
      ) = jsonb_array_length(value),
      false
    )
  END;
$$;

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
    AND ai_agent_runtime_adapter_resolution_step_types_valid(
      value->'requestedStepTypes'
    )
    AND ai_agent_runtime_adapter_resolution_snapshot_list_valid(
      value->'registeredAdapters'
    )
    AND (
      btrim(value->>'status') = 'unsupported_workflow'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value->'registeredAdapters') AS "adapter"("item")
        WHERE ai_agent_runtime_adapter_resolution_snapshot_matches(
          "adapter"."item",
          value->'adapter'
        )
          AND btrim(value->'adapter'->>'workflow') = btrim(value->>'workflow')
      )
    )
    AND (
      btrim(value->>'status') <> 'unsupported_contract'
      OR (
        ai_agent_runtime_adapter_resolution_step_types_valid(
          value->'unsupportedStepTypes'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(value->'unsupportedStepTypes') AS "step"("item")
          WHERE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(value->'requestedStepTypes') AS "requested"("item")
            WHERE btrim("requested"."item"#>>'{}') =
              btrim("step"."item"#>>'{}')
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(value->'adapter'->'supportedStepTypes') AS "supported"("item")
            WHERE btrim("supported"."item"#>>'{}') =
              btrim("step"."item"#>>'{}')
          )
        )
      )
    )
    AND (
      btrim(value->>'status') = 'unsupported_contract'
      OR NOT (value ? 'unsupportedStepTypes')
    )
    AND (
      btrim(value->>'status') <> 'unsupported_workflow'
      OR NOT (value ? 'adapter')
    ),
    false
  );
$$;
