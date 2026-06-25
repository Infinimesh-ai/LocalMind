CREATE UNIQUE INDEX "ai_repair_execution_requests_side_effect_snapshot_key"
ON "ai_repair_execution_requests" (
  "id",
  "workspace_id",
  "actor_id"
);

CREATE TABLE "ai_repair_execution_side_effects" (
  "id" VARCHAR NOT NULL,
  "execution_request_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR NOT NULL,
  "side_effect_kind" VARCHAR NOT NULL,
  "side_effect_record_id" VARCHAR NOT NULL,
  "side_effect_fingerprint" VARCHAR NOT NULL,
  "side_effect_summary" JSONB NOT NULL,
  "executor_payload_fingerprint" VARCHAR NOT NULL,
  "worker_attempt" INTEGER NOT NULL,
  "worker_lease_id" VARCHAR NOT NULL,
  "applied_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_repair_execution_side_effects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_repair_execution_side_effects_kind_check"
    CHECK (
      "side_effect_kind" IN (
        'model_registry_revision',
        'prompt_registry_revision',
        'provider_registry_revision',
        'task_route_policy_revision'
      )
    ),
  CONSTRAINT "ai_repair_execution_side_effects_string_shape_check"
    CHECK (
      length(btrim("execution_request_id")) BETWEEN 1 AND 512
      AND length(btrim("workspace_id")) BETWEEN 1 AND 512
      AND length(btrim("actor_id")) BETWEEN 1 AND 512
      AND length(btrim("side_effect_record_id")) BETWEEN 1 AND 512
      AND length(btrim("worker_lease_id")) BETWEEN 1 AND 512
    ),
  CONSTRAINT "ai_repair_execution_side_effects_fingerprint_shape_check"
    CHECK (
      length(btrim("side_effect_fingerprint")) BETWEEN 1 AND 128
      AND length(btrim("executor_payload_fingerprint")) BETWEEN 1 AND 128
    ),
  CONSTRAINT "ai_repair_execution_side_effects_summary_shape_check"
    CHECK (jsonb_typeof("side_effect_summary") = 'object'),
  CONSTRAINT "ai_repair_execution_side_effects_worker_attempt_check"
    CHECK ("worker_attempt" > 0 AND "worker_attempt" <= 1000000),
  CONSTRAINT "ai_repair_execution_side_effects_rollback_contract_check"
    CHECK (
      ai_repair_runtime_side_effect_rollback_contract_valid(
        "side_effect_summary"->'rollbackContract'
      )
    ),
  CONSTRAINT "ai_repair_execution_side_effects_timestamp_check"
    CHECK ("created_at" >= "applied_at" - interval '1 second')
);

CREATE UNIQUE INDEX "ai_repair_execution_side_effects_execution_request_id_key"
ON "ai_repair_execution_side_effects"("execution_request_id");

CREATE UNIQUE INDEX "ai_repair_execution_side_effects_workspace_fingerprint_key"
ON "ai_repair_execution_side_effects"(
  "workspace_id",
  "side_effect_fingerprint"
);

CREATE INDEX "ai_repair_execution_side_effects_workspace_id_created_at_idx"
ON "ai_repair_execution_side_effects"("workspace_id", "created_at");

CREATE INDEX "ai_repair_execution_side_effects_actor_id_created_at_idx"
ON "ai_repair_execution_side_effects"("actor_id", "created_at");

CREATE INDEX "ai_repair_execution_side_effects_kind_created_at_idx"
ON "ai_repair_execution_side_effects"("side_effect_kind", "created_at");

CREATE INDEX "ai_repair_execution_side_effects_record_id_idx"
ON "ai_repair_execution_side_effects"("side_effect_record_id");

ALTER TABLE "ai_repair_execution_side_effects"
  ADD CONSTRAINT "ai_repair_execution_side_effects_execution_request_id_fkey"
  FOREIGN KEY (
    "execution_request_id",
    "workspace_id",
    "actor_id"
  )
  REFERENCES "ai_repair_execution_requests"(
    "id",
    "workspace_id",
    "actor_id"
  )
  ON DELETE CASCADE
  ON UPDATE CASCADE;
