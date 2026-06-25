ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_workspace_actor_check"
  CHECK (
    "scope_type" <> 'workspace'
    OR "actor_id" IS NOT NULL
  )
  NOT VALID;
