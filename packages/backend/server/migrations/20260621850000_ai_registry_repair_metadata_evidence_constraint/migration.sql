CREATE OR REPLACE FUNCTION ai_registry_repair_metadata_bounded_string(
  metadata jsonb,
  field_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata->field_name) = 'string'
    AND length(btrim(metadata->>field_name)) BETWEEN 1 AND 512,
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_registry_repair_metadata_string_array(
  metadata jsonb,
  field_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata->field_name) = 'array'
    AND jsonb_array_length(metadata->field_name) BETWEEN 1 AND 128
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(metadata->field_name) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
        OR length(btrim(item.value #>> '{}')) NOT BETWEEN 1 AND 512
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_registry_repair_common_metadata_valid(
  metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_typeof(metadata) = 'object'
    AND jsonb_typeof(metadata->'publishSource') = 'string'
    AND btrim(metadata->>'publishSource') = 'repair_execution_worker'
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'executionRequestId'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'requestFingerprint'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'candidateEvidenceSetFingerprint'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'taskRouteEvidenceSetFingerprint'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'repairJobFingerprint'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'approvalRecordFingerprint'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'operationSetFingerprint'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'previewFingerprint'
    )
    AND ai_registry_repair_metadata_bounded_string(
      metadata,
      'catalogFingerprint'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_prompt_registry_repair_metadata_valid(
  metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NOT (metadata ? 'version')
    OR metadata->>'version' <> 'prompt-registry-revision-repair-executor/v1'
    OR (
      ai_registry_repair_common_metadata_valid(metadata)
      AND ai_registry_repair_metadata_bounded_string(
        metadata,
        'expectedRegistryFingerprint'
      )
      AND jsonb_typeof(metadata->'expectedRegistryId') = 'number'
      AND (metadata->>'expectedRegistryId') ~ '^[0-9]+$'
      AND (metadata->>'expectedRegistryId')::numeric > 0
      AND (metadata->>'expectedRegistryId')::numeric <= 9007199254740991
      AND ai_registry_repair_metadata_bounded_string(
        metadata,
        'expectedRegistryUpdatedAt'
      )
      AND ai_registry_repair_metadata_string_array(
        metadata,
        'operationFingerprints'
      )
      AND ai_registry_repair_metadata_string_array(metadata, 'operationKinds')
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_registry_repair_revision_metadata_valid(
  metadata jsonb,
  repair_version text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NOT (metadata ? 'version')
    OR metadata->>'version' <> repair_version
    OR (
      ai_registry_repair_common_metadata_valid(metadata)
      AND ai_registry_repair_metadata_bounded_string(
        metadata,
        'operationFingerprint'
      )
      AND ai_registry_repair_metadata_bounded_string(
        metadata,
        'targetLocatorFingerprint'
      )
      AND (
        NOT (metadata ? 'candidateEvidenceFingerprints')
        OR ai_registry_repair_metadata_string_array(
          metadata,
          'candidateEvidenceFingerprints'
        )
      )
      AND (
        NOT (metadata ? 'taskRouteEffectiveSourceFingerprints')
        OR ai_registry_repair_metadata_string_array(
          metadata,
          'taskRouteEffectiveSourceFingerprints'
        )
      )
    ),
    false
  );
$$;

ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_repair_metadata_evidence_check"
  CHECK (ai_prompt_registry_repair_metadata_valid("metadata")) NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_repair_metadata_evidence_check"
  CHECK (
    ai_registry_repair_revision_metadata_valid(
      "metadata",
      'task-route-policy-revision-repair-executor/v1'
    )
  ) NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_repair_metadata_evidence_check"
  CHECK (
    ai_registry_repair_revision_metadata_valid(
      "metadata",
      'model-registry-revision-repair-executor/v1'
    )
  ) NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_repair_metadata_evidence_check"
  CHECK (
    ai_registry_repair_revision_metadata_valid(
      "metadata",
      'provider-registry-revision-repair-executor/v1'
    )
  ) NOT VALID;
