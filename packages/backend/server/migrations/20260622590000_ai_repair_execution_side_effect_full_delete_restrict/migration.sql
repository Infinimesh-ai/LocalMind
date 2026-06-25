CREATE OR REPLACE FUNCTION ai_repair_execution_side_effect_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."workspace_id" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM "workspaces" workspace
       WHERE workspace."id" = OLD."workspace_id"
     ) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_repair_execution_requests" request
    WHERE request."id" = OLD."execution_request_id"
      AND request."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
      AND request."actor_id" IS NOT DISTINCT FROM OLD."actor_id"
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
