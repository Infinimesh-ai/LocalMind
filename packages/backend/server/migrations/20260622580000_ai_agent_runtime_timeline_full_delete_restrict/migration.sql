CREATE OR REPLACE FUNCTION ai_agent_runtime_timeline_delete_restrict()
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
    FROM "ai_agent_runs" run
    WHERE run."id" = OLD."run_id"
      AND run."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
      AND run."actor_id" IS NOT DISTINCT FROM OLD."actor_id"
  ) THEN
    RAISE EXCEPTION
      'ai_agent_timeline_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_timeline_events_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
