CREATE OR REPLACE FUNCTION "ai_registry_source_chain_optional_text_fields_valid"(
  "source_chain" jsonb,
  "field_names" text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof("source_chain") = 'array' THEN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements("source_chain") AS "entry"("value")
      CROSS JOIN unnest("field_names") AS "field_name"("value")
      WHERE "entry"."value" ? "field_name"."value"
        AND (
          jsonb_typeof("entry"."value"->"field_name"."value") IS DISTINCT FROM 'string'
          OR length(btrim("entry"."value"->>"field_name"."value")) = 0
          OR length(btrim("entry"."value"->>"field_name"."value")) > 512
        )
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION "ai_registry_source_chain_optional_enum_fields_valid"(
  "source_chain" jsonb,
  "field_name" text,
  "allowed_values" text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof("source_chain") = 'array' THEN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements("source_chain") AS "entry"("value")
      WHERE "entry"."value" ? "field_name"
        AND (
          jsonb_typeof("entry"."value"->"field_name") IS DISTINCT FROM 'string'
          OR "entry"."value"->>"field_name" <> ALL("allowed_values")
        )
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION "ai_registry_source_chain_opt_nonneg_int_field_valid"(
  "source_chain" jsonb,
  "field_name" text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof("source_chain") = 'array' THEN NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements("source_chain") AS "entry"("value")
      WHERE "entry"."value" ? "field_name"
        AND (
          jsonb_typeof("entry"."value"->"field_name") IS DISTINCT FROM 'number'
          OR ("entry"."value"->>"field_name") !~ '^[0-9]+$'
          OR ("entry"."value"->>"field_name")::numeric > 9007199254740991
        )
    )
    ELSE false
  END;
$$;

ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_source_chain_metadata_check"
  CHECK (
    "ai_registry_source_chain_optional_text_fields_valid"(
      "fallback_source_chain",
      ARRAY[
        'actorId',
        'configPath',
        'fingerprint',
        'revision',
        'updatedAt',
        'workspaceId'
      ]::text[]
    )
    AND "ai_registry_source_chain_opt_nonneg_int_field_valid"(
      "fallback_source_chain",
      'registryId'
    )
  ) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_source_chain_metadata_check"
  CHECK (
    "ai_registry_source_chain_optional_text_fields_valid"(
      "fallback_source_chain",
      ARRAY[
        'actorId',
        'configPath',
        'fingerprint',
        'modelId',
        'revision',
        'updatedAt',
        'workspaceId'
      ]::text[]
    )
    AND "ai_registry_source_chain_optional_enum_fields_valid"(
      "fallback_source_chain",
      'configKey',
      ARRAY['embedding', 'workspaceIndexing', 'rerank']::text[]
    )
    AND "ai_registry_source_chain_optional_enum_fields_valid"(
      "fallback_source_chain",
      'featureKind',
      ARRAY['embedding', 'workspace_indexing', 'rerank']::text[]
    )
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_source_chain_metadata_check"
  CHECK (
    "ai_registry_source_chain_optional_text_fields_valid"(
      "fallback_source_chain",
      ARRAY[
        'actorId',
        'fingerprint',
        'modelId',
        'providerId',
        'revision',
        'updatedAt',
        'workspaceId'
      ]::text[]
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_source_chain_metadata_check"
  CHECK (
    "ai_registry_source_chain_optional_text_fields_valid"(
      "fallback_source_chain",
      ARRAY[
        'actorId',
        'fingerprint',
        'providerId',
        'revision',
        'updatedAt',
        'workspaceId'
      ]::text[]
    )
    AND "ai_registry_source_chain_optional_enum_fields_valid"(
      "fallback_source_chain",
      'providerType',
      ARRAY[
        'anthropic',
        'anthropicVertex',
        'cloudflareWorkersAi',
        'fal',
        'gemini',
        'geminiVertex',
        'openai',
        'openaiCompatible'
      ]::text[]
    )
  ) NOT VALID;
