ALTER TABLE "ai_repair_execution_requests"
  ADD CONSTRAINT "ai_repair_execution_requests_permission_status_check"
  CHECK ("permission_status" IN ('granted')) NOT VALID;
