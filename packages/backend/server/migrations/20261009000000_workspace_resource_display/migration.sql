-- Historical states remain unknown until the bounded evidence backfill runs.
ALTER TABLE workspace_file_states
  ADD COLUMN last_updated_at TIMESTAMPTZ(3),
  ADD COLUMN last_updated_by VARCHAR,
  ADD COLUMN last_update_actor VARCHAR(16) NOT NULL DEFAULT 'unknown',
  ADD COLUMN last_update_event VARCHAR(512);
ALTER TABLE workspace_office_states
  ADD COLUMN last_updated_at TIMESTAMPTZ(3),
  ADD COLUMN last_updated_by VARCHAR,
  ADD COLUMN last_update_actor VARCHAR(16) NOT NULL DEFAULT 'unknown',
  ADD COLUMN last_update_event VARCHAR(512);
ALTER TABLE workspace_file_states ADD CONSTRAINT workspace_file_update_evidence CHECK (
  (last_update_actor = 'unknown' AND last_updated_by IS NULL) OR
  (last_update_actor = 'user' AND last_updated_by IS NOT NULL AND last_updated_at IS NOT NULL AND last_update_event IS NOT NULL) OR
  (last_update_actor = 'system' AND last_updated_by IS NULL AND last_updated_at IS NOT NULL AND last_update_event IS NOT NULL));
ALTER TABLE workspace_office_states ADD CONSTRAINT workspace_office_update_evidence CHECK (
  (last_update_actor = 'unknown' AND last_updated_by IS NULL) OR
  (last_update_actor = 'user' AND last_updated_by IS NOT NULL AND last_updated_at IS NOT NULL AND last_update_event IS NOT NULL) OR
  (last_update_actor = 'system' AND last_updated_by IS NULL AND last_updated_at IS NOT NULL AND last_update_event IS NOT NULL));
CREATE TABLE workspace_native_tags (
  id VARCHAR PRIMARY KEY,
  workspace_id VARCHAR NOT NULL,
  tag_id VARCHAR(256) NOT NULL,
  file_id VARCHAR,
  artifact_id VARCHAR,
  CONSTRAINT workspace_native_tag_identity CHECK (num_nonnulls(file_id, artifact_id) = 1),
  CONSTRAINT workspace_native_tag_file FOREIGN KEY (file_id, workspace_id) REFERENCES workspace_files(id, workspace_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT workspace_native_tag_office FOREIGN KEY (artifact_id, workspace_id) REFERENCES office_artifacts(id, workspace_id) ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX workspace_native_tags_file_id_tag_id_key ON workspace_native_tags(file_id, tag_id);
CREATE UNIQUE INDEX workspace_native_tags_artifact_id_tag_id_key ON workspace_native_tags(artifact_id, tag_id);
CREATE INDEX workspace_native_tags_workspace_id_tag_id_idx ON workspace_native_tags(workspace_id, tag_id);

CREATE OR REPLACE FUNCTION initialize_workspace_native_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'workspace_files' THEN
    INSERT INTO workspace_file_revisions (
      id, workspace_id, file_id, sequence, blob_key, mime_type, byte_size,
      fingerprint, actor_id, origin, source_session_id, request_key, request_hash, created_at
    ) VALUES (NEW.id || ':initial', NEW.workspace_id, NEW.id, 1, NEW.blob_key, NEW.mime_type, NEW.byte_size,
      NEW.fingerprint, NEW.created_by, NEW.origin, NEW.source_session_id, NEW.request_key, NEW.request_fingerprint, NEW.created_at);
    INSERT INTO workspace_file_states (file_id, workspace_id, title, content_version, last_updated_at, last_updated_by, last_update_actor, last_update_event)
      VALUES (NEW.id, NEW.workspace_id, NEW.file_name, 1, NEW.created_at, NEW.created_by, 'user', 'create:' || NEW.id);
  ELSIF NEW.workspace_id IS NOT NULL THEN
    INSERT INTO workspace_office_states (artifact_id, workspace_id, last_updated_at, last_updated_by, last_update_actor, last_update_event)
      VALUES (NEW.id, NEW.workspace_id, NEW.created_at, NEW.created_by, 'user', 'create:' || NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION update_workspace_office_display_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NOT NULL AND NEW.sequence > 1 THEN
    UPDATE workspace_office_states SET
      last_updated_at = NEW.created_at,
      last_updated_by = CASE WHEN NEW.origin = 'system' THEN NULL ELSE NEW.created_by END,
      last_update_actor = CASE WHEN NEW.origin = 'system' THEN 'system' ELSE 'user' END,
      last_update_event = 'revision:' || NEW.id
    WHERE artifact_id = NEW.artifact_id AND workspace_id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_office_display_event AFTER INSERT ON office_revisions
  FOR EACH ROW EXECUTE FUNCTION update_workspace_office_display_event();
