-- Existing files were previously marked indexed with an empty body.
UPDATE project_resources SET search_version = 0 WHERE kind = 'file' AND content_version > 0;

-- Content evidence remains immutable even if a legacy upload/cleanup path reaches
-- a blob referenced only by a newer native file revision.
CREATE FUNCTION protect_workspace_native_revision_blob() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR ROW(NEW.mime, NEW.size, NEW.status, NEW.deleted_at, NEW.key, NEW.workspace_id)
      IS DISTINCT FROM ROW(OLD.mime, OLD.size, OLD.status, OLD.deleted_at, OLD.key, OLD.workspace_id))
    AND EXISTS (SELECT 1 FROM workspace_file_revisions WHERE workspace_id = OLD.workspace_id AND blob_key = OLD.key) THEN
    RAISE EXCEPTION 'Native file revision blobs are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_workspace_native_revision_blob BEFORE UPDATE OR DELETE ON blobs
FOR EACH ROW EXECUTE FUNCTION protect_workspace_native_revision_blob();

-- Office appends cannot bypass a concurrent Workspace lifecycle transition.
CREATE FUNCTION check_workspace_office_revision_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_state workspace_office_states;
BEGIN
  IF NEW.workspace_id IS NOT NULL AND NEW.sequence > 1 THEN
    SELECT * INTO current_state FROM workspace_office_states WHERE artifact_id = NEW.artifact_id AND workspace_id = NEW.workspace_id FOR UPDATE;
    IF NOT FOUND OR current_state.trashed_at IS NOT NULL OR current_state.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Native Office resource is unavailable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_workspace_office_revision_lifecycle BEFORE INSERT ON office_revisions
FOR EACH ROW EXECUTE FUNCTION check_workspace_office_revision_lifecycle();
