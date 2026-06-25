CREATE OR REPLACE FUNCTION ai_agent_runtime_run_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workspaces" workspace
    WHERE workspace."id" = OLD."workspace_id"
  ) THEN
    RAISE EXCEPTION
      'ai_agent_runs_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_runs_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_runs_delete_restrict_check"
BEFORE DELETE
ON "ai_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_runtime_run_delete_restrict();
