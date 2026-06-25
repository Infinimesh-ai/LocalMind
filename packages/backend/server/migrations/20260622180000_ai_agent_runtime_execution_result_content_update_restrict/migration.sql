CREATE OR REPLACE FUNCTION ai_agent_runtime_execution_result_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."adapter_workflow" IS NOT DISTINCT FROM NEW."adapter_workflow"
     AND OLD."executor" IS NOT DISTINCT FROM NEW."executor"
     AND OLD."side_effect_mode" IS NOT DISTINCT FROM NEW."side_effect_mode"
     AND OLD."side_effects_applied" IS NOT DISTINCT FROM
       NEW."side_effects_applied"
     AND OLD."summary" IS NOT DISTINCT FROM NEW."summary"
     AND OLD."result_payload" IS NOT DISTINCT FROM NEW."result_payload"
     AND OLD."result_fingerprint" IS NOT DISTINCT FROM
       NEW."result_fingerprint"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_runtime_execution_results_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_agent_runtime_execution_results_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_runtime_execution_results_content_update_restrict_check"
AFTER UPDATE OF
  "adapter_workflow",
  "executor",
  "side_effect_mode",
  "side_effects_applied",
  "summary",
  "result_payload",
  "result_fingerprint",
  "worker_lease_id"
ON "ai_agent_runtime_execution_results"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_runtime_execution_result_content_update_restrict();
