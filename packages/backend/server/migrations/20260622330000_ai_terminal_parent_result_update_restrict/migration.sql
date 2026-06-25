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

CREATE TRIGGER "zz_ai_repair_execution_requests_terminal_result_update_restrict_check"
AFTER UPDATE OF
  "status",
  "runtime_result",
  "failure_code",
  "failure_message",
  "queued_at",
  "worker_lease_id",
  "worker_lease_expires_at",
  "worker_attempt",
  "worker_max_attempts",
  "last_attempt_at",
  "completed_at"
ON "ai_repair_execution_requests"
FOR EACH ROW
EXECUTE FUNCTION ai_repair_execution_request_terminal_result_update_restrict();

CREATE OR REPLACE FUNCTION ai_agent_run_terminal_result_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('completed', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."timeline_fingerprint" IS NOT DISTINCT FROM
       NEW."timeline_fingerprint"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."queued_at" IS NOT DISTINCT FROM NEW."queued_at"
     AND OLD."worker_lease_id" IS NOT DISTINCT FROM NEW."worker_lease_id"
     AND OLD."worker_lease_expires_at" IS NOT DISTINCT FROM
       NEW."worker_lease_expires_at"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."worker_max_attempts" IS NOT DISTINCT FROM
       NEW."worker_max_attempts"
     AND OLD."last_attempt_at" IS NOT DISTINCT FROM NEW."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  IF NEW."status" = 'queued'
     AND (
       OLD."status" = 'failed'
       OR (
         OLD."status" = 'cancelled'
         AND OLD."source_type" <> 'repair_execution_request'
       )
     )
     AND NEW."completed_at" IS NULL
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."queued_at" IS NOT NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" >= OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'failed'
     AND OLD."source_type" = 'repair_execution_request'
     AND NEW."status" = 'cancelled'
     AND NEW."completed_at" IS NOT NULL
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."worker_max_attempts" = OLD."worker_max_attempts"
     AND NEW."last_attempt_at" IS NOT DISTINCT FROM OLD."last_attempt_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_runs_terminal_result_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_agent_runs_terminal_result_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_agent_runs_terminal_result_update_restrict_check"
AFTER UPDATE OF
  "status",
  "timeline_fingerprint",
  "completed_at",
  "failure_code",
  "failure_message",
  "queued_at",
  "worker_lease_id",
  "worker_lease_expires_at",
  "worker_attempt",
  "worker_max_attempts",
  "last_attempt_at"
ON "ai_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_run_terminal_result_update_restrict();
