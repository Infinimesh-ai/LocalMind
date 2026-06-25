CREATE OR REPLACE FUNCTION ai_prompt_registry_revision_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."fallback_source_chain" IS NOT DISTINCT FROM
       NEW."fallback_source_chain"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_registry_revision_publish_events" event
    WHERE event."prompt_registry_revision_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION
      'ai_prompt_registry_revisions_content_update_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_prompt_registry_revisions_content_update_restrict_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_prompt_registry_revisions_content_update_restrict_check"
AFTER UPDATE OF
  "fallback_source_chain",
  "metadata"
ON "ai_prompt_registry_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_prompt_registry_revision_content_update_restrict();

CREATE OR REPLACE FUNCTION ai_task_route_policy_revision_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."model_id" IS NOT DISTINCT FROM NEW."model_id"
     AND OLD."config_key" IS NOT DISTINCT FROM NEW."config_key"
     AND OLD."config_path" IS NOT DISTINCT FROM NEW."config_path"
     AND OLD."fallback_source_chain" IS NOT DISTINCT FROM
       NEW."fallback_source_chain"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_registry_revision_publish_events" event
    WHERE event."task_route_policy_revision_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION
      'ai_task_route_policy_revisions_content_update_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_task_route_policy_revisions_content_update_restrict_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_task_route_policy_revisions_content_update_restrict_check"
AFTER UPDATE OF
  "model_id",
  "config_key",
  "config_path",
  "fallback_source_chain",
  "metadata"
ON "ai_task_route_policy_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_task_route_policy_revision_content_update_restrict();

CREATE OR REPLACE FUNCTION ai_model_registry_revision_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."model_definition" IS NOT DISTINCT FROM NEW."model_definition"
     AND OLD."fallback_source_chain" IS NOT DISTINCT FROM
       NEW."fallback_source_chain"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_registry_revision_publish_events" event
    WHERE event."model_registry_revision_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION
      'ai_model_registry_revisions_content_update_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_model_registry_revisions_content_update_restrict_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_model_registry_revisions_content_update_restrict_check"
AFTER UPDATE OF
  "model_definition",
  "fallback_source_chain",
  "metadata"
ON "ai_model_registry_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_model_registry_revision_content_update_restrict();

CREATE OR REPLACE FUNCTION ai_provider_registry_revision_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."provider_type" IS NOT DISTINCT FROM NEW."provider_type"
     AND OLD."provider_profile" IS NOT DISTINCT FROM NEW."provider_profile"
     AND OLD."fallback_source_chain" IS NOT DISTINCT FROM
       NEW."fallback_source_chain"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ai_registry_revision_publish_events" event
    WHERE event."provider_registry_revision_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION
      'ai_provider_registry_revisions_content_update_restrict_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_provider_registry_revisions_content_update_restrict_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_provider_registry_revisions_content_update_restrict_check"
AFTER UPDATE OF
  "provider_type",
  "provider_profile",
  "fallback_source_chain",
  "metadata"
ON "ai_provider_registry_revisions"
FOR EACH ROW
EXECUTE FUNCTION ai_provider_registry_revision_content_update_restrict();
