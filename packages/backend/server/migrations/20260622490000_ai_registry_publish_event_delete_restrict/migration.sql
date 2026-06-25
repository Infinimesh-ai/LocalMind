CREATE OR REPLACE FUNCTION ai_registry_publish_event_delete_restrict()
RETURNS trigger AS $$
BEGIN
  IF (
    OLD."registry_family" = 'prompt_registry'
    AND EXISTS (
      SELECT 1
      FROM "ai_prompt_registry_revisions" revision
      WHERE revision."id" = OLD."revision_id"
    )
  )
  OR (
    OLD."registry_family" = 'task_route_policy'
    AND EXISTS (
      SELECT 1
      FROM "ai_task_route_policy_revisions" revision
      WHERE revision."id" = OLD."revision_id"
    )
  )
  OR (
    OLD."registry_family" = 'model_registry'
    AND EXISTS (
      SELECT 1
      FROM "ai_model_registry_revisions" revision
      WHERE revision."id" = OLD."revision_id"
    )
  )
  OR (
    OLD."registry_family" = 'provider_registry'
    AND EXISTS (
      SELECT 1
      FROM "ai_provider_registry_revisions" revision
      WHERE revision."id" = OLD."revision_id"
    )
  ) THEN
    RAISE EXCEPTION
      'ai_registry_revision_publish_events_delete_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_registry_revision_publish_events_delete_restrict_check';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_registry_publish_events_delete_restrict_check"
AFTER DELETE
ON "ai_registry_revision_publish_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_registry_publish_event_delete_restrict();
