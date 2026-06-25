-- AlterTable
ALTER TABLE "ai_support_bundle_requests"
  ADD COLUMN "archive_storage_key" VARCHAR,
  ADD COLUMN "archive_byte_size" INTEGER,
  ADD COLUMN "archive_fingerprint" VARCHAR,
  ADD COLUMN "archive_mime" VARCHAR,
  ADD COLUMN "archive_filename" VARCHAR;

-- AlterTable
ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD COLUMN "artifact_fingerprint" VARCHAR;

UPDATE "ai_support_bundle_download_authorizations"
SET "artifact_fingerprint" = "manifest_fingerprint"
WHERE "artifact_fingerprint" IS NULL;

ALTER TABLE "ai_support_bundle_download_authorizations"
  ALTER COLUMN "artifact_fingerprint" SET NOT NULL;

-- AlterCheckConstraint
ALTER TABLE "ai_support_bundle_audit_events"
  DROP CONSTRAINT "ai_support_bundle_audit_events_type_check";

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_type_check"
  CHECK ("event_type" IN (
    'created',
    'read',
    'archive_created',
    'download_authorized',
    'downloaded',
    'retention_expired'
  ));

-- AlterCheckConstraint
ALTER TABLE "ai_support_bundle_download_authorizations"
  DROP CONSTRAINT "ai_support_bundle_download_authorizations_artifact_kind_check";

ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_artifact_kind_check"
  CHECK ("artifact_kind" IN ('manifest_json', 'archive_json'));
