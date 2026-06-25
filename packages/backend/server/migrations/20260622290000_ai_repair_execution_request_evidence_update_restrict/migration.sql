CREATE OR REPLACE FUNCTION ai_repair_execution_request_evidence_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."prompt_name" IS NOT DISTINCT FROM NEW."prompt_name"
     AND OLD."requested_action" IS NOT DISTINCT FROM NEW."requested_action"
     AND OLD."permission_status" IS NOT DISTINCT FROM NEW."permission_status"
     AND OLD."idempotency_key" IS NOT DISTINCT FROM NEW."idempotency_key"
     AND OLD."idempotency_fingerprint" IS NOT DISTINCT FROM
       NEW."idempotency_fingerprint"
     AND OLD."request_fingerprint" IS NOT DISTINCT FROM
       NEW."request_fingerprint"
     AND OLD."candidate_evidence_set_fingerprint" IS NOT DISTINCT FROM
       NEW."candidate_evidence_set_fingerprint"
     AND OLD."task_route_evidence_set_fingerprint" IS NOT DISTINCT FROM
       NEW."task_route_evidence_set_fingerprint"
     AND OLD."target_locator_fingerprint" IS NOT DISTINCT FROM
       NEW."target_locator_fingerprint"
     AND OLD."repair_job_fingerprint" IS NOT DISTINCT FROM
       NEW."repair_job_fingerprint"
     AND OLD."approval_record_fingerprint" IS NOT DISTINCT FROM
       NEW."approval_record_fingerprint"
     AND OLD."audit_event_fingerprint" IS NOT DISTINCT FROM
       NEW."audit_event_fingerprint"
     AND OLD."executor_payload" IS NOT DISTINCT FROM NEW."executor_payload"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_repair_execution_requests_evidence_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_repair_execution_requests_evidence_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_repair_execution_requests_evidence_update_restrict_check"
AFTER UPDATE
ON "ai_repair_execution_requests"
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_request_evidence_update_restrict();
