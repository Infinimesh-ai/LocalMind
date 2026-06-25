CREATE UNIQUE INDEX "ai_prompt_registry_revisions_publish_event_snapshot_key"
ON "ai_prompt_registry_revisions"(
  "id",
  "scope_type",
  "workspace_id",
  "actor_id",
  "prompt_name",
  "revision",
  "fingerprint",
  "status"
);

CREATE UNIQUE INDEX "ai_task_route_policy_revisions_publish_event_snapshot_key"
ON "ai_task_route_policy_revisions"(
  "id",
  "scope_type",
  "workspace_id",
  "actor_id",
  "feature_kind",
  "revision",
  "fingerprint",
  "status"
);

CREATE UNIQUE INDEX "ai_model_registry_revisions_publish_event_snapshot_key"
ON "ai_model_registry_revisions"(
  "id",
  "scope_type",
  "workspace_id",
  "actor_id",
  "provider_id",
  "model_id",
  "revision",
  "fingerprint",
  "status"
);

CREATE UNIQUE INDEX "ai_provider_registry_revisions_publish_event_snapshot_key"
ON "ai_provider_registry_revisions"(
  "id",
  "scope_type",
  "workspace_id",
  "actor_id",
  "provider_id",
  "revision",
  "fingerprint",
  "status"
);

