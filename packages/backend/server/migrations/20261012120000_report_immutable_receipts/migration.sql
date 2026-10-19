-- AlterTable
ALTER TABLE "project_report_template_revisions" ADD COLUMN     "request_fingerprint" VARCHAR(64),
ADD COLUMN     "request_key" VARCHAR(256);

-- AlterTable
ALTER TABLE "project_report_share_revisions" ADD COLUMN     "token_ciphertext" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "project_report_template_revisions_project_id_actor_id_reque_key" ON "project_report_template_revisions"("project_id", "actor_id", "request_key");
