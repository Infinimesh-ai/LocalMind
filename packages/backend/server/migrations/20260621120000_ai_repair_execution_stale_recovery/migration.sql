-- AlterCheckConstraint
ALTER TABLE "ai_repair_execution_audit_events"
  DROP CONSTRAINT "ai_repair_execution_audit_events_type_check";

ALTER TABLE "ai_repair_execution_audit_events"
  ADD CONSTRAINT "ai_repair_execution_audit_events_type_check"
  CHECK ("event_type" IN (
    'requested',
    'queued',
    'waiting_approval',
    'approval_approved',
    'approval_rejected',
    'running',
    'side_effect_applied',
    'retry_scheduled',
    'manual_retry_requested',
    'stale_recovered',
    'completed',
    'failed',
    'cancelled',
    'reused'
  ));
