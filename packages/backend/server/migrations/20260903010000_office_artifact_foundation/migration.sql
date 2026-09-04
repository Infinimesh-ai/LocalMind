CREATE TYPE "OfficeArtifactKind" AS ENUM (
  'document',
  'workbook',
  'presentation',
  'pdf'
);

CREATE TYPE "OfficeRevisionOrigin" AS ENUM (
  'import',
  'user',
  'ai',
  'system'
);

CREATE TABLE "office_artifacts" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "kind" "OfficeArtifactKind" NOT NULL,
  "title" VARCHAR(512) NOT NULL,
  "source_file_name" VARCHAR(512) NOT NULL,
  "source_mime_type" VARCHAR(256) NOT NULL,
  "source_blob_key" VARCHAR NOT NULL,
  "source_byte_size" INTEGER NOT NULL,
  "source_fingerprint" VARCHAR(128) NOT NULL,
  "import_idempotency_key" VARCHAR(256) NOT NULL,
  "import_fingerprint" VARCHAR(128) NOT NULL,
  "revision_counter" INTEGER NOT NULL DEFAULT 0,
  "compatibility" JSONB NOT NULL DEFAULT '{}',
  "created_by" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "office_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "office_artifacts_shape_check" CHECK (
    length(btrim("title")) BETWEEN 1 AND 512 AND
    length(btrim("source_file_name")) BETWEEN 1 AND 512 AND
    length(btrim("source_mime_type")) BETWEEN 1 AND 256 AND
    length(btrim("source_blob_key")) BETWEEN 1 AND 1024 AND
    "source_byte_size" > 0 AND
    length(btrim("source_fingerprint")) BETWEEN 8 AND 128 AND
    length(btrim("import_idempotency_key")) BETWEEN 1 AND 256 AND
    length(btrim("import_fingerprint")) BETWEEN 8 AND 128 AND
    "revision_counter" >= 0 AND
    jsonb_typeof("compatibility") = 'object' AND
    octet_length("compatibility"::text) <= 65536 AND
    (
      ("kind" = 'document' AND "source_mime_type" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') OR
      ("kind" = 'workbook' AND "source_mime_type" = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') OR
      ("kind" = 'presentation' AND "source_mime_type" = 'application/vnd.openxmlformats-officedocument.presentationml.presentation') OR
      ("kind" = 'pdf' AND "source_mime_type" = 'application/pdf')
    )
  )
);