CREATE TABLE "ai_registry_revision_publish_events" (
  "id" VARCHAR NOT NULL,
  "registry_family" VARCHAR NOT NULL,
  "revision_id" VARCHAR NOT NULL,
  "prompt_registry_revision_id" VARCHAR,
  "task_route_policy_revision_id" VARCHAR,
  "model_registry_revision_id" VARCHAR,
  "provider_registry_revision_id" VARCHAR,
  "registry_provider_id" VARCHAR,
  "registry_model_id" VARCHAR,
  "workspace_id" VARCHAR,
  "actor_id" VARCHAR,
  "scope_type" VARCHAR NOT NULL,
  "registry_key" VARCHAR NOT NULL,
  "revision" VARCHAR NOT NULL,
  "revision_fingerprint" VARCHAR NOT NULL,
  "revision_status" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "publish_source" VARCHAR NOT NULL,
  "event_fingerprint" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_registry_revision_publish_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_registry_revision_publish_events_family_check"
    CHECK (
      "registry_family" IN (
        'prompt_registry',
        'task_route_policy',
        'model_registry',
        'provider_registry'
      )
    ),
  CONSTRAINT "ai_registry_revision_publish_events_scope_check"
    CHECK ("scope_type" IN ('global', 'workspace')),
  CONSTRAINT "ai_registry_revision_publish_events_status_check"
    CHECK ("revision_status" IN ('active', 'archived', 'disabled')),
  CONSTRAINT "ai_registry_revision_publish_events_type_check"
    CHECK ("event_type" IN ('revision_published', 'revision_reused')),
  CONSTRAINT "ai_registry_revision_publish_events_source_check"
    CHECK ("publish_source" IN ('graphql_mutation', 'repair_execution_worker')),
  CONSTRAINT "ai_registry_revision_publish_events_string_shape_check"
    CHECK (
      length(btrim("id")) BETWEEN 1 AND 512
      AND length(btrim("revision_id")) BETWEEN 1 AND 512
      AND length(btrim("registry_key")) BETWEEN 1 AND 512
      AND length(btrim("revision")) BETWEEN 1 AND 512
      AND length(btrim("revision_fingerprint")) BETWEEN 1 AND 512
      AND length(btrim("event_fingerprint")) = 16
      AND "event_fingerprint" ~ '^[a-f0-9]{16}$'
      AND (
        "workspace_id" IS NULL
        OR length(btrim("workspace_id")) BETWEEN 1 AND 512
      )
      AND (
        "actor_id" IS NULL
        OR length(btrim("actor_id")) BETWEEN 1 AND 512
      )
      AND (
        "registry_provider_id" IS NULL
        OR length(btrim("registry_provider_id")) BETWEEN 1 AND 512
      )
      AND (
        "registry_model_id" IS NULL
        OR length(btrim("registry_model_id")) BETWEEN 1 AND 512
      )
    ),
  CONSTRAINT "ai_registry_revision_publish_events_scope_workspace_check"
    CHECK (
      ("scope_type" = 'global' AND "workspace_id" IS NULL)
      OR ("scope_type" = 'workspace' AND "workspace_id" IS NOT NULL)
    ),
  CONSTRAINT "ai_registry_revision_publish_events_revision_family_check"
    CHECK (
      (
        "registry_family" = 'prompt_registry'
        AND "prompt_registry_revision_id" = "revision_id"
        AND "task_route_policy_revision_id" IS NULL
        AND "model_registry_revision_id" IS NULL
        AND "provider_registry_revision_id" IS NULL
        AND "registry_provider_id" IS NULL
        AND "registry_model_id" IS NULL
      )
      OR (
        "registry_family" = 'task_route_policy'
        AND "task_route_policy_revision_id" = "revision_id"
        AND "prompt_registry_revision_id" IS NULL
        AND "model_registry_revision_id" IS NULL
        AND "provider_registry_revision_id" IS NULL
        AND "registry_provider_id" IS NULL
        AND "registry_model_id" IS NULL
      )
      OR (
        "registry_family" = 'model_registry'
        AND "model_registry_revision_id" = "revision_id"
        AND "prompt_registry_revision_id" IS NULL
        AND "task_route_policy_revision_id" IS NULL
        AND "provider_registry_revision_id" IS NULL
        AND "registry_provider_id" IS NOT NULL
        AND "registry_model_id" IS NOT NULL
        AND "registry_key" =
          "registry_provider_id" || ':' || "registry_model_id"
      )
      OR (
        "registry_family" = 'provider_registry'
        AND "provider_registry_revision_id" = "revision_id"
        AND "prompt_registry_revision_id" IS NULL
        AND "task_route_policy_revision_id" IS NULL
        AND "model_registry_revision_id" IS NULL
        AND "registry_provider_id" IS NOT NULL
        AND "registry_model_id" IS NULL
        AND "registry_key" = "registry_provider_id"
      )
    ),
  CONSTRAINT "ai_registry_revision_publish_events_metadata_shape_check"
    CHECK (
      jsonb_typeof("metadata") = 'object'
      AND "metadata" ? 'version'
      AND jsonb_typeof("metadata"->'version') = 'string'
      AND btrim("metadata"->>'version') =
        'registry-revision-publish-event/v1'
      AND "metadata" ? 'registryFamily'
      AND jsonb_typeof("metadata"->'registryFamily') = 'string'
      AND btrim("metadata"->>'registryFamily') = "registry_family"
      AND "metadata" ? 'eventType'
      AND jsonb_typeof("metadata"->'eventType') = 'string'
      AND btrim("metadata"->>'eventType') = "event_type"
      AND "metadata" ? 'publishSource'
      AND jsonb_typeof("metadata"->'publishSource') = 'string'
      AND btrim("metadata"->>'publishSource') = "publish_source"
      AND "metadata" ? 'revisionId'
      AND jsonb_typeof("metadata"->'revisionId') = 'string'
      AND btrim("metadata"->>'revisionId') = "revision_id"
      AND "metadata" ? 'registryKey'
      AND jsonb_typeof("metadata"->'registryKey') = 'string'
      AND btrim("metadata"->>'registryKey') = "registry_key"
      AND "metadata" ? 'revision'
      AND jsonb_typeof("metadata"->'revision') = 'string'
      AND btrim("metadata"->>'revision') = "revision"
      AND "metadata" ? 'revisionFingerprint'
      AND jsonb_typeof("metadata"->'revisionFingerprint') = 'string'
      AND btrim("metadata"->>'revisionFingerprint') =
        "revision_fingerprint"
      AND "metadata" ? 'revisionStatus'
      AND jsonb_typeof("metadata"->'revisionStatus') = 'string'
      AND btrim("metadata"->>'revisionStatus') = "revision_status"
      AND (
        (
          "workspace_id" IS NULL
          AND NOT ("metadata" ? 'workspaceId')
        )
        OR (
          "workspace_id" IS NOT NULL
          AND
          "metadata" ? 'workspaceId'
          AND jsonb_typeof("metadata"->'workspaceId') = 'string'
          AND btrim("metadata"->>'workspaceId') = "workspace_id"
        )
      )
      AND (
        (
          "actor_id" IS NULL
          AND NOT ("metadata" ? 'actorId')
        )
        OR (
          "actor_id" IS NOT NULL
          AND
          "metadata" ? 'actorId'
          AND jsonb_typeof("metadata"->'actorId') = 'string'
          AND btrim("metadata"->>'actorId') = "actor_id"
        )
      )
      AND (
        (
          "registry_family" = 'prompt_registry'
          AND "metadata" ? 'promptName'
          AND jsonb_typeof("metadata"->'promptName') = 'string'
          AND btrim("metadata"->>'promptName') = "registry_key"
        )
        OR (
          "registry_family" = 'task_route_policy'
          AND "metadata" ? 'featureKind'
          AND jsonb_typeof("metadata"->'featureKind') = 'string'
          AND btrim("metadata"->>'featureKind') = "registry_key"
        )
        OR (
          "registry_family" = 'model_registry'
          AND "metadata" ? 'providerId'
          AND jsonb_typeof("metadata"->'providerId') = 'string'
          AND btrim("metadata"->>'providerId') =
            "registry_provider_id"
          AND "metadata" ? 'modelId'
          AND jsonb_typeof("metadata"->'modelId') = 'string'
          AND btrim("metadata"->>'modelId') = "registry_model_id"
        )
        OR (
          "registry_family" = 'provider_registry'
          AND "metadata" ? 'providerId'
          AND jsonb_typeof("metadata"->'providerId') = 'string'
          AND btrim("metadata"->>'providerId') =
            "registry_provider_id"
        )
      )
    )
);

