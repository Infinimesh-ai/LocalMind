ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_timeline_step_snapshot_key"
  UNIQUE ("id", "run_id", "workspace_id", "actor_id");

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_step_snapshot_fkey"
  FOREIGN KEY (
    "step_id",
    "run_id",
    "workspace_id",
    "actor_id"
  )
  REFERENCES "ai_agent_steps"(
    "id",
    "run_id",
    "workspace_id",
    "actor_id"
  )
  ON DELETE SET NULL ("step_id")
  ON UPDATE RESTRICT
  NOT VALID;