CREATE TABLE "office_revisions" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "artifact_id" VARCHAR NOT NULL,
  "sequence" INTEGER NOT NULL,
  "origin" "OfficeRevisionOrigin" NOT NULL,
  "parent_revision_id" VARCHAR,
  "idempotency_key" VARCHAR(256) NOT NULL,
  "idempotency_fingerprint" VARCHAR(128) NOT NULL,
  "package_blob_key" VARCHAR NOT NULL,
  "package_mime_type" VARCHAR(256) NOT NULL,
  "package_byte_size" INTEGER NOT NULL,
  "package_fingerprint" VARCHAR(128) NOT NULL,
  "state_blob_key" VARCHAR,
  "state_byte_size" INTEGER,
  "state_fingerprint" VARCHAR(128),
  "model_version" VARCHAR(128) NOT NULL DEFAULT 'localmind-office-model/v1',
  "operation_summary" JSONB NOT NULL DEFAULT '{}',
  "created_by" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "office_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "office_revisions_shape_check" CHECK (
    "sequence" >= 1 AND
    length(btrim("idempotency_key")) BETWEEN 1 AND 256 AND
    length(btrim("idempotency_fingerprint")) BETWEEN 8 AND 128 AND
    length(btrim("package_blob_key")) BETWEEN 1 AND 1024 AND
    length(btrim("package_mime_type")) BETWEEN 1 AND 256 AND
    "package_byte_size" > 0 AND
    length(btrim("package_fingerprint")) BETWEEN 8 AND 128 AND
    length(btrim("model_version")) BETWEEN 1 AND 128 AND
    jsonb_typeof("operation_summary") = 'object' AND
    octet_length("operation_summary"::text) <= 32768 AND
    (
      (
        "state_blob_key" IS NULL AND
        "state_byte_size" IS NULL AND
        "state_fingerprint" IS NULL
      ) OR (
        length(btrim("state_blob_key")) BETWEEN 1 AND 1024 AND
        "state_byte_size" > 0 AND
        length(btrim("state_fingerprint")) BETWEEN 8 AND 128
      )
    ) AND
    (
      ("sequence" = 1 AND "parent_revision_id" IS NULL) OR
      ("sequence" > 1 AND "parent_revision_id" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "office_artifacts_id_workspace_id_key"
  ON "office_artifacts"("id", "workspace_id");
CREATE UNIQUE INDEX "office_artifacts_workspace_import_idempotency_key"
  ON "office_artifacts"("workspace_id", "import_idempotency_key");
CREATE INDEX "office_artifacts_workspace_kind_updated_at_idx"
  ON "office_artifacts"("workspace_id", "kind", "updated_at" DESC);

CREATE UNIQUE INDEX "office_revisions_id_artifact_workspace_key"
  ON "office_revisions"("id", "artifact_id", "workspace_id");
CREATE UNIQUE INDEX "office_revisions_artifact_sequence_key"
  ON "office_revisions"("artifact_id", "sequence");
CREATE UNIQUE INDEX "office_revisions_artifact_idempotency_key"
  ON "office_revisions"("artifact_id", "idempotency_key");
CREATE INDEX "office_revisions_workspace_artifact_created_at_idx"
  ON "office_revisions"("workspace_id", "artifact_id", "created_at" DESC);

ALTER TABLE "office_artifacts"
  ADD CONSTRAINT "office_artifacts_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "office_artifacts"
  ADD CONSTRAINT "office_artifacts_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "office_artifacts"
  ADD CONSTRAINT "office_artifacts_source_blob_fkey"
  FOREIGN KEY ("workspace_id", "source_blob_key")
  REFERENCES "blobs"("workspace_id", "key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "office_revisions"
  ADD CONSTRAINT "office_revisions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "office_revisions"
  ADD CONSTRAINT "office_revisions_artifact_workspace_fkey"
  FOREIGN KEY ("artifact_id", "workspace_id")
  REFERENCES "office_artifacts"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "office_revisions"
  ADD CONSTRAINT "office_revisions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "office_revisions"
  ADD CONSTRAINT "office_revisions_parent_revision_id_fkey"
  FOREIGN KEY ("parent_revision_id") REFERENCES "office_revisions"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "office_revisions"
  ADD CONSTRAINT "office_revisions_package_blob_fkey"
  FOREIGN KEY ("workspace_id", "package_blob_key")
  REFERENCES "blobs"("workspace_id", "key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "office_revisions"
  ADD CONSTRAINT "office_revisions_state_blob_fkey"
  FOREIGN KEY ("workspace_id", "state_blob_key")
  REFERENCES "blobs"("workspace_id", "key")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION office_artifact_source_evidence_restrict()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" OR
     NEW."kind" IS DISTINCT FROM OLD."kind" OR
     NEW."source_file_name" IS DISTINCT FROM OLD."source_file_name" OR
     NEW."source_mime_type" IS DISTINCT FROM OLD."source_mime_type" OR
     NEW."source_blob_key" IS DISTINCT FROM OLD."source_blob_key" OR
     NEW."source_byte_size" IS DISTINCT FROM OLD."source_byte_size" OR
     NEW."source_fingerprint" IS DISTINCT FROM OLD."source_fingerprint" OR
     NEW."import_idempotency_key" IS DISTINCT FROM OLD."import_idempotency_key" OR
     NEW."import_fingerprint" IS DISTINCT FROM OLD."import_fingerprint" OR
     NEW."created_by" IS DISTINCT FROM OLD."created_by" OR
     NEW."created_at" IS DISTINCT FROM OLD."created_at" OR
     NEW."revision_counter" < OLD."revision_counter" OR
     NEW."revision_counter" > OLD."revision_counter" + 1 THEN
    RAISE EXCEPTION 'office_artifact_source_evidence_restrict_check';
  END IF;
  IF NEW."revision_counter" = OLD."revision_counter" + 1 AND NOT EXISTS (
    SELECT 1
    FROM "office_revisions"
    WHERE "artifact_id" = NEW."id"
      AND "workspace_id" = NEW."workspace_id"
      AND "sequence" = NEW."revision_counter"
  ) THEN
    RAISE EXCEPTION 'office_artifact_revision_counter_guard_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER office_artifact_source_evidence_restrict_check
  BEFORE UPDATE ON "office_artifacts"
  FOR EACH ROW
  EXECUTE FUNCTION office_artifact_source_evidence_restrict();

CREATE OR REPLACE FUNCTION office_artifact_blob_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "blobs"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "key" = NEW."source_blob_key"
      AND "mime" = NEW."source_mime_type"
      AND "size" = NEW."source_byte_size"
      AND "status" = 'completed'
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'office_artifact_source_blob_guard_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER office_artifact_source_blob_guard_check
  BEFORE INSERT ON "office_artifacts"
  FOR EACH ROW
  EXECUTE FUNCTION office_artifact_blob_guard();

CREATE OR REPLACE FUNCTION office_revision_immutable_restrict()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'office_revision_immutable_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER office_revision_immutable_restrict_check
  BEFORE UPDATE ON "office_revisions"
  FOR EACH ROW
  EXECUTE FUNCTION office_revision_immutable_restrict();

CREATE OR REPLACE FUNCTION office_revision_parent_guard()
RETURNS TRIGGER AS $$
DECLARE
  artifact_kind "OfficeArtifactKind";
  artifact_revision_counter INTEGER;
  artifact_source_blob_key VARCHAR;
  artifact_source_mime_type VARCHAR;
  artifact_source_byte_size INTEGER;
  artifact_source_fingerprint VARCHAR;
  artifact_import_idempotency_key VARCHAR;
  artifact_import_fingerprint VARCHAR;
  artifact_created_by VARCHAR;
  expected_package_mime_type VARCHAR;
  parent_sequence INTEGER;
BEGIN
  SELECT
    "kind",
    "revision_counter",
    "source_blob_key",
    "source_mime_type",
    "source_byte_size",
    "source_fingerprint",
    "import_idempotency_key",
    "import_fingerprint",
    "created_by"
  INTO
    artifact_kind,
    artifact_revision_counter,
    artifact_source_blob_key,
    artifact_source_mime_type,
    artifact_source_byte_size,
    artifact_source_fingerprint,
    artifact_import_idempotency_key,
    artifact_import_fingerprint,
    artifact_created_by
  FROM "office_artifacts"
  WHERE "id" = NEW."artifact_id"
    AND "workspace_id" = NEW."workspace_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_revision_artifact_guard_check';
  END IF;

  expected_package_mime_type := CASE artifact_kind
    WHEN 'document' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    WHEN 'workbook' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    WHEN 'presentation' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    WHEN 'pdf' THEN 'application/pdf'
  END;

  IF NEW."package_mime_type" <> expected_package_mime_type THEN
    RAISE EXCEPTION 'office_revision_package_mime_guard_check';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "blobs"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "key" = NEW."package_blob_key"
      AND "mime" = NEW."package_mime_type"
      AND "size" = NEW."package_byte_size"
      AND "status" = 'completed'
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'office_revision_package_blob_guard_check';
  END IF;

  IF NEW."state_blob_key" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "blobs"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "key" = NEW."state_blob_key"
      AND "size" = NEW."state_byte_size"
      AND "status" = 'completed'
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'office_revision_state_blob_guard_check';
  END IF;

  IF NEW."sequence" <> artifact_revision_counter + 1 THEN
    RAISE EXCEPTION 'office_revision_sequence_guard_check';
  END IF;

  IF NEW."sequence" = 1 THEN
    IF NEW."parent_revision_id" IS NOT NULL OR NEW."origin" <> 'import' THEN
      RAISE EXCEPTION 'office_revision_initial_parent_guard_check';
    END IF;
    IF NEW."package_blob_key" <> artifact_source_blob_key OR
       NEW."package_mime_type" <> artifact_source_mime_type OR
       NEW."package_byte_size" <> artifact_source_byte_size OR
       NEW."package_fingerprint" <> artifact_source_fingerprint OR
       NEW."idempotency_key" <> artifact_import_idempotency_key OR
       NEW."idempotency_fingerprint" <> artifact_import_fingerprint OR
       NEW."created_by" <> artifact_created_by THEN
      RAISE EXCEPTION 'office_revision_initial_evidence_guard_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."parent_revision_id" IS NULL OR NEW."origin" = 'import' THEN
    RAISE EXCEPTION 'office_revision_import_origin_guard_check';
  END IF;

  SELECT "sequence"
  INTO parent_sequence
  FROM "office_revisions"
  WHERE "id" = NEW."parent_revision_id"
    AND "artifact_id" = NEW."artifact_id"
    AND "workspace_id" = NEW."workspace_id";

  IF parent_sequence IS NULL OR parent_sequence <> NEW."sequence" - 1 THEN
    RAISE EXCEPTION 'office_revision_parent_guard_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER office_revision_parent_guard_check
  BEFORE INSERT ON "office_revisions"
  FOR EACH ROW
  EXECUTE FUNCTION office_revision_parent_guard();

CREATE OR REPLACE FUNCTION office_revision_counter_commit_guard()
RETURNS TRIGGER AS $$
DECLARE
  artifact_revision_counter INTEGER;
BEGIN
  SELECT "revision_counter"
  INTO artifact_revision_counter
  FROM "office_artifacts"
  WHERE "id" = NEW."artifact_id"
    AND "workspace_id" = NEW."workspace_id";

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF artifact_revision_counter < NEW."sequence" OR NOT EXISTS (
    SELECT 1
    FROM "office_revisions"
    WHERE "id" = NEW."id"
      AND "artifact_id" = NEW."artifact_id"
      AND "workspace_id" = NEW."workspace_id"
      AND "sequence" = NEW."sequence"
  ) THEN
    RAISE EXCEPTION 'office_revision_counter_commit_guard_check';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER office_revision_counter_commit_guard_check
  AFTER INSERT ON "office_revisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION office_revision_counter_commit_guard();

CREATE OR REPLACE FUNCTION office_artifact_initial_revision_commit_guard()
RETURNS TRIGGER AS $$
DECLARE
  artifact_revision_counter INTEGER;
BEGIN
  SELECT "revision_counter"
  INTO artifact_revision_counter
  FROM "office_artifacts"
  WHERE "id" = NEW."id"
    AND "workspace_id" = NEW."workspace_id";

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF artifact_revision_counter <> 1 OR NOT EXISTS (
    SELECT 1
    FROM "office_revisions"
    WHERE "artifact_id" = NEW."id"
      AND "workspace_id" = NEW."workspace_id"
      AND "sequence" = 1
  ) THEN
    RAISE EXCEPTION 'office_artifact_initial_revision_commit_guard_check';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER office_artifact_initial_revision_commit_guard_check
  AFTER INSERT ON "office_artifacts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION office_artifact_initial_revision_commit_guard();

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
    )
  ) THEN
    RAISE EXCEPTION 'office_blob_reference_restrict_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER office_blob_reference_restrict_check
  BEFORE UPDATE ON "blobs"
  FOR EACH ROW
  EXECUTE FUNCTION office_blob_reference_restrict();
