-- PostgreSQL may process the membership cascade before the session cascade on
-- account deletion. Remove the user's private sessions explicitly in the
-- existing BEFORE DELETE hook so immutable Project bindings never outlive the
-- membership check during that statement. Shared memories and their minimal
-- provenance survive through their SET NULL relationships.
CREATE OR REPLACE FUNCTION ai_context_cleanup_user_context_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('localmind.ai_context_user_delete_actor', OLD.id, true);

  DELETE FROM ai_sessions_metadata
  WHERE user_id = OLD.id;

  DELETE FROM ai_context_memory_events
  WHERE owner_user_id = OLD.id AND project_id IS NULL;

  DELETE FROM ai_context_memories
  WHERE owner_user_id = OLD.id AND scope <> 'project';

  DELETE FROM ai_context_rules
  WHERE owner_user_id = OLD.id AND scope <> 'project';

  UPDATE ai_context_memory_events
  SET owner_user_id = NULL, source_session_id = NULL
  WHERE owner_user_id = OLD.id AND project_id IS NOT NULL;

  UPDATE ai_context_memories
  SET owner_user_id = NULL, source_session_id = NULL
  WHERE owner_user_id = OLD.id AND scope = 'project';

  UPDATE ai_context_rules
  SET owner_user_id = NULL
  WHERE owner_user_id = OLD.id AND scope = 'project';

  UPDATE ai_context_rule_revisions revision
  SET created_by_user_id = NULL
  FROM ai_context_rules rule
  WHERE revision.created_by_user_id = OLD.id
    AND rule.id = revision.rule_id
    AND rule.scope = 'project';

  PERFORM set_config('localmind.ai_context_user_delete_actor', '', true);
  RETURN OLD;
END;
$$;
