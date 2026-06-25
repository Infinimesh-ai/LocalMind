ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_step_key_shape_check"
  CHECK (
    length(btrim("step_key")) BETWEEN 1 AND 512
  ) NOT VALID;
