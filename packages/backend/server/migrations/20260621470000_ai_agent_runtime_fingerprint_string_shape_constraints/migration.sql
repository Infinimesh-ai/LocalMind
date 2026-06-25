ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_fingerprint_shape_check"
  CHECK (
    length(btrim("target_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("evidence_fingerprint")) BETWEEN 1 AND 128
    AND length(btrim("timeline_fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_fingerprint_shape_check"
  CHECK (
    length(btrim("evidence_fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_fingerprint_shape_check"
  CHECK (
    length(btrim("event_fingerprint")) BETWEEN 1 AND 128
  ) NOT VALID;
