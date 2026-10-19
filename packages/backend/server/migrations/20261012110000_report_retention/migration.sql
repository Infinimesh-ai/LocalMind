-- CreateTable
CREATE TABLE "project_report_deletions" (
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "request_key" VARCHAR(256) NOT NULL,
    "expected_version" INTEGER NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'requested',
    "eligible_at" TIMESTAMPTZ(3) NOT NULL,
    "lease_id" VARCHAR,
    "lease_expires_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(128),
    "hold_reason" VARCHAR(256),
    "held_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "project_report_deletions_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "project_report_blob_deletions" (
    "id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "blob_key" VARCHAR(256) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "project_report_blob_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_report_deletions_status_eligible_at_idx" ON "project_report_deletions"("status", "eligible_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_deletions_report_id_project_id_key" ON "project_report_deletions"("report_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_deletions_project_id_actor_id_request_key_key" ON "project_report_deletions"("project_id", "actor_id", "request_key");

-- CreateIndex
CREATE INDEX "project_report_blob_deletions_status_created_at_idx" ON "project_report_blob_deletions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_blob_deletions_report_id_blob_key_key" ON "project_report_blob_deletions"("report_id", "blob_key");

-- AddForeignKey
ALTER TABLE "project_report_deletions" ADD CONSTRAINT "project_report_deletions_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_blob_deletions" ADD CONSTRAINT "project_report_blob_deletions_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE project_realtime_outbox DROP CONSTRAINT project_realtime_topic;
ALTER TABLE project_realtime_outbox ADD CONSTRAINT project_realtime_topic CHECK (topic IN (
 'project.list.changed', 'project.task.changed', 'project.lease.changed', 'project.resource.changed',
 'project.report.changed', 'project.report.template.changed', 'project.report.schedule.changed'
));
ALTER TABLE project_report_deletions ADD CONSTRAINT report_deletion_status CHECK (status IN ('requested','held','purging','purged')),
 ADD CONSTRAINT report_deletion_attempts CHECK (attempts >= 0 AND expected_version > 0),
 ADD CONSTRAINT report_deletion_lease CHECK ((lease_id IS NULL) = (lease_expires_at IS NULL));
ALTER TABLE project_report_blob_deletions ADD CONSTRAINT report_blob_deletion_status CHECK (status IN ('pending','deleted','retained'));
CREATE FUNCTION localmind_guard_report_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Report deletion evidence is immutable'; END IF;
 IF ROW(NEW.report_id, NEW.project_id, NEW.actor_id, NEW.request_key, NEW.expected_version, NEW.fingerprint, NEW.eligible_at, NEW.created_at)
 IS DISTINCT FROM ROW(OLD.report_id, OLD.project_id, OLD.actor_id, OLD.request_key, OLD.expected_version, OLD.fingerprint, OLD.eligible_at, OLD.created_at)
 THEN RAISE EXCEPTION 'Report deletion evidence is immutable'; END IF;
 IF OLD.status = 'purged' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Report purge is terminal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_deletion_evidence_guard BEFORE UPDATE OR DELETE ON project_report_deletions FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_deletion();
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
    OR (current_setting('localmind.ai_session_blob_delete_id', true) IS DISTINCT FROM OLD."pending_deletion_id" AND current_setting('localmind.report_blob_delete_id', true) IS DISTINCT FROM OLD."pending_deletion_id")
  THEN
    RAISE EXCEPTION 'Project resource evidence is immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

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
    ) OR EXISTS (SELECT 1 FROM project_report_blob_references r WHERE r.project_id=NEW.project_id AND r.blob_key=NEW.key) OR EXISTS (SELECT 1 FROM project_report_revisions r WHERE r.project_id=NEW.project_id AND r.content_blob_key=NEW.key) OR EXISTS (SELECT 1 FROM project_report_source_manifests r WHERE r.project_id=NEW.project_id AND r.blob_key=NEW.key) OR EXISTS (SELECT 1 FROM project_report_exports r WHERE r.project_id=NEW.project_id AND r.blob_key=NEW.key) OR EXISTS (SELECT 1 FROM project_report_share_revisions r WHERE r.project_id=NEW.project_id AND r.projection_blob_key=NEW.key) THEN
      RAISE EXCEPTION 'referenced project blob cannot be marked for deletion';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE FUNCTION localmind_guard_report_blob_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blob_key_value TEXT;
BEGIN
 blob_key_value := to_jsonb(NEW)->>TG_ARGV[0];
 IF blob_key_value IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM project_blobs WHERE project_id=NEW.project_id AND key=blob_key_value AND pending_deletion_id IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report blob is unavailable or pending deletion'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_blob_reference_guard BEFORE INSERT OR UPDATE OF blob_key ON project_report_blob_references FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('blob_key');
CREATE TRIGGER report_blob_reference_guard BEFORE INSERT OR UPDATE OF content_blob_key ON project_report_revisions FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('content_blob_key');
CREATE TRIGGER report_blob_reference_guard BEFORE INSERT OR UPDATE OF blob_key ON project_report_source_manifests FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('blob_key');
CREATE TRIGGER report_blob_reference_guard BEFORE INSERT OR UPDATE OF blob_key ON project_report_exports FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('blob_key');
CREATE TRIGGER report_blob_reference_guard BEFORE INSERT OR UPDATE OF projection_blob_key ON project_report_share_revisions FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('projection_blob_key');
