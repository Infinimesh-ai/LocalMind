CREATE TABLE workspace_folder_page_creations (
  workspace_id VARCHAR NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE,
  actor_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  request_key VARCHAR(128) NOT NULL CHECK (length(request_key) > 0),
  request_hash VARCHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  document_id VARCHAR NOT NULL,
  folder_id VARCHAR NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, actor_id, request_key),
  UNIQUE (workspace_id, document_id)
);
CREATE FUNCTION workspace_folder_page_creation_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION 'Folder page creation receipts are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER workspace_folder_page_creation_immutable BEFORE UPDATE OR DELETE
ON workspace_folder_page_creations FOR EACH ROW EXECUTE FUNCTION workspace_folder_page_creation_immutable();
