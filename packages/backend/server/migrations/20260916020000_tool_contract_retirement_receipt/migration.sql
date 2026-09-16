-- A contract cutover does not execute a resource operation. Its immutable
-- maintenance timeline is the receipt; never fabricate a worker attempt/result
-- or overwrite a previous attempt's execution ledger to terminate an old task.
CREATE OR REPLACE FUNCTION ai_agent_project_terminal_receipt_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NEW.status IN ('completed', 'failed') AND NOT EXISTS (
    SELECT 1 FROM ai_agent_runtime_execution_results result
    WHERE result.run_id = NEW.id AND result.project_id = NEW.project_id
      AND result.workspace_id IS NULL AND result.actor_id = NEW.actor_id
      AND result.worker_attempt = NEW.worker_attempt AND result.result_status = NEW.status
      AND result.completed_at = NEW.completed_at
      AND result.failure_code IS NOT DISTINCT FROM NEW.failure_code
      AND result.failure_message IS NOT DISTINCT FROM NEW.failure_message
  ) AND NOT (
    NEW.status = 'failed' AND NEW.failure_code = 'tool_contract_retired'
    AND NEW.workflow = 'agent_runtime_project_resource'
    AND EXISTS (
      SELECT 1 FROM ai_agent_timeline_events event
      WHERE event.run_id = NEW.id AND event.project_id = NEW.project_id
        AND event.workspace_id IS NULL AND event.actor_id = NEW.actor_id
        AND event.step_id IS NULL AND event.event_type = 'run_status'
        AND event.status = 'failed' AND event.created_at = NEW.completed_at
        AND event.payload->>'version' = 'tool-contract-retirement/v1'
        AND event.payload->'executionAttempted' = 'false'::jsonb
        AND event.payload->>'checkpointOutcome' = 'preserved_without_replay'
        AND event.payload->>'workflow' = NEW.workflow
        AND event.payload->>'sourceType' = NEW.source_type
        AND event.payload->>'sourceId' = NEW.source_id
        AND event.payload->'workerAttempt' = to_jsonb(NEW.worker_attempt)
        AND event.payload->>'failureCode' = NEW.failure_code
        AND event.payload->>'failureMessage' = NEW.failure_message
    )
  ) THEN
    RAISE EXCEPTION 'Project task terminal state requires an immutable execution receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
