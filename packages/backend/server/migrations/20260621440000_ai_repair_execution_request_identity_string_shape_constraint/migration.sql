ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_identity_shape_check"
  CHECK (
    length(btrim("prompt_name")) BETWEEN 1 AND 512
    AND length(btrim("requested_action")) BETWEEN 1 AND 512
    AND length(btrim("idempotency_key")) BETWEEN 1 AND 512
    AND length(btrim("idempotency_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("request_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("candidate_evidence_set_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("task_route_evidence_set_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("target_locator_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("repair_job_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("approval_record_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("audit_event_fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;
