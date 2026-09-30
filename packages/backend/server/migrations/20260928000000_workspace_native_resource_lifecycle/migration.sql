-- AlterTable
ALTER TABLE "workspace_files" ADD COLUMN     "origin" VARCHAR(32) NOT NULL DEFAULT 'ai',
ALTER COLUMN "source_session_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "workspace_file_states" (
    "file_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "metadata_version" INTEGER NOT NULL DEFAULT 1,
    "content_version" INTEGER NOT NULL,
    "trashed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "trash_source_id" VARCHAR,
    "restore_locations" JSONB NOT NULL DEFAULT '[]',
    "search_text" TEXT NOT NULL DEFAULT '',
    "search_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_file_states_pkey" PRIMARY KEY ("file_id")
);

-- CreateTable
CREATE TABLE "workspace_file_revisions" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "file_id" VARCHAR NOT NULL,
    "sequence" INTEGER NOT NULL,
    "parent_revision_id" VARCHAR,
    "blob_key" VARCHAR NOT NULL,
    "mime_type" VARCHAR(256) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "origin" VARCHAR(32) NOT NULL,
    "source_session_id" VARCHAR,
    "request_key" VARCHAR(256) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_file_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_office_states" (
    "artifact_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "metadata_version" INTEGER NOT NULL DEFAULT 1,
    "trashed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "trash_source_id" VARCHAR,
    "restore_locations" JSONB NOT NULL DEFAULT '[]',
    "search_text" TEXT NOT NULL DEFAULT '',
    "search_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_office_states_pkey" PRIMARY KEY ("artifact_id")
);

