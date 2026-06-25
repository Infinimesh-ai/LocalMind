ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_execution_result_snapshot_key"
  UNIQUE ("id", "workspace_id", "actor_id");

CREATE TABLE "ai_agent_runtime_execution_results" (
  "id" VARCHAR NOT NULL,
  "run_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR NOT NULL,
  "workflow" VARCHAR NOT NULL,
  "source_type" VARCHAR NOT NULL,
  "source_id" VARCHAR NOT NULL,
  "adapter_workflow" VARCHAR NOT NULL,
  "executor" VARCHAR NOT NULL,
  "result_status" VARCHAR NOT NULL,
  "side_effect_mode" VARCHAR NOT NULL,
  "side_effects_applied" BOOLEAN NOT NULL,
  "summary" TEXT NOT NULL,
  "failure_code" VARCHAR,
  "failure_message" TEXT,
  "result_payload" JSONB NOT NULL,
  "result_fingerprint" VARCHAR NOT NULL,
  "worker_attempt" INTEGER NOT NULL,
  "worker_lease_id" VARCHAR NOT NULL,
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_agent_runtime_execution_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_agent_runtime_execution_results_status_check"
    CHECK ("result_status" IN ('completed', 'failed')),
  CONSTRAINT "ai_agent_runtime_execution_results_side_effect_mode_check"
    CHECK ("side_effect_mode" IN ('none', 'workspace_write', 'external_tool')),
  CONSTRAINT "ai_agent_runtime_execution_results_executor_check"
    CHECK (
      "executor" IN (
        'agent_runtime_record_only_adapter',
        'agent_runtime_worker'
      )
    ),
  CONSTRAINT "ai_agent_runtime_execution_results_string_shape_check"
    CHECK (
      length(btrim("id")) BETWEEN 1 AND 512
      AND length(btrim("run_id")) BETWEEN 1 AND 512
      AND length(btrim("workspace_id")) BETWEEN 1 AND 512
      AND length(btrim("actor_id")) BETWEEN 1 AND 512
      AND length(btrim("workflow")) BETWEEN 1 AND 512
      AND length(btrim("source_type")) BETWEEN 1 AND 512
      AND length(btrim("source_id")) BETWEEN 1 AND 512
      AND length(btrim("adapter_workflow")) BETWEEN 1 AND 512
      AND length(btrim("executor")) BETWEEN 1 AND 128
      AND length(btrim("summary")) BETWEEN 1 AND 1024
      AND length(btrim("worker_lease_id")) BETWEEN 1 AND 512
      AND (
        "failure_code" IS NULL
        OR length(btrim("failure_code")) BETWEEN 1 AND 128
      )
      AND (
        "failure_message" IS NULL
        OR length(btrim("failure_message")) BETWEEN 1 AND 1024
      )
    ),
  CONSTRAINT "ai_agent_runtime_execution_results_standalone_source_check"
    CHECK ("source_type" <> 'repair_execution_request'),
  CONSTRAINT "ai_agent_runtime_execution_results_fingerprint_shape_check"
    CHECK (
      length("result_fingerprint") = 16
      AND "result_fingerprint" ~ '^[a-f0-9]{16}$'
    ),
  CONSTRAINT "ai_agent_runtime_execution_results_worker_attempt_check"
    CHECK (
      "worker_attempt" > 0
      AND "worker_attempt" <= 1000000
    ),
  CONSTRAINT "ai_agent_runtime_execution_results_payload_shape_check"
    CHECK (
      jsonb_typeof("result_payload") = 'object'
      AND jsonb_typeof("result_payload"->'version') = 'string'
      AND btrim("result_payload"->>'version') =
        'agent-runtime-worker-execution-result/v1'
      AND jsonb_typeof("result_payload"->'resultStatus') = 'string'
      AND btrim("result_payload"->>'resultStatus') = "result_status"
      AND jsonb_typeof("result_payload"->'workflow') = 'string'
      AND btrim("result_payload"->>'workflow') = "workflow"
      AND jsonb_typeof("result_payload"->'sourceType') = 'string'
      AND btrim("result_payload"->>'sourceType') = "source_type"
      AND jsonb_typeof("result_payload"->'sourceId') = 'string'
      AND btrim("result_payload"->>'sourceId') = "source_id"
      AND jsonb_typeof("result_payload"->'adapterWorkflow') = 'string'
      AND btrim("result_payload"->>'adapterWorkflow') = "adapter_workflow"
      AND jsonb_typeof("result_payload"->'executor') = 'string'
      AND btrim("result_payload"->>'executor') = "executor"
      AND jsonb_typeof("result_payload"->'sideEffectMode') = 'string'
      AND btrim("result_payload"->>'sideEffectMode') = "side_effect_mode"
      AND jsonb_typeof("result_payload"->'sideEffectsApplied') = 'boolean'
      AND ("result_payload"->>'sideEffectsApplied')::boolean =
        "side_effects_applied"
      AND jsonb_typeof("result_payload"->'summary') = 'string'
      AND btrim("result_payload"->>'summary') = btrim("summary")
      AND jsonb_typeof("result_payload"->'workerAttempt') = 'number'
      AND ("result_payload"->>'workerAttempt') ~ '^[0-9]+$'
      AND ("result_payload"->>'workerAttempt')::numeric = "worker_attempt"
      AND jsonb_typeof("result_payload"->'workerLeaseId') = 'string'
      AND btrim("result_payload"->>'workerLeaseId') = "worker_lease_id"
      AND jsonb_typeof("result_payload"->'completedAt') = 'string'
      AND length(btrim("result_payload"->>'completedAt')) BETWEEN 1 AND 64
    ),
  CONSTRAINT "ai_agent_runtime_execution_results_status_payload_check"
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
        AND "executor" = 'agent_runtime_worker'
        AND "side_effects_applied" = false
        AND "failure_code" IS NOT NULL
        AND "failure_message" IS NOT NULL
        AND jsonb_typeof("result_payload"->'failureCode') = 'string'
        AND btrim("result_payload"->>'failureCode') = "failure_code"
        AND jsonb_typeof("result_payload"->'failureMessage') = 'string'
        AND btrim("result_payload"->>'failureMessage') = btrim("failure_message")
      )
    ),
  CONSTRAINT "ai_agent_runtime_execution_results_timestamp_check"
    CHECK ("created_at" >= "completed_at" - interval '1 second')
);

