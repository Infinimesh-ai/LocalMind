ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_json_shape_check"
  CHECK (
    jsonb_typeof("runtime_result") = 'object'
    AND jsonb_typeof("executor_payload") = 'object'
  ) NOT VALID;

ALTER TABLE "ai_repair_execution_audit_events"
  ADD CONSTRAINT "ai_repair_execution_audit_events_metadata_shape_check"
  CHECK (jsonb_typeof("metadata") = 'object') NOT VALID;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_output_summary_shape_check"
  CHECK (jsonb_typeof("output_summary") = 'object') NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_payload_shape_check"
  CHECK (jsonb_typeof("payload") = 'object') NOT VALID;
