-- Shared-write checks remain immutable identity and authorization receipts.
-- The matching session purge lease may redact only their source payloads;
-- fingerprints and every other receipt field remain unchanged.
CREATE OR REPLACE FUNCTION protect_ai_shared_write_source_checks()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND current_setting('localmind.ai_session_purge_id', true) = OLD.session_id
    AND NEW.session_id = OLD.session_id
    AND NEW.sources = '[]'::jsonb
    AND NEW.audience_evidence = '{}'::jsonb
    AND (to_jsonb(NEW) - ARRAY['sources', 'audience_evidence']) =
      (to_jsonb(OLD) - ARRAY['sources', 'audience_evidence'])
    AND EXISTS (
      SELECT 1
      FROM ai_session_deletions deletion
      WHERE deletion.session_id = OLD.session_id
        AND deletion.status = 'purging'
        AND deletion.worker_lease_id =
          current_setting('localmind.ai_session_purge_lease', true)
    )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Shared write source checks are immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
