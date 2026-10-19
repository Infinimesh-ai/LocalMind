ALTER TABLE "project_report_occurrences" ADD COLUMN "report_revision_id" VARCHAR;
ALTER TABLE "project_report_occurrences" ADD CONSTRAINT "project_report_occurrences_report_revision_id_report_id_proj_fkey" FOREIGN KEY ("report_revision_id", "report_id", "project_id") REFERENCES "project_report_revisions"("id", "report_id", "project_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