-- CreateTable
CREATE TABLE "workspace_native_operations" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "file_id" VARCHAR,
    "artifact_id" VARCHAR,
    "action" VARCHAR(64) NOT NULL,
    "request_key" VARCHAR(256) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_native_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_native_outbox" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_native_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_file_states_workspace_id_trashed_at_deleted_at_up_idx" ON "workspace_file_states"("workspace_id", "trashed_at", "deleted_at", "updated_at", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_file_states_file_id_workspace_id_key" ON "workspace_file_states"("file_id", "workspace_id");

-- CreateIndex
CREATE INDEX "workspace_file_revisions_workspace_id_file_id_created_at_idx" ON "workspace_file_revisions"("workspace_id", "file_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_file_revisions_id_file_id_workspace_id_key" ON "workspace_file_revisions"("id", "file_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_file_revisions_file_id_workspace_id_sequence_key" ON "workspace_file_revisions"("file_id", "workspace_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_file_revisions_file_id_actor_id_request_key_key" ON "workspace_file_revisions"("file_id", "actor_id", "request_key");

-- CreateIndex
CREATE INDEX "workspace_office_states_workspace_id_trashed_at_deleted_at__idx" ON "workspace_office_states"("workspace_id", "trashed_at", "deleted_at", "updated_at", "artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_office_states_artifact_id_workspace_id_key" ON "workspace_office_states"("artifact_id", "workspace_id");

-- CreateIndex
CREATE INDEX "workspace_native_operations_workspace_id_file_id_created_at_idx" ON "workspace_native_operations"("workspace_id", "file_id", "created_at");

-- CreateIndex
CREATE INDEX "workspace_native_operations_workspace_id_artifact_id_create_idx" ON "workspace_native_operations"("workspace_id", "artifact_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_native_operations_workspace_id_actor_id_request_k_key" ON "workspace_native_operations"("workspace_id", "actor_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_files_id_workspace_id_key" ON "workspace_files"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_file_states" ADD CONSTRAINT "workspace_file_states_file_id_workspace_id_fkey" FOREIGN KEY ("file_id", "workspace_id") REFERENCES "workspace_files"("id", "workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_file_states" ADD CONSTRAINT "workspace_file_states_file_id_workspace_id_content_version_fkey" FOREIGN KEY ("file_id", "workspace_id", "content_version") REFERENCES "workspace_file_revisions"("file_id", "workspace_id", "sequence") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_file_revisions" ADD CONSTRAINT "workspace_file_revisions_file_id_workspace_id_fkey" FOREIGN KEY ("file_id", "workspace_id") REFERENCES "workspace_files"("id", "workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_file_revisions" ADD CONSTRAINT "workspace_file_revisions_workspace_id_blob_key_fkey" FOREIGN KEY ("workspace_id", "blob_key") REFERENCES "blobs"("workspace_id", "key") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_file_revisions" ADD CONSTRAINT "workspace_file_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_file_revisions" ADD CONSTRAINT "workspace_file_revisions_parent_revision_id_file_id_worksp_fkey" FOREIGN KEY ("parent_revision_id", "file_id", "workspace_id") REFERENCES "workspace_file_revisions"("id", "file_id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_office_states" ADD CONSTRAINT "workspace_office_states_artifact_id_workspace_id_fkey" FOREIGN KEY ("artifact_id", "workspace_id") REFERENCES "office_artifacts"("id", "workspace_id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_native_operations" ADD CONSTRAINT "workspace_native_operations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_native_operations" ADD CONSTRAINT "workspace_native_operations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_native_operations" ADD CONSTRAINT "workspace_native_operations_file_id_workspace_id_fkey" FOREIGN KEY ("file_id", "workspace_id") REFERENCES "workspace_files"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_native_operations" ADD CONSTRAINT "workspace_native_operations_artifact_id_workspace_id_fkey" FOREIGN KEY ("artifact_id", "workspace_id") REFERENCES "office_artifacts"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "workspace_native_outbox" ADD CONSTRAINT "workspace_native_outbox_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE workspace_files ADD CONSTRAINT workspace_file_origin CHECK (
  origin IN ('ai', 'user', 'import', 'copy', 'publication') AND (origin <> 'ai' OR source_session_id IS NOT NULL)
);
ALTER TABLE workspace_file_revisions ADD CONSTRAINT workspace_file_revision_bounds CHECK (
  sequence > 0 AND byte_size >= 0 AND fingerprint ~ '^[a-f0-9]{64}$' AND request_hash ~ '^[a-f0-9]{64}$'
  AND origin IN ('ai', 'user', 'import', 'copy', 'publication', 'restore')
);
ALTER TABLE workspace_file_states ADD CONSTRAINT workspace_file_state_bounds CHECK (
  metadata_version > 0 AND content_version > 0 AND search_version BETWEEN 0 AND content_version
  AND (deleted_at IS NULL OR trashed_at IS NOT NULL) AND jsonb_typeof(restore_locations) = 'array'
);
ALTER TABLE workspace_office_states ADD CONSTRAINT workspace_office_state_bounds CHECK (
  metadata_version > 0 AND search_version >= 0 AND (deleted_at IS NULL OR trashed_at IS NOT NULL)
  AND jsonb_typeof(restore_locations) = 'array'
);
ALTER TABLE workspace_native_operations ADD CONSTRAINT workspace_native_operation_identity CHECK (
  (file_id IS NULL) <> (artifact_id IS NULL) AND request_hash ~ '^[a-f0-9]{64}$'
);

-- Old writers and retrying creates keep the same identity. No existing creation
-- evidence or immutable Blob is rewritten. Deterministic keys make backfill resumable.
INSERT INTO workspace_file_revisions (
  id, workspace_id, file_id, sequence, blob_key, mime_type, byte_size,
  fingerprint, actor_id, origin, source_session_id, request_key, request_hash, created_at
)
SELECT id || ':initial', workspace_id, id, 1, blob_key, mime_type, byte_size,
  fingerprint, created_by, origin, source_session_id, request_key, request_fingerprint, created_at
FROM workspace_files ON CONFLICT DO NOTHING;
INSERT INTO workspace_file_states (file_id, workspace_id, title, content_version, updated_at)
SELECT id, workspace_id, file_name, 1, created_at FROM workspace_files ON CONFLICT DO NOTHING;
INSERT INTO workspace_office_states (artifact_id, workspace_id, updated_at)
SELECT id, workspace_id, updated_at FROM office_artifacts WHERE workspace_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION initialize_workspace_native_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'workspace_files' THEN
    INSERT INTO workspace_file_revisions (
      id, workspace_id, file_id, sequence, blob_key, mime_type, byte_size,
      fingerprint, actor_id, origin, source_session_id, request_key, request_hash, created_at
    ) VALUES (NEW.id || ':initial', NEW.workspace_id, NEW.id, 1, NEW.blob_key, NEW.mime_type, NEW.byte_size,
      NEW.fingerprint, NEW.created_by, NEW.origin, NEW.source_session_id, NEW.request_key, NEW.request_fingerprint, NEW.created_at);
    INSERT INTO workspace_file_states (file_id, workspace_id, title, content_version)
      VALUES (NEW.id, NEW.workspace_id, NEW.file_name, 1);
  ELSIF NEW.workspace_id IS NOT NULL THEN
    INSERT INTO workspace_office_states (artifact_id, workspace_id) VALUES (NEW.id, NEW.workspace_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_file_state_init AFTER INSERT ON workspace_files
  FOR EACH ROW EXECUTE FUNCTION initialize_workspace_native_state();
CREATE TRIGGER workspace_office_state_init AFTER INSERT ON office_artifacts
  FOR EACH ROW EXECUTE FUNCTION initialize_workspace_native_state();

CREATE FUNCTION guard_workspace_file_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saved workspace_file_states; parent workspace_file_revisions; source blobs;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Workspace file revisions are immutable'; END IF;
  SELECT * INTO source FROM blobs WHERE workspace_id = NEW.workspace_id AND key = NEW.blob_key FOR SHARE;
  IF NOT FOUND OR source.status <> 'completed' OR source.deleted_at IS NOT NULL
    OR source.size IS DISTINCT FROM NEW.byte_size OR source.mime IS DISTINCT FROM NEW.mime_type THEN
    RAISE EXCEPTION 'Workspace file revision Blob evidence does not match';
  END IF;
  IF NEW.sequence = 1 THEN
    IF NEW.parent_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Initial revision cannot have a parent'; END IF;
  ELSE
    SELECT * INTO saved FROM workspace_file_states WHERE file_id = NEW.file_id AND workspace_id = NEW.workspace_id FOR UPDATE;
    IF NOT FOUND OR saved.trashed_at IS NOT NULL OR saved.deleted_at IS NOT NULL OR saved.content_version <> NEW.sequence - 1 THEN
      RAISE EXCEPTION 'Workspace file revision changed or is unavailable';
    END IF;
    SELECT * INTO parent FROM workspace_file_revisions WHERE file_id = NEW.file_id AND workspace_id = NEW.workspace_id AND sequence = saved.content_version;
    IF parent.id IS DISTINCT FROM NEW.parent_revision_id THEN RAISE EXCEPTION 'Workspace file revision parent changed'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_file_revision_guard BEFORE INSERT OR UPDATE ON workspace_file_revisions
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_file_revision();

CREATE FUNCTION guard_workspace_native_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Permanently deleted native resources cannot change';
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.metadata_version < OLD.metadata_version THEN
    RAISE EXCEPTION 'Native resource ownership and metadata versions cannot move backwards';
  END IF;
  IF TG_TABLE_NAME = 'workspace_file_states' THEN
    IF NEW.file_id IS DISTINCT FROM OLD.file_id OR NEW.content_version < OLD.content_version THEN
      RAISE EXCEPTION 'File identity and content versions cannot move backwards';
    END IF;
  ELSIF NEW.artifact_id IS DISTINCT FROM OLD.artifact_id THEN
    RAISE EXCEPTION 'Office resource identity cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_file_state_guard BEFORE UPDATE ON workspace_file_states
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_native_state();
CREATE TRIGGER workspace_office_state_guard BEFORE UPDATE ON workspace_office_states
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_native_state();

CREATE FUNCTION guard_workspace_native_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Native resource operation receipts are immutable'; END $$;
CREATE TRIGGER workspace_native_operation_guard BEFORE UPDATE ON workspace_native_operations
  FOR EACH ROW EXECUTE FUNCTION guard_workspace_native_operation();

CREATE FUNCTION notify_workspace_native_resource() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NOT NULL THEN
    INSERT INTO workspace_native_outbox (workspace_id) VALUES (NEW.workspace_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_file_state_notify AFTER INSERT OR UPDATE ON workspace_file_states
  FOR EACH ROW EXECUTE FUNCTION notify_workspace_native_resource();
CREATE TRIGGER workspace_office_state_notify AFTER INSERT OR UPDATE ON workspace_office_states
  FOR EACH ROW EXECUTE FUNCTION notify_workspace_native_resource();
CREATE TRIGGER workspace_office_revision_notify AFTER INSERT ON office_revisions
  FOR EACH ROW EXECUTE FUNCTION notify_workspace_native_resource();
