ALTER TABLE "project_blobs"
  ADD COLUMN "deletion_pending_at" TIMESTAMPTZ(3),
  ADD COLUMN "pending_deletion_id" VARCHAR;

ALTER TABLE "ai_session_deletions"
  ADD COLUMN "hold_reason" VARCHAR,
  ADD COLUMN "held_at" TIMESTAMPTZ(3),
  ADD COLUMN "released_at" TIMESTAMPTZ(3);

ALTER TABLE "ai_session_deletions"
  ADD CONSTRAINT "ai_session_deletions_hold_state_check" CHECK (
    ("status" = 'held' AND "hold_reason" IS NOT NULL AND "held_at" IS NOT NULL)
    OR ("status" <> 'held' AND "hold_reason" IS NULL)
  );

ALTER TABLE "project_blobs"
  ADD CONSTRAINT "project_blobs_pending_deletion_pair_check" CHECK (
    ("deletion_pending_at" IS NULL) = ("pending_deletion_id" IS NULL)
  );

CREATE INDEX "project_blobs_pending_deletion_id_idx"
  ON "project_blobs"("pending_deletion_id");

DROP TRIGGER "project_blob_immutable" ON "project_blobs";

CREATE OR REPLACE FUNCTION localmind_guard_project_blob_evidence()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."project_id" IS DISTINCT FROM OLD."project_id"
      OR NEW."key" IS DISTINCT FROM OLD."key"
      OR NEW."mime_type" IS DISTINCT FROM OLD."mime_type"
      OR NEW."byte_size" IS DISTINCT FROM OLD."byte_size"
      OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
      OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    THEN
      RAISE EXCEPTION 'Project resource evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."pending_deletion_id" IS NULL
    OR current_setting('localmind.ai_session_blob_delete_id', true)
      IS DISTINCT FROM OLD."pending_deletion_id"
  THEN
    RAISE EXCEPTION 'Project resource evidence is immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "project_blob_immutable"
BEFORE UPDATE OR DELETE ON "project_blobs"
FOR EACH ROW EXECUTE FUNCTION localmind_guard_project_blob_evidence();

CREATE TABLE "ai_session_project_blob_references" (
  "session_id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "blob_key" VARCHAR(256) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_session_project_blob_references_pkey"
    PRIMARY KEY ("session_id", "project_id", "blob_key"),
  CONSTRAINT "ai_session_project_blob_references_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "ai_sessions_metadata"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_session_project_blob_references_blob_fkey"
    FOREIGN KEY ("project_id", "blob_key")
    REFERENCES "project_blobs"("project_id", "key")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ai_session_project_blob_references_project_id_blob_key_idx"
  ON "ai_session_project_blob_references"("project_id", "blob_key");

INSERT INTO "ai_session_project_blob_references" (
  "session_id",
  "project_id",
  "blob_key"
)
SELECT DISTINCT
  context."session_id",
  context."project_id",
  item->>'blobKey'
FROM "project_chat_contexts" context
CROSS JOIN LATERAL jsonb_array_elements(context."items") item
JOIN "project_blobs" blob
  ON blob."project_id" = context."project_id"
 AND blob."key" = item->>'blobKey'
WHERE item->>'kind' = 'blob'
  AND length(item->>'blobKey') > 0
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION localmind_guard_session_project_blob_reference()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "project_blobs" blob
    WHERE blob."project_id" = NEW."project_id"
      AND blob."key" = NEW."blob_key"
      AND blob."pending_deletion_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'project blob is pending deletion';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_session_project_blob_references_guard"
BEFORE INSERT OR UPDATE ON "ai_session_project_blob_references"
FOR EACH ROW EXECUTE FUNCTION localmind_guard_session_project_blob_reference();

CREATE OR REPLACE FUNCTION localmind_guard_project_blob_pending_deletion()
RETURNS trigger AS $$
BEGIN
  IF OLD."pending_deletion_id" IS NOT NULL AND (
    NEW."pending_deletion_id" IS DISTINCT FROM OLD."pending_deletion_id"
    OR NEW."deletion_pending_at" IS DISTINCT FROM OLD."deletion_pending_at"
  ) THEN
    RAISE EXCEPTION 'project blob pending deletion evidence is immutable';
  END IF;
  IF OLD."pending_deletion_id" IS NULL AND NEW."pending_deletion_id" IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM "ai_session_project_blob_references" reference
      WHERE reference."project_id" = NEW."project_id"
        AND reference."blob_key" = NEW."key"
    ) OR EXISTS (
      SELECT 1 FROM "project_resource_revisions" revision
      WHERE revision."project_id" = NEW."project_id"
        AND revision."blob_key" = NEW."key"
    ) OR EXISTS (
      SELECT 1 FROM "project_resource_attachments" attachment
      WHERE attachment."project_id" = NEW."project_id"
        AND attachment."key" = NEW."key"
    ) OR EXISTS (
      SELECT 1 FROM "office_artifacts" artifact
      WHERE artifact."project_id" = NEW."project_id"
        AND artifact."source_blob_key" = NEW."key"
    ) OR EXISTS (
      SELECT 1 FROM "office_revisions" revision
      WHERE revision."project_id" = NEW."project_id"
        AND (
          revision."package_blob_key" = NEW."key"
          OR revision."state_blob_key" = NEW."key"
        )
    ) OR EXISTS (
      SELECT 1 FROM "office_command_requests" request
      WHERE request."project_id" = NEW."project_id"
        AND request."command_blob_key" = NEW."key"
    ) THEN
      RAISE EXCEPTION 'referenced project blob cannot be marked for deletion';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "project_blobs_pending_deletion_guard"
BEFORE UPDATE OF "pending_deletion_id", "deletion_pending_at" ON "project_blobs"
FOR EACH ROW EXECUTE FUNCTION localmind_guard_project_blob_pending_deletion();
