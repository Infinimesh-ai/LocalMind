-- AlterCheckConstraint
ALTER TABLE "ai_support_bundle_audit_events"
  DROP CONSTRAINT "ai_support_bundle_audit_events_type_check";

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_type_check"
  CHECK ("event_type" IN (
    'created',
    'read',
    'download_authorized',
    'downloaded'
  ));

-- CreateTable
CREATE TABLE "ai_support_bundle_download_authorizations" (
    "id" VARCHAR NOT NULL,
    "bundle_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "artifact_kind" VARCHAR NOT NULL,
    "artifact_filename" VARCHAR NOT NULL,
    "artifact_mime" VARCHAR NOT NULL,
    "manifest_fingerprint" VARCHAR NOT NULL,
    "authorization_fingerprint" VARCHAR NOT NULL,
    "token_fingerprint" VARCHAR NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "downloaded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_support_bundle_download_authorizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_support_bundle_download_authorizations_status_check" CHECK ("status" IN ('authorized', 'downloaded', 'expired', 'revoked')),
    CONSTRAINT "ai_support_bundle_download_authorizations_artifact_kind_check" CHECK ("artifact_kind" IN ('manifest_json'))
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_support_bundle_download_authorizations_token_fingerprint_key" ON "ai_support_bundle_download_authorizations"("token_fingerprint");

-- CreateIndex
CREATE INDEX "ai_support_bundle_download_authorizations_bundle_id_created_at_idx" ON "ai_support_bundle_download_authorizations"("bundle_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_download_authorizations_workspace_id_created_at_idx" ON "ai_support_bundle_download_authorizations"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_download_authorizations_actor_id_created_at_idx" ON "ai_support_bundle_download_authorizations"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_download_authorizations_status_expires_at_idx" ON "ai_support_bundle_download_authorizations"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "ai_support_bundle_download_authorizations" ADD CONSTRAINT "ai_support_bundle_download_authorizations_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "ai_support_bundle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_support_bundle_download_authorizations" ADD CONSTRAINT "ai_support_bundle_download_authorizations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_support_bundle_download_authorizations" ADD CONSTRAINT "ai_support_bundle_download_authorizations_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
