-- Completed context summaries are immutable private-session evidence. New
-- material creates another revision and moves the active pointer. Only the
-- matching deletion lease or the scoped account-deletion hook may remove the
-- private payload.
CREATE OR REPLACE FUNCTION protect_ai_context_checkpoints()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND (
      (
        current_setting('localmind.ai_session_purge_id', true) = OLD.session_id
        AND EXISTS (
          SELECT 1
          FROM ai_session_deletions deletion
          WHERE deletion.session_id = OLD.session_id
            AND deletion.status = 'purging'
            AND deletion.worker_lease_id =
              current_setting('localmind.ai_session_purge_lease', true)
        )
      )
      OR EXISTS (
        SELECT 1
        FROM ai_sessions_metadata session
        WHERE session.id = OLD.session_id
          AND session.user_id =
            current_setting('localmind.ai_context_user_delete_actor', true)
      )
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Context checkpoint revisions are immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_context_checkpoints_immutable
  ON ai_context_checkpoints;
CREATE TRIGGER ai_context_checkpoints_immutable
BEFORE UPDATE OR DELETE ON ai_context_checkpoints
FOR EACH ROW EXECUTE FUNCTION protect_ai_context_checkpoints();
