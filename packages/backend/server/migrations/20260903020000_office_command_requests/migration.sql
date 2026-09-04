CREATE TABLE "office_command_requests" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "artifact_id" VARCHAR NOT NULL,
  "expected_revision_id" VARCHAR NOT NULL,
  "requested_by" VARCHAR NOT NULL,
  "idempotency_key" VARCHAR(256) NOT NULL,
  "command_blob_key" VARCHAR NOT NULL,
  "command_byte_size" INTEGER NOT NULL,
  "command_fingerprint" VARCHAR(128) NOT NULL,
  "preview_package_fingerprint" VARCHAR(128) NOT NULL,
  "preview_state_fingerprint" VARCHAR(128) NOT NULL,
  "preview_summary" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_command_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "office_command_requests_shape_check" CHECK (
    length(btrim("idempotency_key")) BETWEEN 1 AND 256 AND
    length(btrim("command_blob_key")) BETWEEN 1 AND 1024 AND
    "command_byte_size" BETWEEN 1 AND 33554432 AND
    length(btrim("command_fingerprint")) BETWEEN 8 AND 128 AND
    length(btrim("preview_package_fingerprint")) BETWEEN 8 AND 128 AND
    length(btrim("preview_state_fingerprint")) BETWEEN 8 AND 128 AND
    jsonb_typeof("preview_summary") = 'object' AND
    octet_length("preview_summary"::text) <= 32768
  )
);

CREATE UNIQUE INDEX "office_command_requests_id_workspace_id_key"
  ON "office_command_requests"("id", "workspace_id");
CREATE UNIQUE INDEX "office_command_requests_artifact_idempotency_key"
  ON "office_command_requests"("artifact_id", "idempotency_key");
CREATE INDEX "office_command_requests_workspace_artifact_created_at_idx"
  ON "office_command_requests"("workspace_id", "artifact_id", "created_at" DESC);
CREATE INDEX "office_command_requests_requested_by_created_at_idx"
  ON "office_command_requests"("requested_by", "created_at" DESC);

ALTER TABLE "office_command_requests"
  ADD CONSTRAINT "office_command_requests_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "office_command_requests"
  ADD CONSTRAINT "office_command_requests_artifact_workspace_fkey"
  FOREIGN KEY ("artifact_id", "workspace_id")
  REFERENCES "office_artifacts"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "office_command_requests"
  ADD CONSTRAINT "office_command_requests_revision_artifact_workspace_fkey"
  FOREIGN KEY ("expected_revision_id", "artifact_id", "workspace_id")
  REFERENCES "office_revisions"("id", "artifact_id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "office_command_requests"
  ADD CONSTRAINT "office_command_requests_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "office_command_requests"
  ADD CONSTRAINT "office_command_requests_command_blob_fkey"
  FOREIGN KEY ("workspace_id", "command_blob_key")
  REFERENCES "blobs"("workspace_id", "key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION office_command_request_immutable_restrict()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'office_command_request_immutable_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER office_command_request_immutable_restrict_check
  BEFORE UPDATE ON "office_command_requests"
  FOR EACH ROW
  EXECUTE FUNCTION office_command_request_immutable_restrict();

CREATE OR REPLACE FUNCTION office_command_request_blob_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "blobs"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "key" = NEW."command_blob_key"
      AND "mime" = 'application/vnd.localmind.office-command+json'
      AND "size" = NEW."command_byte_size"
      AND "status" = 'completed'
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'office_command_request_blob_guard_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER office_command_request_blob_guard_check
  BEFORE INSERT ON "office_command_requests"
  FOR EACH ROW
  EXECUTE FUNCTION office_command_request_blob_guard();

CREATE OR REPLACE FUNCTION office_blob_reference_restrict()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    NEW."mime" IS DISTINCT FROM OLD."mime" OR
    NEW."size" IS DISTINCT FROM OLD."size" OR
    NEW."status" IS DISTINCT FROM OLD."status" OR
    NEW."upload_id" IS DISTINCT FROM OLD."upload_id" OR
    NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
  ) AND (
    EXISTS (
      SELECT 1
      FROM "office_artifacts"
      WHERE "workspace_id" = OLD."workspace_id"
        AND "source_blob_key" = OLD."key"
    ) OR
    EXISTS (
      SELECT 1
      FROM "office_revisions"
      WHERE "workspace_id" = OLD."workspace_id"
        AND (
          "package_blob_key" = OLD."key" OR
          "state_blob_key" = OLD."key"
        )
    ) OR
    EXISTS (
      SELECT 1
      FROM "office_command_requests"
      WHERE "workspace_id" = OLD."workspace_id"
        AND "command_blob_key" = OLD."key"
    )
  ) THEN
    RAISE EXCEPTION 'office_blob_reference_restrict_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
