-- CreateTable
CREATE TABLE "project_reports" (
    "id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "created_by_actor_id" VARCHAR NOT NULL,
    "creator_label" VARCHAR(512) NOT NULL,
    "responsibility" JSONB NOT NULL,
    "lifecycle" VARCHAR(16) NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision_counter" INTEGER NOT NULL DEFAULT 0,
    "draft_revision_id" VARCHAR,
    "latest_final_revision_id" VARCHAR,
    "previous_report_id" VARCHAR,
    "previous_revision_id" VARCHAR,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "time_zone" VARCHAR(128) NOT NULL,
    "template_revision_id" VARCHAR NOT NULL,
    "selection" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_revisions" (
    "id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "parent_revision_id" VARCHAR,
    "content_blob_key" VARCHAR(256) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "source_manifest_id" VARCHAR,
    "actor_id" VARCHAR NOT NULL,
    "reason" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_source_manifests" (
    "id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "run_id" VARCHAR,
    "blob_key" VARCHAR(256) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "cutoff_at" TIMESTAMPTZ(3) NOT NULL,
    "coverage" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_source_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_templates" (
    "id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "builtin_key" VARCHAR(64),
    "name" VARCHAR(512) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision_counter" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR NOT NULL,
    "current_revision_id" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_template_revisions" (
    "id" VARCHAR NOT NULL,
    "template_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "sequence" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_template_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_edit_leases" (
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "lease_id" VARCHAR NOT NULL,
    "holder_id" VARCHAR NOT NULL,
    "tab_id" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "task_id" VARCHAR,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_report_edit_leases_pkey" PRIMARY KEY ("report_id")
);

-- CreateTable
CREATE TABLE "project_report_comments" (
    "id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "revision_id" VARCHAR NOT NULL,
    "node_id" VARCHAR(256),
    "anchor_text" VARCHAR(2000) NOT NULL,
    "parent_id" VARCHAR,
    "actor_id" VARCHAR NOT NULL,
    "content" TEXT NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" VARCHAR,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_reviews" (
    "id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "revision_id" VARCHAR NOT NULL,
    "requested_by" VARCHAR NOT NULL,
    "reviewer_id" VARCHAR NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "project_report_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_exports" (
    "id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "revision_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "request_key" VARCHAR(256) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "format" VARCHAR(16) NOT NULL,
    "audience" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "run_id" VARCHAR,
    "blob_key" VARCHAR(256),
    "mime_type" VARCHAR(128),
    "compatibility" JSONB NOT NULL DEFAULT '[]',
    "resource_id" VARCHAR,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_shares" (
    "id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision_counter" INTEGER NOT NULL DEFAULT 0,
    "current_revision_id" VARCHAR,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_share_revisions" (
    "id" VARCHAR NOT NULL,
    "share_id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "report_revision_id" VARCHAR NOT NULL,
    "sequence" INTEGER NOT NULL,
    "audience" JSONB NOT NULL,
    "access_mode" VARCHAR(16) NOT NULL,
    "recipient_ids" VARCHAR[],
    "token_hash" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR,
    "allow_download" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "projection_blob_key" VARCHAR(256) NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_share_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_schedules" (
    "id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "title" VARCHAR(512) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "template_revision_id" VARCHAR NOT NULL,
    "config" JSONB NOT NULL,
    "authorization" JSONB NOT NULL,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_occurrences" (
    "id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "schedule_id" VARCHAR NOT NULL,
    "nominal_time" VARCHAR(64) NOT NULL,
    "time_zone" VARCHAR(128) NOT NULL,
    "config_version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "report_id" VARCHAR,
    "run_id" VARCHAR,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_deliveries" (
    "id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "occurrence_id" VARCHAR NOT NULL,
    "recipient_key" VARCHAR(512) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "authorization_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lease_id" VARCHAR,
    "lease_expires_at" TIMESTAMPTZ(3),
    "provider_receipt" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_requests" (
    "id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "request_key" VARCHAR(256) NOT NULL,
    "operation" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_report_audit_events" (
    "id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "report_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_reports_project_id_lifecycle_updated_at_id_idx" ON "project_reports"("project_id", "lifecycle", "updated_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_reports_id_project_id_key" ON "project_reports"("id", "project_id");

-- CreateIndex
CREATE INDEX "project_report_revisions_project_id_report_id_kind_sequence_idx" ON "project_report_revisions"("project_id", "report_id", "kind", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_revisions_id_report_id_project_id_key" ON "project_report_revisions"("id", "report_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_revisions_report_id_sequence_key" ON "project_report_revisions"("report_id", "sequence");

-- CreateIndex
CREATE INDEX "project_report_source_manifests_run_id_idx" ON "project_report_source_manifests"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_source_manifests_id_report_id_project_id_key" ON "project_report_source_manifests"("id", "report_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_templates_id_project_id_key" ON "project_report_templates"("id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_templates_project_id_builtin_key_key" ON "project_report_templates"("project_id", "builtin_key");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_template_revisions_id_project_id_key" ON "project_report_template_revisions"("id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_template_revisions_id_template_id_project_id_key" ON "project_report_template_revisions"("id", "template_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_template_revisions_template_id_sequence_key" ON "project_report_template_revisions"("template_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_edit_leases_lease_id_key" ON "project_report_edit_leases"("lease_id");

-- CreateIndex
CREATE INDEX "project_report_edit_leases_project_id_expires_at_idx" ON "project_report_edit_leases"("project_id", "expires_at");

-- CreateIndex
CREATE INDEX "project_report_edit_leases_task_id_idx" ON "project_report_edit_leases"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_edit_leases_report_id_project_id_key" ON "project_report_edit_leases"("report_id", "project_id");

-- CreateIndex
CREATE INDEX "project_report_comments_report_id_created_at_id_idx" ON "project_report_comments"("report_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_comments_id_report_id_project_id_key" ON "project_report_comments"("id", "report_id", "project_id");

-- CreateIndex
CREATE INDEX "project_report_reviews_report_id_revision_id_idx" ON "project_report_reviews"("report_id", "revision_id");

-- CreateIndex
CREATE INDEX "project_report_exports_run_id_idx" ON "project_report_exports"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_exports_project_id_actor_id_request_key_key" ON "project_report_exports"("project_id", "actor_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_shares_id_project_id_key" ON "project_report_shares"("id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_share_revisions_token_hash_key" ON "project_report_share_revisions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_share_revisions_id_share_id_project_id_key" ON "project_report_share_revisions"("id", "share_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_share_revisions_share_id_sequence_key" ON "project_report_share_revisions"("share_id", "sequence");

-- CreateIndex
CREATE INDEX "project_report_schedules_status_next_run_at_idx" ON "project_report_schedules"("status", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_schedules_id_project_id_key" ON "project_report_schedules"("id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_occurrences_id_project_id_key" ON "project_report_occurrences"("id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_occurrences_schedule_id_nominal_time_time_zo_key" ON "project_report_occurrences"("schedule_id", "nominal_time", "time_zone");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_deliveries_occurrence_id_recipient_key_chann_key" ON "project_report_deliveries"("occurrence_id", "recipient_key", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_requests_project_id_actor_id_request_key_key" ON "project_report_requests"("project_id", "actor_id", "request_key");

-- CreateIndex
CREATE INDEX "project_report_audit_events_report_id_created_at_idx" ON "project_report_audit_events"("report_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_template_revision_id_project_id_fkey" FOREIGN KEY ("template_revision_id", "project_id") REFERENCES "project_report_template_revisions"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_draft_revision_id_id_project_id_fkey" FOREIGN KEY ("draft_revision_id", "id", "project_id") REFERENCES "project_report_revisions"("id", "report_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_reports" ADD CONSTRAINT "project_reports_latest_final_revision_id_id_project_id_fkey" FOREIGN KEY ("latest_final_revision_id", "id", "project_id") REFERENCES "project_report_revisions"("id", "report_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_revisions" ADD CONSTRAINT "project_report_revisions_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_revisions" ADD CONSTRAINT "project_report_revisions_project_id_content_blob_key_fkey" FOREIGN KEY ("project_id", "content_blob_key") REFERENCES "project_blobs"("project_id", "key") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_revisions" ADD CONSTRAINT "project_report_revisions_parent_revision_id_report_id_proj_fkey" FOREIGN KEY ("parent_revision_id", "report_id", "project_id") REFERENCES "project_report_revisions"("id", "report_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_revisions" ADD CONSTRAINT "project_report_revisions_source_manifest_id_report_id_proj_fkey" FOREIGN KEY ("source_manifest_id", "report_id", "project_id") REFERENCES "project_report_source_manifests"("id", "report_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_source_manifests" ADD CONSTRAINT "project_report_source_manifests_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_source_manifests" ADD CONSTRAINT "project_report_source_manifests_project_id_blob_key_fkey" FOREIGN KEY ("project_id", "blob_key") REFERENCES "project_blobs"("project_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_templates" ADD CONSTRAINT "project_report_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_templates" ADD CONSTRAINT "project_report_templates_current_revision_id_id_project_id_fkey" FOREIGN KEY ("current_revision_id", "id", "project_id") REFERENCES "project_report_template_revisions"("id", "template_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_template_revisions" ADD CONSTRAINT "project_report_template_revisions_template_id_project_id_fkey" FOREIGN KEY ("template_id", "project_id") REFERENCES "project_report_templates"("id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_edit_leases" ADD CONSTRAINT "project_report_edit_leases_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_comments" ADD CONSTRAINT "project_report_comments_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_reviews" ADD CONSTRAINT "project_report_reviews_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_exports" ADD CONSTRAINT "project_report_exports_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_exports" ADD CONSTRAINT "project_report_exports_revision_id_report_id_project_id_fkey" FOREIGN KEY ("revision_id", "report_id", "project_id") REFERENCES "project_report_revisions"("id", "report_id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_exports" ADD CONSTRAINT "project_report_exports_project_id_blob_key_fkey" FOREIGN KEY ("project_id", "blob_key") REFERENCES "project_blobs"("project_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_shares" ADD CONSTRAINT "project_report_shares_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_shares" ADD CONSTRAINT "project_report_shares_current_revision_id_id_project_id_fkey" FOREIGN KEY ("current_revision_id", "id", "project_id") REFERENCES "project_report_share_revisions"("id", "share_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "project_report_share_revisions" ADD CONSTRAINT "project_report_share_revisions_share_id_project_id_fkey" FOREIGN KEY ("share_id", "project_id") REFERENCES "project_report_shares"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_share_revisions" ADD CONSTRAINT "project_report_share_revisions_report_revision_id_report_i_fkey" FOREIGN KEY ("report_revision_id", "report_id", "project_id") REFERENCES "project_report_revisions"("id", "report_id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_share_revisions" ADD CONSTRAINT "project_report_share_revisions_project_id_projection_blob__fkey" FOREIGN KEY ("project_id", "projection_blob_key") REFERENCES "project_blobs"("project_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_schedules" ADD CONSTRAINT "project_report_schedules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_schedules" ADD CONSTRAINT "project_report_schedules_template_revision_id_project_id_fkey" FOREIGN KEY ("template_revision_id", "project_id") REFERENCES "project_report_template_revisions"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_occurrences" ADD CONSTRAINT "project_report_occurrences_schedule_id_project_id_fkey" FOREIGN KEY ("schedule_id", "project_id") REFERENCES "project_report_schedules"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_deliveries" ADD CONSTRAINT "project_report_deliveries_occurrence_id_project_id_fkey" FOREIGN KEY ("occurrence_id", "project_id") REFERENCES "project_report_occurrences"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_requests" ADD CONSTRAINT "project_report_requests_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_report_audit_events" ADD CONSTRAINT "project_report_audit_events_report_id_project_id_fkey" FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE project_reports ADD CONSTRAINT project_report_period_check CHECK (period_end > period_start);
ALTER TABLE project_reports ADD CONSTRAINT project_report_lifecycle_check CHECK (lifecycle IN ('active', 'archived', 'trashed'));
ALTER TABLE project_reports ADD CONSTRAINT project_report_previous_fk FOREIGN KEY (previous_report_id, project_id) REFERENCES project_reports(id, project_id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE project_report_revisions ADD CONSTRAINT project_report_revision_kind_check CHECK (kind IN ('draft', 'preview', 'final', 'candidate'));
ALTER TABLE project_report_revisions ADD CONSTRAINT project_report_revision_sequence_check CHECK (sequence > 0);
ALTER TABLE project_report_comments ADD CONSTRAINT project_report_comment_revision_fk FOREIGN KEY (revision_id, report_id, project_id) REFERENCES project_report_revisions(id, report_id, project_id) ON DELETE RESTRICT;
ALTER TABLE project_report_comments ADD CONSTRAINT project_report_comment_parent_fk FOREIGN KEY (parent_id, report_id, project_id) REFERENCES project_report_comments(id, report_id, project_id) ON DELETE RESTRICT;
ALTER TABLE project_report_reviews ADD CONSTRAINT project_report_review_revision_fk FOREIGN KEY (revision_id, report_id, project_id) REFERENCES project_report_revisions(id, report_id, project_id) ON DELETE RESTRICT;
ALTER TABLE project_report_occurrences ADD CONSTRAINT project_report_occurrence_report_fk FOREIGN KEY (report_id, project_id) REFERENCES project_reports(id, project_id) ON DELETE RESTRICT;
ALTER TABLE project_report_shares ADD CONSTRAINT project_report_share_identity_unique UNIQUE (id, report_id, project_id);
ALTER TABLE project_report_share_revisions ADD CONSTRAINT project_report_share_report_fk FOREIGN KEY (share_id, report_id, project_id) REFERENCES project_report_shares(id, report_id, project_id) ON DELETE RESTRICT;
ALTER TABLE project_report_share_revisions ADD CONSTRAINT project_report_share_mode_check CHECK (access_mode IN ('accounts', 'link'));
ALTER TABLE project_report_edit_leases ADD CONSTRAINT project_report_lease_kind_check CHECK ((kind = 'user' AND task_id IS NULL) OR (kind = 'ai_task' AND task_id IS NOT NULL));
ALTER TABLE project_report_deliveries ADD CONSTRAINT project_report_delivery_status_check CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'unknown', 'cancelled'));

CREATE FUNCTION project_report_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('localmind.allow_report_purge', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Project report evidence is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER project_report_revision_immutable BEFORE UPDATE OR DELETE ON project_report_revisions FOR EACH ROW EXECUTE FUNCTION project_report_immutable_record();
CREATE TRIGGER project_report_manifest_immutable BEFORE UPDATE OR DELETE ON project_report_source_manifests FOR EACH ROW EXECUTE FUNCTION project_report_immutable_record();
CREATE TRIGGER project_report_template_revision_immutable BEFORE UPDATE OR DELETE ON project_report_template_revisions FOR EACH ROW EXECUTE FUNCTION project_report_immutable_record();
CREATE TRIGGER project_report_share_revision_immutable BEFORE UPDATE OR DELETE ON project_report_share_revisions FOR EACH ROW EXECUTE FUNCTION project_report_immutable_record();
CREATE TRIGGER project_report_request_immutable BEFORE UPDATE OR DELETE ON project_report_requests FOR EACH ROW EXECUTE FUNCTION project_report_immutable_record();
CREATE TRIGGER project_report_audit_immutable BEFORE UPDATE OR DELETE ON project_report_audit_events FOR EACH ROW EXECUTE FUNCTION project_report_immutable_record();

CREATE FUNCTION project_report_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision_counter < OLD.revision_counter THEN
    RAISE EXCEPTION 'Project report creation evidence cannot change' USING ERRCODE = '23514';
  END IF;
  IF NEW.latest_final_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_report_revisions WHERE id = NEW.latest_final_revision_id AND report_id = NEW.id AND project_id = NEW.project_id AND kind = 'final') THEN
    RAISE EXCEPTION 'Project report final pointer must reference a final revision' USING ERRCODE = '23514';
  END IF;
  IF NEW.draft_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_report_revisions WHERE id = NEW.draft_revision_id AND report_id = NEW.id AND project_id = NEW.project_id AND kind = 'draft') THEN
    RAISE EXCEPTION 'Project report draft pointer must reference a draft revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_report_identity_guard BEFORE UPDATE ON project_reports FOR EACH ROW EXECUTE FUNCTION project_report_identity_guard();

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ProjectReport';

-- AlterTable
ALTER TABLE "project_report_occurrences" ADD COLUMN     "failure_code" VARCHAR(128),
ADD COLUMN     "scheduled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "project_report_deliveries" ADD COLUMN     "export_id" VARCHAR,
ADD COLUMN     "mail_delivery_id" VARCHAR,
ADD COLUMN     "result_note" VARCHAR(2000),
ADD COLUMN     "share_id" VARCHAR,
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "project_report_schedule_revisions" (
    "id" VARCHAR NOT NULL,
    "schedule_id" VARCHAR NOT NULL,
    "project_id" VARCHAR NOT NULL,
    "version" INTEGER NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "delegated_actor_id" VARCHAR NOT NULL,
    "request_key" VARCHAR(256) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "config" JSONB NOT NULL,
    "authorization" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "next_run_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_report_schedule_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_report_schedule_revisions_schedule_id_version_key" ON "project_report_schedule_revisions"("schedule_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "project_report_schedule_revisions_project_id_actor_id_reque_key" ON "project_report_schedule_revisions"("project_id", "actor_id", "request_key");

-- AddForeignKey
ALTER TABLE "project_report_schedule_revisions" ADD CONSTRAINT "project_report_schedule_revisions_schedule_id_project_id_fkey" FOREIGN KEY ("schedule_id", "project_id") REFERENCES "project_report_schedules"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TRIGGER project_report_schedule_revision_immutable BEFORE UPDATE OR DELETE ON project_report_schedule_revisions FOR EACH ROW EXECUTE FUNCTION project_report_immutable_record();
ALTER TABLE project_report_schedules ADD CONSTRAINT project_report_schedule_status_check CHECK (status IN ('active', 'paused', 'removed'));
ALTER TABLE project_report_occurrences ADD CONSTRAINT project_report_occurrence_status_check CHECK (status IN ('queued', 'generating', 'finalizing', 'needs_review', 'completed', 'failed', 'paused', 'missed'));

-- Retain explicitly adopted assets and resumable generation checkpoints independently of private sessions.
CREATE TABLE "project_report_blob_references" (
  "id" VARCHAR NOT NULL PRIMARY KEY,
  "project_id" VARCHAR NOT NULL,
  "blob_key" VARCHAR(256) NOT NULL,
  "report_id" VARCHAR,
  "template_id" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_blob_owner" CHECK (("report_id" IS NOT NULL)::integer + ("template_id" IS NOT NULL)::integer = 1),
  FOREIGN KEY ("project_id", "blob_key") REFERENCES "project_blobs"("project_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("report_id", "project_id") REFERENCES "project_reports"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("template_id", "project_id") REFERENCES "project_report_templates"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "project_report_blob_references_report_id_blob_key_key" ON "project_report_blob_references"("report_id", "blob_key");
CREATE UNIQUE INDEX "project_report_blob_references_template_id_blob_key_key" ON "project_report_blob_references"("template_id", "blob_key");
