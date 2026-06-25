ALTER TABLE "ai_agent_timeline_events"
  ADD CONSTRAINT "ai_agent_timeline_events_status_check"
  CHECK (
    "status" IN (
      'queued',
      'running',
      'waiting_approval',
      'completed',
      'failed',
      'cancelled',
      'pending',
      'skipped'
    )
  ) NOT VALID;
