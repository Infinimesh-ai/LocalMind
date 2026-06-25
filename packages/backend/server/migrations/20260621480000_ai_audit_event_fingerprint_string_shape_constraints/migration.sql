ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_fingerprint_shape_check"
  CHECK (
    length(btrim("event_fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;

ALTER TABLE "ai_repair_execution_audit_events"
  ADD CONSTRAINT "ai_repair_execution_audit_events_fingerprint_shape_check"
  CHECK (
    length(btrim("event_fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;
