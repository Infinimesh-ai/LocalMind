CREATE OR REPLACE FUNCTION ai_repair_execution_positive_int(
  value jsonb,
  field_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value->field_name) = 'number'
    AND (value->>field_name) ~ '^[0-9]+$'
    AND (value->>field_name)::numeric > 0
    AND (value->>field_name)::numeric <= 1000000,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_repair_execution_bounded_string(
  value jsonb,
  field_name text,
  max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(value->field_name) = 'string'
    AND length(btrim(value->>field_name)) BETWEEN 1 AND max_length,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_repair_execution_optional_bounded_string(
  value jsonb,
  field_name text,
  max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (value ? field_name) = false
    OR value->field_name = 'null'::jsonb
    OR (
      jsonb_typeof(value->field_name) = 'string'
      AND length(btrim(value->>field_name)) BETWEEN 1 AND max_length
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_repair_execution_iso_timestamp_string(
  value jsonb,
  field_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    ai_repair_execution_bounded_string(value, field_name, 128)
    AND (value->>field_name) ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}',
    false
  );
$$;

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

ALTER TABLE "ai_repair_execution_audit_events"
  ADD CONSTRAINT "ai_repair_execution_audit_metadata_contract_check"
  CHECK (
    ai_repair_execution_audit_metadata_valid("event_type", "metadata")
  ) NOT VALID;
