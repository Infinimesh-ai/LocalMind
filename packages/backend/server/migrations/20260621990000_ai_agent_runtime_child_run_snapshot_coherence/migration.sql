ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_run_snapshot_fkey"
  FOREIGN KEY (
    "run_id",
    "workspace_id",
    "actor_id"
  )
  REFERENCES "ai_agent_runs"(
    "id",
    "workspace_id",
    "actor_id"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_run_snapshot_fkey"
  FOREIGN KEY (
    "run_id",
    "workspace_id",
    "actor_id"
  )
  REFERENCES "ai_agent_runs"(
    "id",
    "workspace_id",
    "actor_id"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;
