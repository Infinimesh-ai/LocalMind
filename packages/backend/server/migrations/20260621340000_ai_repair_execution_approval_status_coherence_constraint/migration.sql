ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_approval_status_check"
  CHECK (
    (
      "status" = 'waiting_approval'
      AND "approval_state" = 'waiting'
    )
    OR
    (
      "status" IN ('queued', 'running', 'completed', 'failed')
      AND "approval_state" IN ('approved', 'not_required')
    )
    OR
    (
      "status" = 'cancelled'
      AND "approval_state" IN (
        'waiting',
        'approved',
        'not_required',
        'rejected'
      )
    )
  ) NOT VALID;
