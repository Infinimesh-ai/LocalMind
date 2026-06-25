CREATE OR REPLACE FUNCTION ai_repair_execution_side_effect_ledger_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."runtime_result" IS NOT DISTINCT FROM NEW."runtime_result"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."worker_lease_expires_at" IS NOT DISTINCT FROM
       NEW."worker_lease_expires_at"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at" THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'completed'
     AND NEW."runtime_result"->'sideEffectsApplied' = 'true'::jsonb
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_repair_execution_side_effects" side_effect
       WHERE side_effect."execution_request_id" = NEW."id"
         AND side_effect."workspace_id" IS NOT DISTINCT FROM
           NEW."workspace_id"
         AND side_effect."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
         AND side_effect."side_effect_kind" IS NOT DISTINCT FROM
           NEW."runtime_result"->>'sideEffectKind'
         AND side_effect."side_effect_record_id" IS NOT DISTINCT FROM
           NEW."runtime_result"->>'sideEffectRecordId'
         AND side_effect."side_effect_fingerprint" IS NOT DISTINCT FROM
           NEW."runtime_result"->>'sideEffectFingerprint'
         AND side_effect."side_effect_summary" IS NOT DISTINCT FROM
           NEW."runtime_result"->'sideEffectSummary'
         AND side_effect."worker_attempt" IS NOT DISTINCT FROM
           NEW."worker_attempt"
         AND side_effect."applied_at" IS NOT DISTINCT FROM NEW."completed_at"
         AND NEW."failure_code" IS NULL
         AND NEW."failure_message" IS NULL
         AND NEW."worker_lease_id" IS NULL
         AND NEW."worker_lease_expires_at" IS NULL
     ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_requests_side_effect_ledger_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_repair_execution_requests_side_effect_ledger_required_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_repair_exec_requests_side_effect_ledger_required_check"
AFTER INSERT OR UPDATE OF
  "runtime_result",
  "status",
  "failure_code",
  "failure_message",
  "worker_lease_id",
  "worker_lease_expires_at",
  "worker_attempt",
  "completed_at"
ON "ai_repair_execution_requests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_side_effect_ledger_required();
