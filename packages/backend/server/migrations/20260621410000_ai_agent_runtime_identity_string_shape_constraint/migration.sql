ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_identity_shape_check"
  CHECK (
    length(btrim("workflow")) BETWEEN 1 AND 512
    AND length(btrim("source_type")) BETWEEN 1 AND 512
    AND length(btrim("source_id")) BETWEEN 1 AND 512
  ) NOT VALID;
