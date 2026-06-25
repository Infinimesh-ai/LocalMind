CREATE OR REPLACE FUNCTION ai_registry_revision_publish_event_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."registry_family" IS NOT DISTINCT FROM NEW."registry_family"
     AND OLD."revision_id" IS NOT DISTINCT FROM NEW."revision_id"
     AND OLD."prompt_registry_revision_id" IS NOT DISTINCT FROM
       NEW."prompt_registry_revision_id"
     AND OLD."task_route_policy_revision_id" IS NOT DISTINCT FROM
       NEW."task_route_policy_revision_id"
     AND OLD."model_registry_revision_id" IS NOT DISTINCT FROM
       NEW."model_registry_revision_id"
     AND OLD."provider_registry_revision_id" IS NOT DISTINCT FROM
       NEW."provider_registry_revision_id"
     AND OLD."registry_provider_id" IS NOT DISTINCT FROM
       NEW."registry_provider_id"
     AND OLD."registry_model_id" IS NOT DISTINCT FROM
       NEW."registry_model_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."registry_key" IS NOT DISTINCT FROM NEW."registry_key"
     AND OLD."revision" IS NOT DISTINCT FROM NEW."revision"
     AND OLD."revision_fingerprint" IS NOT DISTINCT FROM
       NEW."revision_fingerprint"
     AND OLD."revision_status" IS NOT DISTINCT FROM
       NEW."revision_status"
     AND OLD."event_type" IS NOT DISTINCT FROM NEW."event_type"
     AND OLD."publish_source" IS NOT DISTINCT FROM NEW."publish_source"
     AND OLD."event_fingerprint" IS NOT DISTINCT FROM
       NEW."event_fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_registry_revision_publish_events_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_registry_revision_publish_events_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_registry_revision_publish_events_content_update_restrict_check"
AFTER UPDATE
ON "ai_registry_revision_publish_events"
FOR EACH ROW
EXECUTE FUNCTION ai_registry_revision_publish_event_content_update_restrict();
