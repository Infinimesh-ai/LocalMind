ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_config_string_shape_check"
  CHECK (
    (
      "config_key" IS NULL
      OR length(btrim("config_key")) BETWEEN 1 AND 512
    )
    AND (
      "config_path" IS NULL
      OR length(btrim("config_path")) BETWEEN 1 AND 512
    )
  ) NOT VALID;
