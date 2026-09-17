\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT to_jsonb(t) FROM ai_mcp_delegation_requests t WHERE id='upgrade-in-flight')
    IS DISTINCT FROM (SELECT value FROM mcp_upgrade_evidence) THEN
    RAISE EXCEPTION 'In-flight delegation changed during resource migration';
  END IF;
  IF EXISTS (SELECT 1 FROM mcp_upgrade_credential_evidence e
    LEFT JOIN mcp_credentials c ON c.id=e.value->>'id' WHERE to_jsonb(c) IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'An existing explicit credential changed';
  END IF;
  IF (SELECT capabilities FROM mcp_credentials WHERE id='upgrade-implicit')
    IS DISTINCT FROM ARRAY['delegate_to_localmind','get_localmind_task','control_localmind_task']::text[] THEN
    RAISE EXCEPTION 'Historical default capabilities expanded';
  END IF;
  IF EXISTS (SELECT 1 FROM mcp_credentials WHERE revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A credential was revoked by the migration';
  END IF;
  IF (SELECT COUNT(*) FROM mcp_resource_operations) <> 0 THEN
    RAISE EXCEPTION 'Migration fabricated resource operations';
  END IF;
END $$;
SELECT 'credentials and in-flight delegation preserved; implicit defaults frozen' AS verified;
