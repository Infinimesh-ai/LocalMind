ALTER TABLE "ai_repair_execution_audit_events"
  DROP CONSTRAINT "ai_repair_execution_audit_events_type_check";

ALTER TABLE "ai_repair_execution_audit_events"
  ADD CONSTRAINT "ai_repair_execution_audit_events_type_check"
  CHECK ("event_type" IN (
    'requested',
    'queued',
    'waiting_approval',
    'approval_approved',
    'approval_rejected',
    'running',
    'cancel_requested',
    'side_effect_applied',
    'retry_scheduled',
    'manual_retry_requested',
    'manual_resume_requested',
    'stale_recovered',
    'completed',
    'failed',
    'cancelled',
    'reused'
  ));

CREATE OR REPLACE FUNCTION ai_repair_execution_audit_metadata_valid(
  event_type text,
  metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata) = 'object'
    AND CASE event_type
      WHEN 'running' THEN
        jsonb_typeof(metadata->'executor') = 'string'
        AND btrim(metadata->>'executor') = 'repair_execution_worker'
        AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
        AND ai_repair_execution_bounded_string(metadata, 'workerLeaseId', 512)
        AND ai_repair_execution_iso_timestamp_string(
          metadata,
          'workerLeaseExpiresAt'
        )
      WHEN 'cancel_requested' THEN
        jsonb_typeof(metadata->'controlAction') = 'string'
        AND btrim(metadata->>'controlAction') = 'cancel'
        AND jsonb_typeof(metadata->'previousStatus') = 'string'
        AND btrim(metadata->>'previousStatus') = 'running'
        AND jsonb_typeof(metadata->'previousApprovalState') = 'string'
        AND btrim(metadata->>'previousApprovalState') IN (
          'approved',
          'not_required'
        )
        AND ai_repair_execution_optional_bounded_string(
          metadata,
          'reason',
          1024
        )
        AND ai_repair_execution_iso_timestamp_string(metadata, 'requestedAt')
        AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
        AND ai_repair_execution_bounded_string(metadata, 'workerLeaseId', 512)
        AND ai_repair_execution_iso_timestamp_string(
          metadata,
          'workerLeaseExpiresAt'
        )
      WHEN 'failed' THEN
        (
          ai_repair_execution_bounded_string(metadata, 'failureCode', 128)
          AND ai_repair_execution_bounded_string(metadata, 'failureMessage', 2000)
          AND jsonb_typeof(metadata->'retryScheduled') = 'boolean'
          AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
          AND ai_repair_execution_positive_int(metadata, 'workerMaxAttempts')
          AND (
            (
              NOT (metadata ? 'controlAction')
              AND ai_repair_execution_bounded_string(
                metadata,
                'failingExecutorPayloadFingerprint',
                128
              )
              AND ai_repair_execution_bounded_string(
                metadata,
                'workerLeaseId',
                512
              )
            )
            OR (
              jsonb_typeof(metadata->'controlAction') = 'string'
              AND btrim(metadata->>'controlAction') = 'recover_stale'
              AND jsonb_typeof(metadata->'recoverySource') = 'string'
              AND btrim(metadata->>'recoverySource') IN ('manual', 'system')
              AND metadata->'retryScheduled' = 'false'::jsonb
            )
          )
        )
      WHEN 'retry_scheduled' THEN
        jsonb_typeof(metadata->'nextStatus') = 'string'
        AND btrim(metadata->>'nextStatus') = 'queued'
        AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
        AND ai_repair_execution_positive_int(metadata, 'workerMaxAttempts')
      WHEN 'cancelled' THEN
        (
          (
            jsonb_typeof(metadata->'controlAction') = 'string'
            AND btrim(metadata->>'controlAction') = 'cancel'
            AND jsonb_typeof(metadata->'previousStatus') = 'string'
            AND btrim(metadata->>'previousStatus') IN (
              'waiting_approval',
              'queued',
              'failed'
            )
            AND jsonb_typeof(metadata->'previousApprovalState') = 'string'
            AND btrim(metadata->>'previousApprovalState') IN (
              'not_required',
              'waiting',
              'approved',
              'rejected'
            )
            AND ai_repair_execution_optional_bounded_string(
              metadata,
              'reason',
              1024
            )
            AND COALESCE(
              (metadata ? 'workerLeaseId') = false
              OR metadata->'workerLeaseId' = 'null'::jsonb
              OR ai_repair_execution_bounded_string(
                metadata,
                'workerLeaseId',
                512
              ),
              false
            )
            AND COALESCE(
              NOT (metadata ? 'workerAttempt')
              OR ai_repair_execution_positive_int(metadata, 'workerAttempt')
              OR (
                jsonb_typeof(metadata->'workerAttempt') = 'number'
                AND metadata->>'workerAttempt' = '0'
              ),
              false
            )
            AND NOT COALESCE(metadata->'cooperative' = 'true'::jsonb, false)
          )
          OR (
            jsonb_typeof(metadata->'controlAction') = 'string'
            AND btrim(metadata->>'controlAction') = 'cancel'
            AND jsonb_typeof(metadata->'previousStatus') = 'string'
            AND btrim(metadata->>'previousStatus') = 'running'
            AND jsonb_typeof(metadata->'previousApprovalState') = 'string'
            AND btrim(metadata->>'previousApprovalState') IN (
              'approved',
              'not_required'
            )
            AND ai_repair_execution_optional_bounded_string(
              metadata,
              'reason',
              1024
            )
            AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
            AND ai_repair_execution_bounded_string(metadata, 'workerLeaseId', 512)
            AND metadata->'cooperative' = 'true'::jsonb
            AND ai_repair_execution_iso_timestamp_string(
              metadata,
              'cancellationRequestedAt'
            )
            AND metadata->'sideEffectsApplied' = 'false'::jsonb
          )
          OR (
            NOT (metadata ? 'controlAction')
            AND jsonb_typeof(metadata->'approvalState') = 'string'
            AND btrim(metadata->>'approvalState') = 'rejected'
            AND metadata->'sideEffectsApplied' = 'false'::jsonb
          )
        )
      WHEN 'manual_retry_requested' THEN
        jsonb_typeof(metadata->'controlAction') = 'string'
        AND btrim(metadata->>'controlAction') = 'retry'
        AND jsonb_typeof(metadata->'previousStatus') = 'string'
        AND btrim(metadata->>'previousStatus') = 'failed'
        AND ai_repair_execution_optional_bounded_string(
          metadata,
          'previousFailureCode',
          128
        )
        AND ai_repair_execution_optional_bounded_string(
          metadata,
          'previousFailureMessage',
          2000
        )
        AND (
          metadata->'previousExecutorPayloadFingerprint' = 'null'::jsonb
          OR ai_repair_execution_bounded_string(
            metadata,
            'previousExecutorPayloadFingerprint',
            128
          )
        )
        AND ai_repair_execution_bounded_string(
          metadata,
          'currentExecutorPayloadFingerprint',
          128
        )
        AND ai_repair_execution_optional_bounded_string(metadata, 'reason', 1024)
        AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
        AND ai_repair_execution_positive_int(metadata, 'workerMaxAttempts')
        AND ai_repair_execution_positive_int(metadata, 'nextWorkerMaxAttempts')
      WHEN 'manual_resume_requested' THEN
        jsonb_typeof(metadata->'controlAction') = 'string'
        AND btrim(metadata->>'controlAction') = 'resume_with_payload'
        AND jsonb_typeof(metadata->'previousStatus') = 'string'
        AND btrim(metadata->>'previousStatus') = 'failed'
        AND ai_repair_execution_optional_bounded_string(
          metadata,
          'previousFailureCode',
          128
        )
        AND ai_repair_execution_optional_bounded_string(
          metadata,
          'previousFailureMessage',
          2000
        )
        AND ai_repair_execution_bounded_string(
          metadata,
          'previousExecutorPayloadFingerprint',
          128
        )
        AND ai_repair_execution_bounded_string(
          metadata,
          'correctedExecutorPayloadFingerprint',
          128
        )
        AND metadata->>'previousExecutorPayloadFingerprint' <>
          metadata->>'correctedExecutorPayloadFingerprint'
        AND ai_repair_execution_optional_bounded_string(metadata, 'reason', 1024)
        AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
        AND ai_repair_execution_positive_int(metadata, 'workerMaxAttempts')
        AND ai_repair_execution_positive_int(metadata, 'nextWorkerMaxAttempts')
      WHEN 'stale_recovered' THEN
        jsonb_typeof(metadata->'controlAction') = 'string'
        AND btrim(metadata->>'controlAction') = 'recover_stale'
        AND jsonb_typeof(metadata->'recoverySource') = 'string'
        AND btrim(metadata->>'recoverySource') IN ('manual', 'system')
        AND jsonb_typeof(metadata->'previousStatus') = 'string'
        AND btrim(metadata->>'previousStatus') = 'running'
        AND ai_repair_execution_bounded_string(
          metadata,
          'previousWorkerLeaseId',
          512
        )
        AND ai_repair_execution_iso_timestamp_string(
          metadata,
          'previousWorkerLeaseExpiresAt'
        )
        AND ai_repair_execution_optional_bounded_string(metadata, 'reason', 1024)
        AND jsonb_typeof(metadata->'retryScheduled') = 'boolean'
        AND jsonb_typeof(metadata->'nextStatus') = 'string'
        AND (
          (
            metadata->'retryScheduled' = 'true'::jsonb
            AND btrim(metadata->>'nextStatus') = 'queued'
          )
          OR (
            metadata->'retryScheduled' = 'false'::jsonb
            AND btrim(metadata->>'nextStatus') = 'failed'
          )
        )
        AND ai_repair_execution_positive_int(metadata, 'workerAttempt')
        AND ai_repair_execution_positive_int(metadata, 'workerMaxAttempts')
      ELSE true
    END,
    false
  );
