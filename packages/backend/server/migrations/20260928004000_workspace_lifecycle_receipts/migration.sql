CREATE TABLE workspace_lifecycle_operations (
  id VARCHAR NOT NULL PRIMARY KEY,
  workspace_id VARCHAR NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resource_id VARCHAR NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('doc', 'folder')),
  action VARCHAR(16) NOT NULL CHECK (action IN ('trash', 'restore', 'delete')),
  request_key VARCHAR(256) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX workspace_lifecycle_operation_request_key
  ON workspace_lifecycle_operations(workspace_id, actor_id, request_key);
CREATE INDEX workspace_lifecycle_operation_resource_created
  ON workspace_lifecycle_operations(workspace_id, resource_id, created_at);
CREATE FUNCTION protect_workspace_lifecycle_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Workspace lifecycle receipts are immutable';
END $$;
CREATE TRIGGER protect_workspace_lifecycle_receipt BEFORE UPDATE ON workspace_lifecycle_operations
  FOR EACH ROW EXECUTE FUNCTION protect_workspace_lifecycle_receipt();
