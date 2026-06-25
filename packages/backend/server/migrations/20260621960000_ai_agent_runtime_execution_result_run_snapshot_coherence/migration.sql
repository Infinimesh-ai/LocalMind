ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_execution_result_source_snapshot_key"
  UNIQUE ("id", "workspace_id", "actor_id", "workflow", "source_type", "source_id");

ALTER TABLE "ai_agent_runtime_execution_results"
  ADD CONSTRAINT "ai_agent_runtime_execution_results_run_source_snapshot_fkey"
  FOREIGN KEY (
    "run_id",
    "workspace_id",
    "actor_id",
    "workflow",
    "source_type",
    "source_id"
  )
  REFERENCES "ai_agent_runs"(
    "id",
    "workspace_id",
    "actor_id",
    "workflow",
    "source_type",
    "source_id"
  )
  ON DELETE CASCADE ON UPDATE CASCADE;
