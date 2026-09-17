\set ON_ERROR_STOP on
INSERT INTO users (id,name,email) VALUES ('upgrade-user','Upgrade fixture','mcp-upgrade@example.invalid');
INSERT INTO workspaces (id) VALUES ('upgrade-workspace');
INSERT INTO mcp_credentials (id,family_id,generation,name,secret_hash,fingerprint,user_id,workspace_id,access_mode,capabilities,expires_at)
VALUES ('upgrade-explicit','upgrade-explicit-family',0,'Explicit','fixture-hash-one','fixture-fp-one','upgrade-user','upgrade-workspace','READ_WRITE',ARRAY['delegate_to_localmind','get_localmind_task','control_localmind_task'],CURRENT_TIMESTAMP + INTERVAL '90 days'),
('upgrade-read','upgrade-read-family',0,'Read','fixture-hash-two','fixture-fp-two','upgrade-user','upgrade-workspace','READ_ONLY',ARRAY['get_localmind_task'],CURRENT_TIMESTAMP + INTERVAL '90 days');
INSERT INTO ai_mcp_delegation_requests (id,workspace_id,actor_id,credential_id,credential_family_id,credential_generation,capability_snapshot,capability_fingerprint,idempotency_key,request_text,requested_document_ids,request_fingerprint,status,updated_at)
VALUES ('upgrade-in-flight','upgrade-workspace','upgrade-user','upgrade-explicit','upgrade-explicit-family',0,ARRAY['delegate_to_localmind','get_localmind_task','control_localmind_task'],'fixture-capability-fingerprint','in-flight','Fixture task already accepted',ARRAY[]::varchar[],'fixture-request-fingerprint','processing',CURRENT_TIMESTAMP);
CREATE TABLE mcp_upgrade_evidence AS SELECT to_jsonb(t) AS value FROM ai_mcp_delegation_requests t;
CREATE TABLE mcp_upgrade_credential_evidence AS SELECT to_jsonb(c) AS value FROM mcp_credentials c;
-- Reproduce historical empty arrays predating the old strict capability check.
ALTER TABLE mcp_credentials DROP CONSTRAINT mcp_credentials_capabilities_check;
INSERT INTO mcp_credentials (id,family_id,generation,name,secret_hash,fingerprint,user_id,workspace_id,access_mode,capabilities,expires_at)
VALUES ('upgrade-implicit','upgrade-implicit-family',0,'Implicit','fixture-hash-three','fixture-fp-three','upgrade-user','upgrade-workspace','READ_WRITE',ARRAY[]::text[],CURRENT_TIMESTAMP + INTERVAL '90 days');
ALTER TABLE mcp_credentials ADD CONSTRAINT mcp_credentials_capabilities_check CHECK (cardinality(capabilities) <= 3);
