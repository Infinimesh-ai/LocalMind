ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_source_workflow_coherence_check"
  CHECK (
    (
      "source_type" = 'repair_execution_request'
      AND "workflow" = 'prompt_registry_repair_execution'
    )
    OR (
      "source_type" <> 'repair_execution_request'
      AND "workflow" <> 'prompt_registry_repair_execution'
    )
  ) NOT VALID;
