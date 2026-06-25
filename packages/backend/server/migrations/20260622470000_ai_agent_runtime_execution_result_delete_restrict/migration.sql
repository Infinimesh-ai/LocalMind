CREATE OR REPLACE FUNCTION ai_agent_runtime_execution_result_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_agent_runs" run
    WHERE run."id" = OLD."run_id"
  ) THEN
    RAISE EXCEPTION
      'ai_agent_runtime_execution_results_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_agent_runtime_execution_results_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_agent_runtime_exec_results_delete_restrict_check"
AFTER DELETE
ON "ai_agent_runtime_execution_results"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_agent_runtime_execution_result_delete_restrict();
