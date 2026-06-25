CREATE OR REPLACE FUNCTION ai_agent_runtime_execution_result_terminal_snapshot_valid()
RETURNS trigger AS $$
BEGIN
  BEGIN
    IF (NEW."result_payload"->>'completedAt')::timestamptz IS DISTINCT FROM
       NEW."completed_at" THEN
      RAISE EXCEPTION
        'ai_agent_runtime_execution_results_completed_at_payload_check'
        USING ERRCODE = '23514',
          CONSTRAINT = 'ai_agent_runtime_execution_results_completed_at_payload_check';
    END IF;
  EXCEPTION WHEN invalid_datetime_format THEN
    RAISE EXCEPTION
      'ai_agent_runtime_execution_results_completed_at_payload_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_runtime_execution_results_completed_at_payload_check';
  END;

  IF TG_OP = 'UPDATE'
     AND OLD."run_id" IS NOT DISTINCT FROM NEW."run_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."result_status" IS NOT DISTINCT FROM NEW."result_status"
     AND OLD."failure_code" IS NOT DISTINCT FROM NEW."failure_code"
     AND OLD."failure_message" IS NOT DISTINCT FROM NEW."failure_message"
     AND OLD."worker_attempt" IS NOT DISTINCT FROM NEW."worker_attempt"
     AND OLD."completed_at" IS NOT DISTINCT FROM NEW."completed_at" THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_agent_runs" run
    WHERE run."id" = NEW."run_id"
      AND run."workspace_id" = NEW."workspace_id"
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_agent_runs" run
    WHERE run."id" = NEW."run_id"
      AND run."workspace_id" = NEW."workspace_id"
      AND run."actor_id" = NEW."actor_id"
      AND run."workflow" = NEW."workflow"
      AND run."source_type" = NEW."source_type"
      AND run."source_id" = NEW."source_id"
      AND run."source_type" <> 'repair_execution_request'
      AND run."status" IN ('completed', 'failed')
      AND run."status" = NEW."result_status"
      AND run."worker_attempt" = NEW."worker_attempt"
      AND run."completed_at" = NEW."completed_at"
      AND (
        (
          NEW."result_status" = 'completed'
          AND run."failure_code" IS NULL
          AND run."failure_message" IS NULL
          AND NEW."failure_code" IS NULL
          AND NEW."failure_message" IS NULL
        )
        OR (
          NEW."result_status" = 'failed'
          AND run."failure_code" = NEW."failure_code"
          AND run."failure_message" = NEW."failure_message"
        )
      )
  ) THEN
    RAISE EXCEPTION
      'ai_agent_runtime_execution_results_terminal_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_runtime_execution_results_terminal_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_runtime_execution_results_terminal_snapshot_check"
BEFORE INSERT OR UPDATE OF
  "run_id",
  "workspace_id",
  "result_status",
  "failure_code",
  "failure_message",
  "result_payload",
  "worker_attempt",
  "completed_at"
ON "ai_agent_runtime_execution_results"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_runtime_execution_result_terminal_snapshot_valid();

CREATE OR REPLACE FUNCTION ai_agent_runtime_run_execution_result_terminal_valid()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'queued'
     AND OLD."status" IN ('failed', 'cancelled')
     AND NEW."worker_attempt" = OLD."worker_attempt"
     AND NEW."completed_at" IS NULL
     AND NEW."failure_code" IS NULL
     AND NEW."failure_message" IS NULL
     AND NEW."worker_lease_id" IS NULL
     AND NEW."worker_lease_expires_at" IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD."status" IN ('completed', 'failed')
     AND EXISTS (
       SELECT 1
       FROM "ai_agent_runtime_execution_results" result
       WHERE result."run_id" = OLD."id"
         AND result."workspace_id" = OLD."workspace_id"
         AND result."worker_attempt" = OLD."worker_attempt"
     )
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_agent_runtime_execution_results" result
       WHERE result."run_id" = NEW."id"
         AND result."workspace_id" = NEW."workspace_id"
         AND result."actor_id" = NEW."actor_id"
         AND result."workflow" = NEW."workflow"
         AND result."source_type" = NEW."source_type"
         AND result."source_id" = NEW."source_id"
         AND result."source_type" <> 'repair_execution_request'
         AND result."worker_attempt" = NEW."worker_attempt"
         AND result."result_status" = NEW."status"
         AND result."completed_at" = NEW."completed_at"
         AND (
           (
             result."result_status" = 'completed'
             AND NEW."failure_code" IS NULL
             AND NEW."failure_message" IS NULL
             AND result."failure_code" IS NULL
             AND result."failure_message" IS NULL
           )
           OR (
             result."result_status" = 'failed'
             AND NEW."failure_code" = result."failure_code"
             AND NEW."failure_message" = result."failure_message"
           )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_agent_runs_execution_result_terminal_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_runs_execution_result_terminal_snapshot_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_agent_runtime_execution_results" result
    WHERE result."run_id" = NEW."id"
      AND result."workspace_id" = NEW."workspace_id"
      AND result."worker_attempt" = NEW."worker_attempt"
  )
     AND NOT EXISTS (
       SELECT 1
       FROM "ai_agent_runtime_execution_results" result
       WHERE result."run_id" = NEW."id"
         AND result."workspace_id" = NEW."workspace_id"
         AND result."actor_id" = NEW."actor_id"
         AND result."workflow" = NEW."workflow"
         AND result."source_type" = NEW."source_type"
         AND result."source_id" = NEW."source_id"
         AND result."source_type" <> 'repair_execution_request'
         AND result."worker_attempt" = NEW."worker_attempt"
         AND result."result_status" = NEW."status"
         AND result."completed_at" = NEW."completed_at"
         AND (
           (
             result."result_status" = 'completed'
             AND NEW."failure_code" IS NULL
             AND NEW."failure_message" IS NULL
             AND result."failure_code" IS NULL
             AND result."failure_message" IS NULL
           )
           OR (
             result."result_status" = 'failed'
             AND NEW."failure_code" = result."failure_code"
             AND NEW."failure_message" = result."failure_message"
           )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_agent_runs_execution_result_terminal_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_runs_execution_result_terminal_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_runs_execution_result_terminal_snapshot_check"
BEFORE UPDATE OF
  "status",
  "failure_code",
  "failure_message",
  "worker_lease_id",
  "worker_lease_expires_at",
  "worker_attempt",
  "completed_at"
ON "ai_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_runtime_run_execution_result_terminal_valid();
