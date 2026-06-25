DROP TRIGGER IF EXISTS
  "ai_agent_runtime_execution_results_content_update_restrict_check"
ON "ai_agent_runtime_execution_results";

CREATE OR REPLACE FUNCTION ai_agent_runtime_execution_result_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."run_id" IS NOT DISTINCT FROM NEW."run_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."workflow" IS NOT DISTINCT FROM NEW."workflow"
     AND OLD."source_type" IS NOT DISTINCT FROM NEW."source_type"
     AND OLD."source_id" IS NOT DISTINCT FROM NEW."source_id"
     AND OLD."adapter_workflow" IS NOT DISTINCT FROM
       NEW."adapter_workflow"
     AND OLD."executor" IS NOT DISTINCT FROM NEW."executor"
     AND OLD."result_status" IS NOT DISTINCT FROM NEW."result_status"
     AND OLD."side_effect_mode" IS NOT DISTINCT FROM
       NEW."side_effect_mode"
     AND OLD."side_effects_applied" IS NOT DISTINCT FROM
       NEW."side_effects_applied"
     AND OLD."summary" IS NOT DISTINCT FROM NEW."summary"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."result_payload" IS NOT DISTINCT FROM NEW."result_payload"
     AND OLD."result_fingerprint" IS NOT DISTINCT FROM
       NEW."result_fingerprint"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_runtime_execution_results_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_agent_runtime_execution_results_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER
  "zz_ai_agent_runtime_execution_results_content_update_restrict_check"
AFTER UPDATE
ON "ai_agent_runtime_execution_results"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_runtime_execution_result_content_update_restrict();
