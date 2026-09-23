-- Account deletion removes the user's private sessions before membership
-- cleanup. Permit immutable source evidence to follow that cascade only while
-- the scoped account-deletion hook identifies the same session owner.
CREATE OR REPLACE FUNCTION protect_ai_session_context_sources()
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

  RAISE EXCEPTION 'Session context source evidence is immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
