CREATE OR REPLACE FUNCTION ai_repair_runtime_applied_side_effect_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND (
      COALESCE(value->'sideEffectsApplied' = 'true'::jsonb, false) = false
      OR (
        jsonb_typeof(value->'sideEffectKind') = 'string'
        AND length(btrim(value->>'sideEffectKind')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sideEffectRecordId') = 'string'
        AND length(btrim(value->>'sideEffectRecordId')) BETWEEN 1 AND 512
        AND jsonb_typeof(value->'sideEffectFingerprint') = 'string'
        AND length(btrim(value->>'sideEffectFingerprint')) BETWEEN 1 AND 128
        AND jsonb_typeof(value->'sideEffectSummary') = 'object'
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_runtime_side_effect_check"
  CHECK (
    ai_repair_runtime_applied_side_effect_valid("runtime_result")
  ) NOT VALID;