$$;

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
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at"
     AND OLD."executor_payload" IS DISTINCT FROM NEW."executor_payload"
     AND OLD."status" = 'failed'
     AND NEW."status" = 'queued'
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_repair_execution_side_effects" side_effect
       WHERE side_effect."execution_request_id" = OLD."id"
         AND side_effect."workspace_id" = OLD."workspace_id"
     )
     AND EXISTS (
       SELECT 1
       FROM "ai_repair_execution_audit_events" event
       WHERE event."execution_request_id" = NEW."id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
         AND event."event_type" = 'manual_resume_requested'
         AND event."created_at" >= OLD."updated_at"
         AND event."metadata"->>'controlAction' = 'resume_with_payload'
         AND event."metadata"->>'previousStatus' = 'failed'
         AND ai_repair_execution_bounded_string(
           event."metadata",
           'previousExecutorPayloadFingerprint',
           128
         )
         AND ai_repair_execution_bounded_string(
           event."metadata",
           'correctedExecutorPayloadFingerprint',
           128
         )
         AND event."metadata"->>'previousExecutorPayloadFingerprint' <>
           event."metadata"->>'correctedExecutorPayloadFingerprint'
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_repair_execution_requests_evidence_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_repair_execution_requests_evidence_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ai_repair_execution_request_terminal_result_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('completed', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."runtime_result" IS NOT DISTINCT FROM NEW."runtime_result"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."queued_at" IS NOT DISTINCT FROM NEW."queued_at"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."worker_lease_expires_at" IS NOT DISTINCT FROM
       NEW."worker_lease_expires_at"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."worker_max_attempts" IS NOT DISTINCT FROM
       NEW."worker_max_attempts"
     AND OLD."last_attempt_at" IS NOT DISTINCT FROM NEW."last_attempt_at"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'failed'
     AND NEW."status" = 'queued'
     AND COALESCE(OLD."failure_code", '') NOT IN (
       'invalid_executor_payload',
       'unsupported_executor_payload'
     )
     AND NEW."runtime_result"->>'executor' =
       'manual_repair_execution_control'
     AND COALESCE(
       NEW."runtime_result"->'sideEffectsApplied' = 'false'::jsonb,
       false
     )
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."queued_at" IS NOT NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" >= OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at"
     AND NEW."completed_at" IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'failed'
     AND NEW."status" = 'queued'
     AND OLD."executor_payload" IS DISTINCT FROM NEW."executor_payload"
     AND NEW."runtime_result"->>'executor' =
       'manual_repair_execution_payload_correction'
     AND COALESCE(
       NEW."runtime_result"->'sideEffectsApplied' = 'false'::jsonb,
       false
     )
     AND NEW."runtime_result"->'sideEffectSummary'->>'version' =
       'repair-execution-payload-correction-summary/v1'
     AND ai_repair_execution_bounded_string(
       NEW."runtime_result"->'sideEffectSummary',
       'correctedExecutorPayloadFingerprint',
       128
     )
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."queued_at" IS NOT NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" >= OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at"
     AND NEW."completed_at" IS NULL
     AND EXISTS (
       SELECT 1
       FROM "ai_repair_execution_audit_events" event
       WHERE event."execution_request_id" = NEW."id"
         AND event."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
         AND event."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
         AND event."event_type" = 'manual_resume_requested'
         AND event."created_at" >= OLD."updated_at"
         AND event."metadata"->>'controlAction' = 'resume_with_payload'
         AND event."metadata"->>'correctedExecutorPayloadFingerprint'
           IS NOT DISTINCT FROM
             NEW."runtime_result"->'sideEffectSummary'->>
               'correctedExecutorPayloadFingerprint'
     ) THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'failed'
     AND NEW."status" = 'cancelled'
     AND NEW."runtime_result"->>'executor' =
       'manual_repair_execution_control'
     AND COALESCE(
       NEW."runtime_result"->'sideEffectsApplied' = 'false'::jsonb,
       false
     )
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" = OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at"
     AND NEW."completed_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_repair_execution_requests_terminal_result_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_repair_execution_requests_terminal_result_update_restrict_check';
END;
$$ LANGUAGE plpgsql;
