CREATE OR REPLACE FUNCTION ai_provider_health_state_delete_restrict()
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

  RAISE EXCEPTION
    'ai_provider_health_states_delete_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_provider_health_states_delete_restrict_check';
END;
$$ LANGUAGE plpgsql;
