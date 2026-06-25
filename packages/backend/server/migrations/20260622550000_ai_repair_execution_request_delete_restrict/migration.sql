CREATE OR REPLACE FUNCTION ai_repair_execution_request_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workspaces" workspace
    WHERE workspace."id" = OLD."workspace_id"
  ) THEN
    RAISE EXCEPTION
      'ai_repair_execution_requests_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_repair_execution_requests_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_repair_execution_requests_delete_restrict_check"
BEFORE DELETE
ON "ai_repair_execution_requests"
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_request_delete_restrict();
