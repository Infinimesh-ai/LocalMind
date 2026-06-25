ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_title_shape_check"
  CHECK (
    "title" IS NULL
    OR length(btrim("title")) BETWEEN 1 AND 512
  ) NOT VALID;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_title_shape_check"
  CHECK (
    "title" IS NULL
    OR length(btrim("title")) BETWEEN 1 AND 512
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_summary_shape_check"
  CHECK (
    length(btrim("summary")) BETWEEN 1 AND 1024
  ) NOT VALID;
