-- AlterCheckConstraint
ALTER TABLE "ai_support_bundle_audit_events"
  DROP CONSTRAINT "ai_support_bundle_audit_events_type_check";

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_type_check"
  CHECK ("event_type" IN (
    'created',
    'read',
    'download_authorized',
    'downloaded',
    'retention_expired'
  ));
