CREATE TABLE mcp_document_uploads (
  id VARCHAR PRIMARY KEY,
  operation_id VARCHAR NOT NULL UNIQUE REFERENCES mcp_resource_operations(id) ON DELETE CASCADE,
  mime_type VARCHAR(256) NOT NULL,
  total_bytes INTEGER NOT NULL CHECK (total_bytes BETWEEN 0 AND 33554432),
  fingerprint VARCHAR(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','aborted','expired')),
  blob_id VARCHAR,
  expires_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'completed') = (blob_id IS NOT NULL))
);
CREATE INDEX mcp_document_uploads_status_expires_at_idx ON mcp_document_uploads(status, expires_at);
CREATE TABLE mcp_document_upload_parts (
  upload_id VARCHAR NOT NULL REFERENCES mcp_document_uploads(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number BETWEEN 0 AND 63),
  bytes BYTEA NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 524288),
  PRIMARY KEY (upload_id, number)
);
CREATE FUNCTION preserve_mcp_document_upload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.total_bytes IS DISTINCT FROM OLD.total_bytes
     OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.status <> 'pending' AND NEW IS DISTINCT FROM OLD)
  THEN RAISE EXCEPTION 'MCP upload identity and terminal evidence are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mcp_document_upload_immutable BEFORE UPDATE ON mcp_document_uploads
FOR EACH ROW EXECUTE FUNCTION preserve_mcp_document_upload();
CREATE FUNCTION preserve_mcp_document_upload_part() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'MCP upload parts are immutable'; END $$;
CREATE TRIGGER mcp_document_upload_part_immutable BEFORE UPDATE ON mcp_document_upload_parts
FOR EACH ROW EXECUTE FUNCTION preserve_mcp_document_upload_part();
