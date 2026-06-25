CREATE OR REPLACE FUNCTION ai_repair_side_effect_matches_executor_payload(
  runtime_result jsonb,
  executor_payload jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    COALESCE(runtime_result->'sideEffectsApplied' = 'true'::jsonb, false) = false
    OR (
      jsonb_typeof(runtime_result) = 'object'
      AND jsonb_typeof(executor_payload) = 'object'
      AND jsonb_typeof(runtime_result->'sideEffectKind') = 'string'
      AND jsonb_typeof(executor_payload->'kind') = 'string'
      AND (
        (
          btrim(executor_payload->>'kind') = 'prompt_registry_revision_publish'
          AND btrim(runtime_result->>'sideEffectKind') = 'prompt_registry_revision'
        )
        OR (
          btrim(executor_payload->>'kind') = 'task_route_policy_revision_publish'
          AND btrim(runtime_result->>'sideEffectKind') = 'task_route_policy_revision'
        )
        OR (
          btrim(executor_payload->>'kind') = 'model_registry_revision_publish'
          AND btrim(runtime_result->>'sideEffectKind') = 'model_registry_revision'
        )
        OR (
          btrim(executor_payload->>'kind') = 'provider_registry_revision_publish'
          AND btrim(runtime_result->>'sideEffectKind') = 'provider_registry_revision'
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_side_effect_executor_payload_check"
  CHECK (
    ai_repair_runtime_applied_side_effect_valid("runtime_result") = false
    OR ai_repair_side_effect_matches_executor_payload(
      "runtime_result",
      "executor_payload"
    )
  ) NOT VALID;
