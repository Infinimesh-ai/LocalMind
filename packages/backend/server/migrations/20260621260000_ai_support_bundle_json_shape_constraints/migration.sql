ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_json_shape_check"
  CHECK (
    jsonb_typeof("source_evidence_summary") = 'object'
    AND jsonb_typeof("manifest_json") = 'object'
  ) NOT VALID;

ALTER TABLE "ai_support_bundle_audit_events"
  ADD CONSTRAINT "ai_support_bundle_audit_events_metadata_shape_check"
  CHECK (jsonb_typeof("metadata") = 'object') NOT VALID;
