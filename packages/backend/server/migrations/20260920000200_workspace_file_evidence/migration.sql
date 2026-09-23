ALTER TABLE workspace_files ADD CONSTRAINT workspace_file_fingerprints CHECK (
  fingerprint ~ '^[a-f0-9]{64}$' AND request_fingerprint ~ '^[a-f0-9]{64}$'
);

CREATE FUNCTION guard_workspace_file_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source blobs;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Workspace file creation evidence is immutable';
  END IF;
  SELECT * INTO source FROM blobs WHERE workspace_id = NEW.workspace_id AND key = NEW.blob_key FOR SHARE;
  IF NOT FOUND OR source.status <> 'completed' OR source.deleted_at IS NOT NULL
     OR source.size IS DISTINCT FROM NEW.byte_size OR source.mime IS DISTINCT FROM NEW.mime_type THEN
    RAISE EXCEPTION 'Workspace file Blob evidence does not match';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_file_evidence_guard BEFORE INSERT OR UPDATE ON workspace_files
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_file_evidence();
