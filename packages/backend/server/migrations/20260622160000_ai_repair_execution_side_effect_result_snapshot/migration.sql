CREATE OR REPLACE FUNCTION ai_repair_execution_side_effect_result_snapshot_valid()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."executor_payload_fingerprint" IS DISTINCT FROM
       NEW."executor_payload_fingerprint" THEN
    RAISE EXCEPTION
      'ai_repair_execution_side_effects_executor_payload_fingerprint_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_repair_execution_side_effects_executor_payload_fingerprint_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_repair_execution_requests" request
    WHERE request."id" = NEW."execution_request_id"
      AND request."workspace_id" = NEW."workspace_id"
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_repair_execution_requests" request
    WHERE request."id" = NEW."execution_request_id"
      AND request."workspace_id" = NEW."workspace_id"
      AND request."actor_id" = NEW."actor_id"
      AND request."status" = 'completed'
      AND request."runtime_result"->'sideEffectsApplied' = 'true'::jsonb
      AND request."runtime_result"->>'sideEffectKind' =
        NEW."side_effect_kind"
      AND request."runtime_result"->>'sideEffectRecordId' =
        NEW."side_effect_record_id"
      AND request."runtime_result"->>'sideEffectFingerprint' =
        NEW."side_effect_fingerprint"
      AND request."runtime_result"->'sideEffectSummary' =
        NEW."side_effect_summary"
      AND request."worker_attempt" = NEW."worker_attempt"
      AND request."completed_at" = NEW."applied_at"
      AND request."failure_code" IS NULL
      AND request."failure_message" IS NULL
      AND request."worker_lease_id" IS NULL
      AND request."worker_lease_expires_at" IS NULL
  ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_side_effects_result_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_repair_execution_side_effects_result_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_repair_execution_side_effects_result_snapshot_check"
BEFORE INSERT OR UPDATE OF
  "execution_request_id",
  "workspace_id",
  "side_effect_kind",
  "side_effect_record_id",
  "side_effect_fingerprint",
  "side_effect_summary",
  "executor_payload_fingerprint",
  "worker_attempt",
  "applied_at"
ON "ai_repair_execution_side_effects"
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_side_effect_result_snapshot_valid();

CREATE OR REPLACE FUNCTION ai_repair_execution_request_side_effect_result_valid()
RETURNS trigger AS $$
BEGIN
  IF OLD."executor_payload" IS DISTINCT FROM NEW."executor_payload"
     AND EXISTS (
       SELECT 1
       FROM "ai_repair_execution_side_effects" side_effect
       WHERE side_effect."execution_request_id" = OLD."id"
         AND side_effect."workspace_id" = OLD."workspace_id"
     ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_requests_side_effect_executor_payload_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_repair_execution_requests_side_effect_executor_payload_snapshot_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_repair_execution_side_effects" side_effect
    WHERE side_effect."execution_request_id" = NEW."id"
      AND side_effect."workspace_id" = NEW."workspace_id"
  )
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_repair_execution_side_effects" side_effect
       WHERE side_effect."execution_request_id" = NEW."id"
         AND side_effect."workspace_id" = NEW."workspace_id"
         AND side_effect."actor_id" = NEW."actor_id"
         AND NEW."status" = 'completed'
         AND NEW."runtime_result"->'sideEffectsApplied' = 'true'::jsonb
         AND NEW."runtime_result"->>'sideEffectKind' =
           side_effect."side_effect_kind"
         AND NEW."runtime_result"->>'sideEffectRecordId' =
           side_effect."side_effect_record_id"
         AND NEW."runtime_result"->>'sideEffectFingerprint' =
           side_effect."side_effect_fingerprint"
         AND NEW."runtime_result"->'sideEffectSummary' =
           side_effect."side_effect_summary"
         AND NEW."worker_attempt" = side_effect."worker_attempt"
         AND NEW."completed_at" = side_effect."applied_at"
         AND NEW."failure_code" IS NULL
         AND NEW."failure_message" IS NULL
         AND NEW."worker_lease_id" IS NULL
         AND NEW."worker_lease_expires_at" IS NULL
     ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_requests_side_effect_result_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_repair_execution_requests_side_effect_result_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_repair_execution_requests_side_effect_result_snapshot_check"
BEFORE UPDATE OF
  "runtime_result",
  "executor_payload",
  "status",
  "failure_code",
  "failure_message",
  "worker_lease_id",
  "worker_lease_expires_at",
  "worker_attempt",
  "completed_at"
ON "ai_repair_execution_requests"
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_request_side_effect_result_valid();