CREATE UNIQUE INDEX "ai_registry_revision_publish_events_fingerprint_key"
ON "ai_registry_revision_publish_events"("event_fingerprint");

CREATE INDEX "ai_registry_revision_publish_events_family_created_at_idx"
ON "ai_registry_revision_publish_events"("registry_family", "created_at");

CREATE INDEX "ai_registry_revision_publish_events_workspace_created_at_idx"
ON "ai_registry_revision_publish_events"("workspace_id", "created_at");

CREATE INDEX "ai_registry_revision_publish_events_actor_created_at_idx"
ON "ai_registry_revision_publish_events"("actor_id", "created_at");

CREATE INDEX "ai_registry_revision_publish_events_revision_created_at_idx"
ON "ai_registry_revision_publish_events"("revision_id", "created_at");

CREATE INDEX "ai_registry_revision_publish_events_type_created_at_idx"
ON "ai_registry_revision_publish_events"("event_type", "created_at");

CREATE INDEX "ai_registry_revision_publish_events_provider_model_idx"
ON "ai_registry_revision_publish_events"(
  "registry_provider_id",
  "registry_model_id",
  "created_at"
);

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_prompt_revision_fkey"
  FOREIGN KEY ("prompt_registry_revision_id")
  REFERENCES "ai_prompt_registry_revisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_task_route_revision_fkey"
  FOREIGN KEY ("task_route_policy_revision_id")
  REFERENCES "ai_task_route_policy_revisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_model_revision_fkey"
  FOREIGN KEY ("model_registry_revision_id")
  REFERENCES "ai_model_registry_revisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_registry_revision_publish_events"
  ADD CONSTRAINT "ai_registry_revision_publish_events_provider_revision_fkey"
  FOREIGN KEY ("provider_registry_revision_id")
  REFERENCES "ai_provider_registry_revisions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

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
  ON DELETE CASCADE ON UPDATE CASCADE;

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
  ON DELETE CASCADE ON UPDATE CASCADE;

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
  ON DELETE CASCADE ON UPDATE CASCADE;

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
  ON DELETE CASCADE ON UPDATE CASCADE;
