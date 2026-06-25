ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_order_shape_check"
  CHECK (
    "order" >= 0
    AND "order" <= 10000
  ) NOT VALID;

ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_ordinal_shape_check"
  CHECK ("ordinal" >= 0) NOT VALID;
