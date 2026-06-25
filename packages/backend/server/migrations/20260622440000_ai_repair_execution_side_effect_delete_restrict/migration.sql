CREATE OR REPLACE FUNCTION ai_repair_execution_side_effect_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_repair_execution_requests" request
    WHERE request."id" = OLD."execution_request_id"
      AND request."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
      AND request."actor_id" IS NOT DISTINCT FROM OLD."actor_id"
      AND request."status" = 'completed'
      AND request."runtime_result"->'sideEffectsApplied' = 'true'::jsonb
      AND request."runtime_result"->>'sideEffectKind' IS NOT DISTINCT FROM
        OLD."side_effect_kind"
      AND request."runtime_result"->>'sideEffectRecordId' IS NOT DISTINCT FROM
        OLD."side_effect_record_id"
      AND request."runtime_result"->>'sideEffectFingerprint'
        IS NOT DISTINCT FROM OLD."side_effect_fingerprint"
      AND request."runtime_result"->'sideEffectSummary' IS NOT DISTINCT FROM
        OLD."side_effect_summary"
      AND request."worker_attempt" IS NOT DISTINCT FROM OLD."worker_attempt"
      AND request."completed_at" IS NOT DISTINCT FROM OLD."applied_at"
      AND request."failure_code" IS NULL
      AND request."failure_message" IS NULL
      AND request."worker_lease_id" IS NULL
      AND request."worker_lease_expires_at" IS NULL
  ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_side_effects_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_repair_execution_side_effects_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_repair_exec_side_effects_delete_restrict_check"
AFTER DELETE
ON "ai_repair_execution_side_effects"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_side_effect_delete_restrict();
