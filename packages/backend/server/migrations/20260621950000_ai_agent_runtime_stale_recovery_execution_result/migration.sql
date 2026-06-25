ALTER TABLE "ai_agent_runtime_execution_results"
  DROP CONSTRAINT "ai_agent_runtime_execution_results_status_payload_check";

ALTER TABLE "ai_agent_runtime_execution_results"
  DROP CONSTRAINT "ai_agent_runtime_execution_results_executor_check";

ALTER TABLE "ai_agent_runtime_execution_results"
  ADD CONSTRAINT "ai_agent_runtime_execution_results_executor_check"
    CHECK (
      "executor" IN (
        'agent_runtime_record_only_adapter',
        'agent_runtime_stale_recovery_worker',
        'agent_runtime_worker'
      )
    );

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
      )
    );
