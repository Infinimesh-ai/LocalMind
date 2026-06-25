CREATE OR REPLACE FUNCTION ai_prompt_registry_revision_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."fallback_source_chain" IS NOT DISTINCT FROM
       NEW."fallback_source_chain"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_prompt_registry_revisions_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_prompt_registry_revisions_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

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

  RAISE EXCEPTION
    'ai_task_route_policy_revisions_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_task_route_policy_revisions_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ai_model_registry_revision_content_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."model_definition" IS NOT DISTINCT FROM NEW."model_definition"
     AND OLD."fallback_source_chain" IS NOT DISTINCT FROM
       NEW."fallback_source_chain"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_model_registry_revisions_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_model_registry_revisions_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

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

  RAISE EXCEPTION
    'ai_provider_registry_revisions_content_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT =
        'ai_provider_registry_revisions_content_update_restrict_check';
END;
$$ LANGUAGE plpgsql;
