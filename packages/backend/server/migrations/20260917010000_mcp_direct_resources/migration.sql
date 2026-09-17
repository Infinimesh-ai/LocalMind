-- CreateTable
CREATE TABLE "mcp_resource_operations" (
    "id" VARCHAR NOT NULL,
    "contract_version" VARCHAR(64) NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "credential_family_id" VARCHAR NOT NULL,
    "credential_id" VARCHAR NOT NULL,
    "tool_name" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(256) NOT NULL,
    "request_fingerprint" VARCHAR(64) NOT NULL,
    "document_id" VARCHAR,
    "folder_id" VARCHAR,
    "parent_id" VARCHAR,
    "status" VARCHAR(32) NOT NULL DEFAULT 'processing',
    "result" JSONB,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "mcp_resource_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_resource_operation_events" (
    "id" VARCHAR NOT NULL,
    "operation_id" VARCHAR NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_resource_operation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_resource_external_documents" (
    "workspace_id" VARCHAR NOT NULL,
    "credential_family_id" VARCHAR NOT NULL,
    "external_id" VARCHAR(256) NOT NULL,
    "document_id" VARCHAR NOT NULL,
    "operation_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "mcp_resource_external_documents_pkey" PRIMARY KEY ("workspace_id","credential_family_id","external_id")
);

-- CreateTable
CREATE TABLE "workspace_doc_outbox" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "doc_id" VARCHAR NOT NULL,
    "editor_id" VARCHAR,
    "update" BYTEA NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_doc_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_resource_operations_workspace_id_actor_id_credential_fa_idx" ON "mcp_resource_operations"("workspace_id", "actor_id", "credential_family_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_resource_operation_identity" ON "mcp_resource_operations"("workspace_id", "actor_id", "credential_family_id", "tool_name", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_resource_operations_id_workspace_id_credential_family_i_key" ON "mcp_resource_operations"("id", "workspace_id", "credential_family_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_resource_operation_events_operation_id_sequence_key" ON "mcp_resource_operation_events"("operation_id", "sequence");

-- CreateIndex
CREATE INDEX "mcp_resource_external_documents_workspace_id_document_id_idx" ON "mcp_resource_external_documents"("workspace_id", "document_id");

-- CreateIndex
CREATE INDEX "workspace_doc_outbox_created_at_idx" ON "workspace_doc_outbox"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_credentials_id_family_id_user_id_workspace_id_key" ON "mcp_credentials"("id", "family_id", "user_id", "workspace_id");

-- AddForeignKey
ALTER TABLE "mcp_resource_operations" ADD CONSTRAINT "mcp_resource_operations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_resource_operations" ADD CONSTRAINT "mcp_resource_operations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_resource_operations" ADD CONSTRAINT "mcp_resource_operations_credential_id_credential_family_id_fkey" FOREIGN KEY ("credential_id", "credential_family_id", "actor_id", "workspace_id") REFERENCES "mcp_credentials"("id", "family_id", "user_id", "workspace_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_resource_operation_events" ADD CONSTRAINT "mcp_resource_operation_events_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "mcp_resource_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_resource_external_documents" ADD CONSTRAINT "mcp_resource_external_documents_operation_id_workspace_id__fkey" FOREIGN KEY ("operation_id", "workspace_id", "credential_family_id", "document_id") REFERENCES "mcp_resource_operations"("id", "workspace_id", "credential_family_id", "document_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE mcp_credentials DROP CONSTRAINT mcp_credentials_capabilities_check;

-- Preserve the old implicit capability set before broadening the catalog.
UPDATE mcp_credentials SET capabilities = CASE
  WHEN access_mode = 'READ_WRITE' THEN ARRAY['delegate_to_localmind', 'get_localmind_task', 'control_localmind_task']::text[]
  ELSE ARRAY['get_localmind_task']::text[] END
WHERE cardinality(capabilities) = 0;

ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_status_check CHECK (
  status IN ('processing', 'succeeded', 'failed', 'needs_reconciliation')
  AND ((status IN ('succeeded', 'failed')) = (completed_at IS NOT NULL))
  AND (status NOT IN ('succeeded', 'failed') OR result IS NOT NULL)
  AND contract_version = 'localmind-resource-mcp/v1'
  AND tool_name IN ('workspace_doc_create', 'workspace_doc_update', 'workspace_doc_update_meta', 'workspace_folder_create', 'workspace_folder_move_document')
  AND length(idempotency_key) BETWEEN 1 AND 256
  AND request_fingerprint ~ '^[a-f0-9]{64}$'
);
ALTER TABLE mcp_resource_operation_events ADD CONSTRAINT mcp_resource_event_check CHECK (
  sequence >= 0 AND status IN ('processing', 'executing', 'succeeded', 'failed', 'needs_reconciliation')
);
ALTER TABLE workspace_doc_outbox ADD CONSTRAINT workspace_doc_outbox_workspace_fk FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE FUNCTION guard_mcp_resource_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'MCP resource identity must be retained';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','result','error_code','completed_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','result','error_code','completed_at']) THEN
    RAISE EXCEPTION 'MCP resource identity is immutable';
  END IF;
  IF OLD.status IN ('succeeded', 'failed') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'MCP resource terminal result is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mcp_resource_operation_guard BEFORE UPDATE OR DELETE ON mcp_resource_operations
FOR EACH ROW EXECUTE FUNCTION guard_mcp_resource_operation();

CREATE FUNCTION guard_mcp_resource_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'mcp_resource_external_documents' THEN
    IF (to_jsonb(NEW) - 'deleted_at') = (to_jsonb(OLD) - 'deleted_at')
    AND (NEW.deleted_at IS NOT NULL OR OLD.deleted_at IS NULL)
    AND (OLD.deleted_at IS NULL OR NEW.deleted_at = OLD.deleted_at) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'MCP resource evidence is immutable';
END $$;
CREATE TRIGGER mcp_resource_events_guard BEFORE UPDATE OR DELETE ON mcp_resource_operation_events
FOR EACH ROW EXECUTE FUNCTION guard_mcp_resource_evidence();
CREATE TRIGGER mcp_resource_external_guard BEFORE UPDATE OR DELETE ON mcp_resource_external_documents
FOR EACH ROW EXECUTE FUNCTION guard_mcp_resource_evidence();

-- Cover native compaction/cleanup as well as Web/Electron/TypeScript sync.
-- Compaction retains its input timestamp; only new updates advance the clock.
CREATE FUNCTION lock_workspace_doc_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w text; d text; latest timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN w := OLD.workspace_id; d := OLD.guid;
  ELSE w := NEW.workspace_id; d := NEW.guid; END IF;
  -- Native compaction may already hold a row lock. Fail for queue retry
  -- instead of reversing the application lock order and deadlocking.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('doc:content-write:' || w || ':' || d, 0)) THEN
    RAISE EXCEPTION 'Concurrent document write; retry transaction' USING ERRCODE = '40001';
  END IF;
  IF TG_TABLE_NAME = 'updates' AND TG_OP = 'INSERT' THEN
    SELECT MAX(version) INTO latest FROM (
      SELECT updated_at AS version FROM snapshots WHERE workspace_id = w AND guid = d
      UNION ALL SELECT MAX(created_at) FROM updates WHERE workspace_id = w AND guid = d
    ) versions;
    IF latest IS NOT NULL AND NEW.created_at <= latest THEN NEW.created_at := latest + interval '1 millisecond'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workspace_snapshot_content_lock BEFORE INSERT OR UPDATE OR DELETE ON snapshots
FOR EACH ROW EXECUTE FUNCTION lock_workspace_doc_content();
CREATE TRIGGER workspace_updates_content_lock BEFORE INSERT OR UPDATE OR DELETE ON updates
FOR EACH ROW EXECUTE FUNCTION lock_workspace_doc_content();

CREATE FUNCTION tombstone_mcp_external_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE mcp_resource_external_documents SET deleted_at = clock_timestamp()
  WHERE workspace_id = OLD.workspace_id AND document_id = OLD.guid AND deleted_at IS NULL;
  RETURN OLD;
END $$;
CREATE TRIGGER mcp_external_document_tombstone AFTER DELETE ON snapshots
FOR EACH ROW EXECUTE FUNCTION tombstone_mcp_external_document();

ALTER TABLE mcp_credentials ADD CONSTRAINT mcp_credentials_capabilities_check CHECK (
  cardinality(capabilities) BETWEEN 1 AND 13 AND capabilities <@ ARRAY[
    'delegate_to_localmind','get_localmind_task','control_localmind_task',
    'workspace_doc_list','workspace_doc_keyword_search','workspace_doc_read',
    'workspace_doc_create','workspace_doc_update','workspace_doc_update_meta',
    'workspace_folder_list','workspace_folder_create','workspace_folder_move_document','workspace_operation_get'
  ]::text[] AND ((access_mode = 'READ_WRITE') = (capabilities && ARRAY[
    'delegate_to_localmind','control_localmind_task','workspace_doc_create','workspace_doc_update',
    'workspace_doc_update_meta','workspace_folder_create','workspace_folder_move_document'
  ]::text[]))
);

-- A success must identify this exact operation and its preallocated target.
ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_result_identity_check CHECK (
  status <> 'succeeded' OR (
    result->>'status' = 'succeeded' AND result->>'writeOutcome' = 'committed'
    AND result->>'operationId' = id AND result->>'workspaceId' = workspace_id
    AND result->>'toolName' = tool_name AND result->>'contractVersion' = contract_version
    AND CASE WHEN tool_name = 'workspace_folder_create' THEN result->>'folderId' = folder_id
      ELSE result->>'documentId' = document_id END
  ) IS TRUE
);

ALTER TABLE mcp_resource_operations ADD CONSTRAINT mcp_resource_target_check CHECK (
  (tool_name = 'workspace_folder_create' AND folder_id IS NOT NULL AND document_id IS NULL)
  OR (tool_name <> 'workspace_folder_create' AND document_id IS NOT NULL)
);

-- Bindings and receipts are committed together. Deferred validation permits
-- insertion before finish(), but rejects a binding to an unfinished/failed write.
CREATE FUNCTION validate_mcp_external_success() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mcp_resource_operations
    WHERE id = NEW.operation_id AND workspace_id = NEW.workspace_id
      AND credential_family_id = NEW.credential_family_id AND document_id = NEW.document_id
      AND tool_name = 'workspace_doc_create' AND status = 'succeeded') THEN
    RAISE EXCEPTION 'MCP external identity requires a committed creation';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER mcp_external_success AFTER INSERT ON mcp_resource_external_documents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_mcp_external_success();
