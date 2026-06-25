ALTER TABLE "ai_registry_revision_publish_events"
  DROP CONSTRAINT "ai_registry_revision_publish_events_prompt_snapshot_fkey";

ALTER TABLE "ai_registry_revision_publish_events"
  DROP CONSTRAINT "ai_registry_revision_publish_events_task_snapshot_fkey";

ALTER TABLE "ai_registry_revision_publish_events"
  DROP CONSTRAINT "ai_registry_revision_publish_events_model_snapshot_fkey";

ALTER TABLE "ai_registry_revision_publish_events"
  DROP CONSTRAINT "ai_registry_revision_publish_events_provider_snapshot_fkey";

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_prompt_snapshot_fkey"
  FOREIGN KEY (
    "prompt_registry_revision_id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "registry_key",
    "revision",
    "revision_fingerprint",
    "revision_status"
  )
  REFERENCES "ai_prompt_registry_revisions"(
    "id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "prompt_name",
    "revision",
    "fingerprint",
    "status"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_task_snapshot_fkey"
  FOREIGN KEY (
    "task_route_policy_revision_id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "registry_key",
    "revision",
    "revision_fingerprint",
    "revision_status"
  )
  REFERENCES "ai_task_route_policy_revisions"(
    "id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "feature_kind",
    "revision",
    "fingerprint",
    "status"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_model_snapshot_fkey"
  FOREIGN KEY (
    "model_registry_revision_id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "registry_provider_id",
    "registry_model_id",
    "revision",
    "revision_fingerprint",
    "revision_status"
  )
  REFERENCES "ai_model_registry_revisions"(
    "id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "provider_id",
    "model_id",
    "revision",
    "fingerprint",
    "status"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_provider_snapshot_fkey"
  FOREIGN KEY (
    "provider_registry_revision_id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "registry_provider_id",
    "revision",
    "revision_fingerprint",
    "revision_status"
  )
  REFERENCES "ai_provider_registry_revisions"(
    "id",
    "scope_type",
    "workspace_id",
    "actor_id",
    "provider_id",
    "revision",
    "fingerprint",
    "status"
  )
  ON DELETE CASCADE
  ON UPDATE RESTRICT
  NOT VALID;
