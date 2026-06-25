CREATE OR REPLACE FUNCTION ai_repair_runtime_side_effect_rollback_contract_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'version') = 'string'
    AND btrim(value->>'version') = 'repair-execution-side-effect-rollback-contract/v1'
    AND value->'supported' = 'false'::jsonb
    AND jsonb_typeof(value->'mode') = 'string'
    AND btrim(value->>'mode') = 'forward_only_followup_revision'
    AND jsonb_typeof(value->'reason') = 'string'
    AND length(btrim(value->>'reason')) BETWEEN 1 AND 512
    AND jsonb_typeof(value->'recoveryPath') = 'string'
    AND btrim(value->>'recoveryPath') = 'publish_follow_up_registry_revision',
    false
  );
$$;

ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_side_effect_rollback_check"
  CHECK (
    COALESCE("runtime_result"->'sideEffectsApplied' = 'true'::jsonb, false) = false
    OR ai_repair_runtime_applied_side_effect_valid("runtime_result") = false
    OR ai_repair_runtime_side_effect_rollback_contract_valid(
      "runtime_result"->'sideEffectSummary'->'rollbackContract'
    )
  ) NOT VALID;
