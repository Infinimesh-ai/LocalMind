CREATE OR REPLACE FUNCTION ai_support_bundle_request_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workspaces" workspace
    WHERE workspace."id" = OLD."workspace_id"
  ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_requests_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_support_bundle_requests_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_support_bundle_requests_delete_restrict_check"
BEFORE DELETE
ON "ai_support_bundle_requests"
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_request_delete_restrict();
