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
