CREATE OR REPLACE FUNCTION ai_repair_execution_side_effect_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."execution_request_id" IS NOT DISTINCT FROM
       NEW."execution_request_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."side_effect_kind" IS NOT DISTINCT FROM NEW."side_effect_kind"
     AND OLD."side_effect_record_id" IS NOT DISTINCT FROM
       NEW."side_effect_record_id"
     AND OLD."side_effect_fingerprint" IS NOT DISTINCT FROM
       NEW."side_effect_fingerprint"
     AND OLD."side_effect_summary" IS NOT DISTINCT FROM
       NEW."side_effect_summary"
     AND OLD."executor_payload_fingerprint" IS NOT DISTINCT FROM
       NEW."executor_payload_fingerprint"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."applied_at" IS NOT DISTINCT FROM NEW."applied_at"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_repair_execution_side_effects_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_repair_execution_side_effects_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_repair_execution_side_effects_content_update_restrict_check"
AFTER UPDATE
ON "ai_repair_execution_side_effects"
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_side_effect_content_update_restrict();