CREATE UNIQUE INDEX "ai_agent_runtime_execution_results_run_attempt_key"
ON "ai_agent_runtime_execution_results"("run_id", "worker_attempt");

CREATE UNIQUE INDEX "ai_agent_runtime_execution_results_workspace_fingerprint_key"
ON "ai_agent_runtime_execution_results"("workspace_id", "result_fingerprint");

CREATE INDEX "ai_agent_runtime_execution_results_workspace_id_created_at_idx"
ON "ai_agent_runtime_execution_results"("workspace_id", "created_at");

CREATE INDEX "ai_agent_runtime_execution_results_actor_id_created_at_idx"
ON "ai_agent_runtime_execution_results"("actor_id", "created_at");

CREATE INDEX "ai_agent_runtime_execution_results_result_status_created_at_idx"
ON "ai_agent_runtime_execution_results"("result_status", "created_at");

CREATE INDEX "ai_agent_runtime_execution_results_workflow_created_at_idx"
ON "ai_agent_runtime_execution_results"("workflow", "created_at");

CREATE INDEX "ai_agent_runtime_execution_results_adapter_created_at_idx"
ON "ai_agent_runtime_execution_results"("adapter_workflow", "created_at");

ALTER TABLE "ai_agent_runtime_execution_results"
  ADD CONSTRAINT "ai_agent_runtime_execution_results_run_id_fkey"
  FOREIGN KEY ("run_id", "workspace_id", "actor_id")
  REFERENCES "ai_agent_runs"("id", "workspace_id", "actor_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
