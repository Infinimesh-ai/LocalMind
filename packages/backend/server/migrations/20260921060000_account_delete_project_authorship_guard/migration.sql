-- Shared Project assets may retain a null historical author after account
-- deletion. Only the scoped account-deletion trigger may perform that
-- transition; normal inserts and updates still require current membership.
CREATE OR REPLACE FUNCTION ai_context_assert_project_member_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
    AND NEW.owner_user_id IS NULL
    AND TG_OP = 'UPDATE'
    AND OLD.owner_user_id IS NOT NULL
    AND NEW.project_id = OLD.project_id
    AND current_setting('localmind.ai_context_user_delete_actor', true) =
      OLD.owner_user_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM ai_context_projects project
    JOIN ai_context_project_members member
      ON member.project_id = project.id
    WHERE project.id = NEW.project_id
      AND project.status = 'active'
      AND member.user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Project-scoped AI context requires active project membership'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_context_assert_project_owner_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
    AND NEW.owner_user_id IS NULL
    AND TG_OP = 'UPDATE'
    AND OLD.owner_user_id IS NOT NULL
    AND NEW.project_id = OLD.project_id
    AND current_setting('localmind.ai_context_user_delete_actor', true) =
      OLD.owner_user_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM ai_context_projects project
    JOIN ai_context_project_members member
      ON member.project_id = project.id
    WHERE project.id = NEW.project_id
      AND project.status = 'active'
      AND member.user_id = NEW.owner_user_id
      AND member.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Project-scoped AI context rule requires active project ownership'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
