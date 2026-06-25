CREATE UNIQUE INDEX "ai_support_bundle_download_authorizations_transfer_snapshot_key"
ON "ai_support_bundle_download_authorizations" (
  "id",
  "bundle_id",
  "workspace_id",
  "actor_id",
  "artifact_kind",
  "manifest_fingerprint",
  "artifact_fingerprint",
  "authorization_fingerprint",
  "delivery_method"
);

CREATE TABLE "ai_support_bundle_transfer_events" (
  "id" VARCHAR NOT NULL,
  "authorization_id" VARCHAR NOT NULL,
  "bundle_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR NOT NULL,
  "artifact_kind" VARCHAR NOT NULL,
  "manifest_fingerprint" VARCHAR NOT NULL,
  "artifact_fingerprint" VARCHAR NOT NULL,
  "authorization_fingerprint" VARCHAR NOT NULL,
  "delivery_method" VARCHAR NOT NULL,
  "event_id" VARCHAR,
  "event_source" VARCHAR NOT NULL,
  "transferred_at" TIMESTAMPTZ(3) NOT NULL,
  "notification_auth_evidence" JSONB NOT NULL,
  "notification_auth_evidence_fingerprint" VARCHAR NOT NULL,
  "storage_key" VARCHAR NOT NULL,
  "storage_byte_size" INTEGER NOT NULL,
  "storage_content_type" VARCHAR NOT NULL,
  "event_fingerprint" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_support_bundle_transfer_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_support_bundle_transfer_events_artifact_kind_check"
    CHECK ("artifact_kind" IN ('manifest_json', 'archive_json')),
  CONSTRAINT "ai_support_bundle_transfer_events_delivery_method_check"
    CHECK ("delivery_method" = 'object_storage_signed_url'),
  CONSTRAINT "ai_support_bundle_transfer_events_string_shape_check"
    CHECK (
      ("event_id" IS NULL OR length(btrim("event_id")) BETWEEN 1 AND 512)
      AND length(btrim("event_source")) BETWEEN 1 AND 512
      AND length(btrim("storage_key")) BETWEEN 1 AND 1024
      AND length(btrim("storage_content_type")) BETWEEN 1 AND 128
    ),
  CONSTRAINT "ai_support_bundle_transfer_events_fingerprint_shape_check"
    CHECK (
      "manifest_fingerprint" ~ '^[a-f0-9]{16}$'
      AND "artifact_fingerprint" ~ '^[a-f0-9]{16}$'
      AND "authorization_fingerprint" ~ '^[a-f0-9]{16}$'
      AND "notification_auth_evidence_fingerprint" ~ '^[a-f0-9]{16}$'
      AND "event_fingerprint" ~ '^[a-f0-9]{16}$'
    ),
  CONSTRAINT "ai_support_bundle_transfer_events_storage_shape_check"
    CHECK ("storage_byte_size" >= 0),
  CONSTRAINT "ai_support_bundle_transfer_events_manifest_artifact_check"
    CHECK (
      "artifact_kind" <> 'manifest_json'
      OR "artifact_fingerprint" = "manifest_fingerprint"
    ),
  CONSTRAINT "ai_support_bundle_transfer_events_auth_evidence_check"
    CHECK (
      COALESCE(
        jsonb_typeof("notification_auth_evidence") = 'object'
        AND "notification_auth_evidence"->>'policy' = 'internal_access_token'
        AND "notification_auth_evidence"->>'status' = 'verified'
        AND "notification_auth_evidence"->>'method' = 'x-access-token'
        AND (
          "event_source" NOT IN ('aws:s3', 'aws.s3')
          OR COALESCE(
            "notification_auth_evidence" ? 'providerSignatureEvidence',
            false
          )
        )
        AND (
          NOT COALESCE(
            "notification_auth_evidence" ? 'providerSignatureEvidence',
            false
          )
          OR ai_support_bundle_provider_sig_evidence_valid(
            "notification_auth_evidence"->'providerSignatureEvidence'
          )
        ),
        false
      )
    )
);

CREATE UNIQUE INDEX "ai_support_bundle_transfer_events_authorization_event_key"
ON "ai_support_bundle_transfer_events" (
  "authorization_id",
  "event_fingerprint"
);

CREATE INDEX "ai_support_bundle_transfer_events_auth_created_at_idx"
ON "ai_support_bundle_transfer_events"("authorization_id", "created_at");

CREATE INDEX "ai_support_bundle_transfer_events_bundle_id_created_at_idx"
ON "ai_support_bundle_transfer_events"("bundle_id", "created_at");

CREATE INDEX "ai_support_bundle_transfer_events_workspace_id_created_at_idx"
ON "ai_support_bundle_transfer_events"("workspace_id", "created_at");

CREATE INDEX "ai_support_bundle_transfer_events_actor_id_created_at_idx"
ON "ai_support_bundle_transfer_events"("actor_id", "created_at");

CREATE INDEX "ai_support_bundle_transfer_events_event_source_created_at_idx"
ON "ai_support_bundle_transfer_events"("event_source", "created_at");

ALTER TABLE "ai_support_bundle_transfer_events"
  ADD CONSTRAINT "ai_support_bundle_transfer_events_authorization_fkey"
  FOREIGN KEY (
    "authorization_id",
    "bundle_id",
    "workspace_id",
    "actor_id",
    "artifact_kind",
    "manifest_fingerprint",
    "artifact_fingerprint",
    "authorization_fingerprint",
    "delivery_method"
  )
  REFERENCES "ai_support_bundle_download_authorizations" (
    "id",
    "bundle_id",
    "workspace_id",
    "actor_id",
    "artifact_kind",
    "manifest_fingerprint",
    "artifact_fingerprint",
    "authorization_fingerprint",
    "delivery_method"
  )
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ai_support_bundle_transfer_events"
  ADD CONSTRAINT "ai_support_bundle_transfer_events_bundle_id_fkey"
  FOREIGN KEY ("bundle_id")
  REFERENCES "ai_support_bundle_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ai_support_bundle_transfer_events"
  ADD CONSTRAINT "ai_support_bundle_transfer_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "ai_support_bundle_transfer_events"
  ADD CONSTRAINT "ai_support_bundle_transfer_events_actor_id_fkey"
  FOREIGN KEY ("actor_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
