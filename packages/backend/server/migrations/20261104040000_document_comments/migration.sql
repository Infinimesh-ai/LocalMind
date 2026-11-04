CREATE TABLE document_comment_states (
  workspace_id VARCHAR NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('blocksuite', 'office')),
  resource_id VARCHAR NOT NULL,
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  PRIMARY KEY (workspace_id, kind, resource_id)
);
CREATE TABLE document_event_outbox (
  id VARCHAR PRIMARY KEY,
  workspace_id VARCHAR NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX document_event_outbox_created_at_idx ON document_event_outbox(created_at);

CREATE FUNCTION document_comment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r JSONB; old_r JSONB; w VARCHAR; d VARCHAR; k VARCHAR;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_OP = 'UPDATE' THEN
    old_r := to_jsonb(OLD);
    IF (r - 'updated_at') = (old_r - 'updated_at') THEN RETURN NEW; END IF;
    IF (r->>'workspace_id', r->>'project_id', r->>'doc_id', r->>'artifact_id', r->>'comment_id')
      IS DISTINCT FROM (old_r->>'workspace_id', old_r->>'project_id', old_r->>'doc_id', old_r->>'artifact_id', old_r->>'comment_id') THEN
      RAISE EXCEPTION 'Comment identity is immutable';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'office_comment_replies' THEN
    SELECT workspace_id, artifact_id INTO w, d FROM office_comments WHERE id = r->>'comment_id';
    k := 'office';
  ELSIF TG_TABLE_NAME = 'office_comments' THEN
    w := r->>'workspace_id'; d := r->>'artifact_id'; k := 'office';
  ELSE
    w := r->>'workspace_id'; d := r->>'doc_id'; k := 'blocksuite';
  END IF;
  -- Project comments retain their independent owner contract. During workspace
  -- cascades there is no surviving version or notification to maintain.
  IF w IS NOT NULL AND d IS NOT NULL AND EXISTS (SELECT 1 FROM workspaces WHERE id = w) THEN
    INSERT INTO document_comment_states(workspace_id, kind, resource_id, version)
      VALUES (w, k, d, 1)
      ON CONFLICT (workspace_id, kind, resource_id)
      DO UPDATE SET version = document_comment_states.version + 1;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER comments_document_revision BEFORE INSERT OR UPDATE OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION document_comment_revision();
CREATE TRIGGER replies_document_revision BEFORE INSERT OR UPDATE OR DELETE ON replies FOR EACH ROW EXECUTE FUNCTION document_comment_revision();
CREATE TRIGGER office_comments_document_revision BEFORE INSERT OR UPDATE OR DELETE ON office_comments FOR EACH ROW EXECUTE FUNCTION document_comment_revision();
CREATE TRIGGER office_replies_document_revision BEFORE INSERT OR UPDATE OR DELETE ON office_comment_replies FOR EACH ROW EXECUTE FUNCTION document_comment_revision();
