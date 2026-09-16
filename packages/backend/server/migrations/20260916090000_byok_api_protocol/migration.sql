-- Null preserves the historical OpenAI Responses route and does not claim an
-- explicit protocol selection in immutable historical audit events.
ALTER TABLE "ai_workspace_byok_configs"
  ADD COLUMN "api_style" VARCHAR(32),
  ADD COLUMN "config_revision" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "ai_workspace_byok_config_revision" CHECK ("config_revision" > 0),
  ADD CONSTRAINT "ai_workspace_byok_api_style" CHECK (
    "api_style" IS NULL OR ("provider" = 'openai' AND "api_style" IN ('chat_completions', 'responses'))
  );
ALTER TABLE "ai_project_byok_config"
  ADD COLUMN "api_style" VARCHAR(32),
  ADD CONSTRAINT "ai_project_byok_api_style" CHECK (
    "api_style" IS NULL OR ("provider" = 'openai' AND "api_style" IN ('chat_completions', 'responses'))
  );
ALTER TABLE "ai_project_byok_audit_events"
  ADD COLUMN "api_style" VARCHAR(32),
  ADD CONSTRAINT "ai_project_byok_audit_api_style" CHECK (
    "api_style" IS NULL OR ("provider" = 'openai' AND "api_style" IN ('chat_completions', 'responses'))
  );

CREATE FUNCTION advance_workspace_byok_config_revision() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW.provider, NEW.name, NEW.description, NEW.encrypted_api_key,
         NEW.endpoint, NEW.model_id, NEW.api_style, NEW.sort_order, NEW.enabled)
     IS DISTINCT FROM
     ROW(OLD.provider, OLD.name, OLD.description, OLD.encrypted_api_key,
         OLD.endpoint, OLD.model_id, OLD.api_style, OLD.sort_order, OLD.enabled) THEN
    NEW.config_revision := OLD.config_revision + 1;
    IF ROW(NEW.provider, NEW.encrypted_api_key, NEW.endpoint, NEW.model_id, NEW.api_style)
       IS DISTINCT FROM
       ROW(OLD.provider, OLD.encrypted_api_key, OLD.endpoint, OLD.model_id, OLD.api_style) THEN
      NEW.last_validated_at := NULL;
      NEW.last_validation_error := NULL;
    END IF;
  ELSE
    NEW.config_revision := OLD.config_revision;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_workspace_byok_config_revision_trigger"
BEFORE UPDATE ON "ai_workspace_byok_configs"
FOR EACH ROW EXECUTE FUNCTION advance_workspace_byok_config_revision();
