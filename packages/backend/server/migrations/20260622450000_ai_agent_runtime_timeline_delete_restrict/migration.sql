CREATE OR REPLACE FUNCTION ai_agent_runtime_timeline_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."step_id" IS NULL
     AND EXISTS (
       SELECT 1
       FROM "ai_agent_runs" run
       WHERE run."id" = OLD."run_id"
         AND run."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
         AND run."actor_id" IS NOT DISTINCT FROM OLD."actor_id"
         AND OLD."event_type" IN ('run_status', 'run_cancellation')
         AND OLD."status" IS NOT DISTINCT FROM run."status"
         AND OLD."created_at" IS NOT DISTINCT FROM run."updated_at"
         AND OLD."payload"->>'workflow' IS NOT DISTINCT FROM run."workflow"
         AND OLD."payload"->>'sourceType' IS NOT DISTINCT FROM
           run."source_type"
         AND OLD."payload"->>'sourceId' IS NOT DISTINCT FROM run."source_id"
         AND (
           NOT (OLD."payload" ? 'workerLeaseId')
           OR run."worker_lease_id" IS NULL
           OR OLD."payload"->>'workerLeaseId' IS NOT DISTINCT FROM
             run."worker_lease_id"
         )
         AND (
           NOT (OLD."payload" ? 'failureCode')
           OR OLD."payload"->>'failureCode' IS NOT DISTINCT FROM
             run."failure_code"
         )
         AND (
           NOT (OLD."payload" ? 'failureMessage')
           OR OLD."payload"->>'failureMessage' IS NOT DISTINCT FROM
             run."failure_message"
         )
         AND NOT EXISTS (
           SELECT 1
           FROM "ai_agent_timeline_events" event
           WHERE event."run_id" = run."id"
             AND event."step_id" IS NULL
             AND event."workspace_id" IS NOT DISTINCT FROM run."workspace_id"
             AND event."actor_id" IS NOT DISTINCT FROM run."actor_id"
             AND event."event_type" IN ('run_status', 'run_cancellation')
             AND event."status" IS NOT DISTINCT FROM run."status"
             AND event."created_at" IS NOT DISTINCT FROM run."updated_at"
             AND event."payload"->>'workflow' IS NOT DISTINCT FROM
               run."workflow"
             AND event."payload"->>'sourceType' IS NOT DISTINCT FROM
               run."source_type"
             AND event."payload"->>'sourceId' IS NOT DISTINCT FROM
               run."source_id"
             AND (
               NOT (event."payload" ? 'workerLeaseId')
               OR run."worker_lease_id" IS NULL
               OR event."payload"->>'workerLeaseId' IS NOT DISTINCT FROM
                 run."worker_lease_id"
             )
             AND (
               NOT (event."payload" ? 'failureCode')
               OR event."payload"->>'failureCode' IS NOT DISTINCT FROM
                 run."failure_code"
             )
             AND (
               NOT (event."payload" ? 'failureMessage')
               OR event."payload"->>'failureMessage' IS NOT DISTINCT FROM
                 run."failure_message"
             )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_agent_timeline_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_timeline_events_delete_restrict_check';
  END IF;

  IF OLD."step_id" IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM "ai_agent_steps" step
       WHERE step."id" = OLD."step_id"
         AND step."run_id" = OLD."run_id"
         AND step."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
         AND step."actor_id" IS NOT DISTINCT FROM OLD."actor_id"
         AND OLD."event_type" IN (
           CASE step."step_type"
             WHEN 'approval' THEN 'approval_step'
             WHEN 'codex' THEN 'codex_step'
             WHEN 'handoff' THEN 'handoff_step'
             WHEN 'mcp' THEN 'mcp_step'
             WHEN 'tool' THEN 'tool_step'
             ELSE 'model_step'
           END,
           'step_output',
           'step_error'
         )
         AND OLD."status" IS NOT DISTINCT FROM step."status"
         AND OLD."created_at" IS NOT DISTINCT FROM step."updated_at"
         AND (
           NOT (OLD."payload" ? 'stepKey')
           OR OLD."payload"->>'stepKey' IS NOT DISTINCT FROM step."step_key"
         )
         AND (
           NOT (OLD."payload" ? 'stepType')
           OR OLD."payload"->>'stepType' IS NOT DISTINCT FROM step."step_type"
         )
         AND NOT EXISTS (
           SELECT 1
           FROM "ai_agent_timeline_events" event
           WHERE event."run_id" = step."run_id"
             AND event."step_id" = step."id"
             AND event."workspace_id" IS NOT DISTINCT FROM step."workspace_id"
             AND event."actor_id" IS NOT DISTINCT FROM step."actor_id"
             AND event."event_type" IN (
               CASE step."step_type"
                 WHEN 'approval' THEN 'approval_step'
                 WHEN 'codex' THEN 'codex_step'
                 WHEN 'handoff' THEN 'handoff_step'
                 WHEN 'mcp' THEN 'mcp_step'
                 WHEN 'tool' THEN 'tool_step'
                 ELSE 'model_step'
               END,
               'step_output',
               'step_error'
             )
             AND event."status" IS NOT DISTINCT FROM step."status"
             AND event."created_at" IS NOT DISTINCT FROM step."updated_at"
             AND (
               NOT (event."payload" ? 'stepKey')
               OR event."payload"->>'stepKey' IS NOT DISTINCT FROM
                 step."step_key"
             )
             AND (
               NOT (event."payload" ? 'stepType')
               OR event."payload"->>'stepType' IS NOT DISTINCT FROM
                 step."step_type"
             )
         )
     ) THEN
    RAISE EXCEPTION
      'ai_agent_timeline_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_agent_timeline_events_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_agent_runtime_timeline_delete_restrict_check"
AFTER DELETE
ON "ai_agent_timeline_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_agent_runtime_timeline_delete_restrict();
