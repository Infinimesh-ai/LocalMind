ALTER TABLE "ai_repair_execution_side_effects"
  DROP CONSTRAINT "ai_repair_execution_side_effects_execution_request_id_fkey";

ALTER TABLE "ai_repair_execution_side_effects"
  ADD CONSTRAINT "ai_repair_execution_side_effects_execution_request_id_fkey"
  FOREIGN KEY (
    "execution_request_id",
    "workspace_id",
    "actor_id"
  )
  REFERENCES "ai_repair_execution_requests"(
    "id",
    "workspace_id",
    "actor_id"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;
