-- Intentionally no resource foreign key: a rolled-back or deleted resource must
-- not erase the only record of an orphaned physical object.
CREATE TABLE document_object_stages (
  storage_key VARCHAR PRIMARY KEY,
  workspace_id VARCHAR NOT NULL,
  doc_id VARCHAR,
  blob_id VARCHAR NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  expires_at TIMESTAMPTZ(3) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX document_object_stages_expires_at_idx ON document_object_stages(expires_at);
CREATE INDEX document_object_stages_workspace_id_idx ON document_object_stages(workspace_id);
