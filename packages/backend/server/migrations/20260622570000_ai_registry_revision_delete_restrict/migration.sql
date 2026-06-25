CREATE OR REPLACE FUNCTION ai_registry_revision_delete_allowed(
  workspace_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT workspace_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "workspaces" workspace
      WHERE workspace."id" = workspace_id
    );
$$;

CREATE OR REPLACE FUNCTION ai_prompt_registry_revision_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF NOT ai_registry_revision_delete_allowed(OLD."workspace_id") THEN
    RAISE EXCEPTION
      'ai_prompt_registry_revisions_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_prompt_registry_revisions_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_prompt_registry_revisions_delete_restrict_check"
BEFORE DELETE
ON "ai_prompt_registry_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_prompt_registry_revision_delete_restrict();

CREATE OR REPLACE FUNCTION ai_task_route_policy_revision_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF NOT ai_registry_revision_delete_allowed(OLD."workspace_id") THEN
    RAISE EXCEPTION
      'ai_task_route_policy_revisions_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_task_route_policy_revisions_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_task_route_policy_revisions_delete_restrict_check"
BEFORE DELETE
ON "ai_task_route_policy_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_task_route_policy_revision_delete_restrict();

CREATE OR REPLACE FUNCTION ai_model_registry_revision_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF NOT ai_registry_revision_delete_allowed(OLD."workspace_id") THEN
    RAISE EXCEPTION
      'ai_model_registry_revisions_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_model_registry_revisions_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_model_registry_revisions_delete_restrict_check"
BEFORE DELETE
ON "ai_model_registry_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_model_registry_revision_delete_restrict();

CREATE OR REPLACE FUNCTION ai_provider_registry_revision_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF NOT ai_registry_revision_delete_allowed(OLD."workspace_id") THEN
    RAISE EXCEPTION
      'ai_provider_registry_revisions_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_provider_registry_revisions_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_registry_revisions_delete_restrict_check"
BEFORE DELETE
ON "ai_provider_registry_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_registry_revision_delete_restrict();
