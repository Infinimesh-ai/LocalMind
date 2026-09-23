-- Session source evidence is append-only during normal operation. A deletion
-- worker may remove it only inside the transaction that owns the matching
-- persisted purge lease. This keeps the evidence guard fail-closed without
-- preventing the authorized private-content lifecycle from completing.
CREATE OR REPLACE FUNCTION protect_ai_session_context_sources()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('localmind.ai_session_purge_id', true) = OLD.session_id
    AND EXISTS (
      SELECT 1
      FROM ai_session_deletions deletion
      WHERE deletion.session_id = OLD.session_id
        AND deletion.status = 'purging'
        AND deletion.worker_lease_id =
          current_setting('localmind.ai_session_purge_lease', true)
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Session context source evidence is immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
