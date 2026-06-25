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
      'completed',
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

CREATE OR REPLACE FUNCTION ai_agent_runtime_worker_failure_payload_valid(
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
    AND btrim(value->>'version') = 'agent-runtime-worker-failure/v1'
    AND jsonb_typeof(value->'failureCode') = 'string'
    AND length(btrim(value->>'failureCode')) BETWEEN 1 AND 128
    AND jsonb_typeof(value->'failureMessage') = 'string'
    AND length(btrim(value->>'failureMessage')) BETWEEN 1 AND 1024
    AND jsonb_typeof(value->'workerAttempt') = 'number'
    AND (value->>'workerAttempt') ~ '^[0-9]+$'
    AND (value->>'workerAttempt')::numeric > 0
    AND (value->>'workerAttempt')::numeric <= 1000000
    AND jsonb_typeof(value->'workerLeaseId') = 'string'
    AND length(btrim(value->>'workerLeaseId')) BETWEEN 1 AND 512
    AND (
      NOT (value ? 'adapterResolution')
      OR (
        ai_agent_runtime_adapter_resolution_valid(value->'adapterResolution')
        AND btrim(value->'adapterResolution'->>'status') IN (
          'unsupported_workflow',
          'unsupported_contract',
          'execution_failed',
          'invalid_executor_result',
          'incomplete_execution'
        )
      )
    )
    AND (
      payload_scope <> 'run_timeline'
      OR (
        jsonb_typeof(value->'workerMaxAttempts') = 'number'
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

CREATE OR REPLACE FUNCTION ai_agent_runtime_worker_completion_payload_valid(
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
    AND btrim(value->>'version') = 'agent-runtime-worker-completion/v1'
    AND jsonb_typeof(value->'executor') = 'string'
    AND btrim(value->>'executor') = 'agent_runtime_worker'
    AND jsonb_typeof(value->'adapterWorkflow') = 'string'
    AND length(btrim(value->>'adapterWorkflow')) BETWEEN 1 AND 512
    AND jsonb_typeof(value->'sideEffectMode') = 'string'
    AND btrim(value->>'sideEffectMode') IN (
      'none',
      'workspace_write',
      'external_tool'
    )
    AND jsonb_typeof(value->'sideEffectsApplied') = 'boolean'
    AND (value->>'sideEffectsApplied')::boolean = false
    AND jsonb_typeof(value->'summary') = 'string'
    AND length(btrim(value->>'summary')) BETWEEN 1 AND 1024
    AND jsonb_typeof(value->'workerAttempt') = 'number'
    AND (value->>'workerAttempt') ~ '^[0-9]+$'
    AND (value->>'workerAttempt')::numeric > 0
    AND (value->>'workerAttempt')::numeric <= 1000000
    AND jsonb_typeof(value->'workerLeaseId') = 'string'
    AND length(btrim(value->>'workerLeaseId')) BETWEEN 1 AND 512
    AND ai_agent_runtime_adapter_resolution_valid(
      value->'adapterResolution'
    )
    AND btrim(value->'adapterResolution'->>'status') = 'completed'
    AND btrim(value->'adapterResolution'->>'workflow') =
      btrim(value->>'adapterWorkflow')
    AND btrim(value->'adapterResolution'->'adapter'->>'workflow') =
      btrim(value->>'adapterWorkflow')
    AND btrim(value->'adapterResolution'->'adapter'->>'sideEffectMode') =
      btrim(value->>'sideEffectMode')
    AND (
      payload_scope <> 'run_timeline'
      OR (
        jsonb_typeof(value->'workerMaxAttempts') = 'number'
        AND (value->>'workerMaxAttempts') ~ '^[0-9]+$'
        AND (value->>'workerMaxAttempts')::numeric > 0
        AND (value->>'workerMaxAttempts')::numeric <= 1000000
        AND jsonb_typeof(value->'workflow') = 'string'
        AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
        AND btrim(value->>'workflow') = btrim(value->>'adapterWorkflow')
        AND jsonb_typeof(value->'sourceType') = 'string'
        AND length(btrim(value->>'sourceType')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sourceId') = 'string'
        AND length(btrim(value->>'sourceId')) BETWEEN 1 AND 512
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
  ADD CONSTRAINT "ai_agent_steps_worker_completion_payload_check"
  CHECK (
    NOT ("output_summary" ? 'workerCompletion')
    OR ai_agent_runtime_worker_completion_payload_valid(
      "output_summary"->'workerCompletion',
      'step_summary'
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_worker_completion_payload_check"
  CHECK (
    "payload"->>'version' <> 'agent-runtime-worker-completion/v1'
    OR ai_agent_runtime_worker_completion_payload_valid(
      "payload",
      CASE
        WHEN "event_type" = 'run_status' THEN 'run_timeline'
        ELSE 'step_timeline'
      END
    )
  ) NOT VALID;

ALTER TABLE "ai_agent_runtime_execution_results"
  DROP CONSTRAINT "ai_agent_runtime_execution_results_status_payload_check";

ALTER TABLE "ai_agent_runtime_execution_results"
  ADD CONSTRAINT "ai_agent_runtime_execution_results_status_payload_check"
    CHECK (
      (
        "result_status" = 'completed'
        AND "executor" = 'agent_runtime_record_only_adapter'
        AND "adapter_workflow" = 'agent_runtime_record_only'
        AND "side_effect_mode" = 'none'
        AND "side_effects_applied" = false
        AND "failure_code" IS NULL
        AND "failure_message" IS NULL
        AND NOT ("result_payload" ? 'failureCode')
        AND NOT ("result_payload" ? 'failureMessage')
      )
      OR (
        "result_status" = 'completed'
        AND "executor" = 'agent_runtime_worker'
        AND "adapter_workflow" = "workflow"
        AND "side_effects_applied" = false
        AND "failure_code" IS NULL
        AND "failure_message" IS NULL
        AND NOT ("result_payload" ? 'failureCode')
        AND NOT ("result_payload" ? 'failureMessage')
        AND ai_agent_runtime_adapter_resolution_valid(
          "result_payload"->'adapterResolution'
        )
        AND btrim("result_payload"->'adapterResolution'->>'status') =
          'completed'
        AND btrim("result_payload"->'adapterResolution'->>'workflow') =
          "workflow"
        AND btrim(
          "result_payload"->'adapterResolution'->'adapter'->>'workflow'
        ) = "adapter_workflow"
        AND btrim(
          "result_payload"->'adapterResolution'->'adapter'->>'sideEffectMode'
        ) = "side_effect_mode"
      )
      OR (
        "result_status" = 'failed'
        AND "executor" IN (
          'agent_runtime_stale_recovery_worker',
          'agent_runtime_worker'
        )
        AND (
          "executor" <> 'agent_runtime_stale_recovery_worker'
          OR (
            "adapter_workflow" = "workflow"
            AND "side_effect_mode" = 'none'
            AND "failure_code" = 'stale_worker_lease'
          )
        )
        AND "side_effects_applied" = false
        AND "failure_code" IS NOT NULL
        AND "failure_message" IS NOT NULL
        AND jsonb_typeof("result_payload"->'failureCode') = 'string'
        AND btrim("result_payload"->>'failureCode') = "failure_code"
        AND jsonb_typeof("result_payload"->'failureMessage') = 'string'
        AND btrim("result_payload"->>'failureMessage') = btrim("failure_message")
        AND (
          NOT ("result_payload" ? 'adapterResolution')
          OR (
            ai_agent_runtime_adapter_resolution_valid(
              "result_payload"->'adapterResolution'
            )
            AND btrim("result_payload"->'adapterResolution'->>'status') IN (
              'unsupported_workflow',
              'unsupported_contract',
              'execution_failed',
              'invalid_executor_result',
              'incomplete_execution'
            )
          )
        )
      )
    );
