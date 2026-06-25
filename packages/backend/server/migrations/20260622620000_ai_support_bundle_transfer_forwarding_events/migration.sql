CREATE OR REPLACE FUNCTION ai_support_bundle_transfer_forwarding_payload_valid(
  payload jsonb,
  authorization_id varchar,
  event_id varchar,
  event_source varchar,
  provider_signature_evidence_fingerprint varchar
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  event jsonb;
  notification_auth_evidence jsonb;
  provider_signature_evidence jsonb;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RETURN false;
  END IF;
  IF payload->>'version' <> 'copilot-support-bundle-transfer-forwarding-payload/v1' THEN
    RETURN false;
  END IF;
  event := payload->'event';
  IF event IS NULL OR jsonb_typeof(event) <> 'object' THEN
    RETURN false;
  END IF;
  IF length(btrim(COALESCE(event->>'authorizationId', ''))) < 1
     OR length(btrim(COALESCE(event->>'authorizationId', ''))) > 512 THEN
    RETURN false;
  END IF;
  IF event->>'authorizationId' <> authorization_id THEN
    RETURN false;
  END IF;
  IF event ? 'eventId'
     AND length(btrim(COALESCE(event->>'eventId', ''))) NOT BETWEEN 1 AND 512 THEN
    RETURN false;
  END IF;
  IF event_id IS NULL THEN
    IF event ? 'eventId' THEN
      RETURN false;
    END IF;
  ELSIF event->>'eventId' <> event_id THEN
    RETURN false;
  END IF;
  IF length(btrim(COALESCE(event->>'eventSource', ''))) < 1
     OR length(btrim(COALESCE(event->>'eventSource', ''))) > 512
     OR event->>'eventSource' <> event_source THEN
    RETURN false;
  END IF;
  IF event ? 'storageKey'
     AND length(btrim(COALESCE(event->>'storageKey', ''))) NOT BETWEEN 1 AND 1024 THEN
    RETURN false;
  END IF;
  IF event ? 'artifactByteSize'
     AND (
       jsonb_typeof(event->'artifactByteSize') <> 'number'
       OR (event->>'artifactByteSize')::numeric < 0
       OR (event->>'artifactByteSize')::numeric <> floor((event->>'artifactByteSize')::numeric)
     ) THEN
    RETURN false;
  END IF;
  IF event ? 'artifactFingerprint'
     AND COALESCE(event->>'artifactFingerprint', '') !~ '^[a-f0-9]{16}$' THEN
    RETURN false;
  END IF;
  IF event ? 'transferredAt'
     AND length(btrim(COALESCE(event->>'transferredAt', ''))) NOT BETWEEN 1 AND 128 THEN
    RETURN false;
  END IF;

  notification_auth_evidence := event->'notificationAuthEvidence';
  IF notification_auth_evidence IS NULL
     OR jsonb_typeof(notification_auth_evidence) <> 'object'
     OR notification_auth_evidence->>'policy' <> 'internal_access_token'
     OR notification_auth_evidence->>'status' <> 'verified'
     OR notification_auth_evidence->>'method' <> 'x-access-token' THEN
    RETURN false;
  END IF;

  provider_signature_evidence := notification_auth_evidence->'providerSignatureEvidence';
  IF provider_signature_evidence IS NULL THEN
    IF provider_signature_evidence_fingerprint IS NOT NULL THEN
      RETURN false;
    END IF;
    IF event_source IN ('aws:s3', 'aws.s3') THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  IF provider_signature_evidence_fingerprint IS NULL THEN
    RETURN false;
  END IF;
  IF NOT ai_support_bundle_provider_sig_evidence_valid(provider_signature_evidence) THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION
  WHEN others THEN
    RETURN false;
END;
$$;

CREATE TABLE "ai_support_bundle_transfer_forwarding_events" (
  "id" VARCHAR NOT NULL,
  "authorization_id" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "event_id" VARCHAR,
  "event_source" VARCHAR NOT NULL,
  "forwarding_event_fingerprint" VARCHAR NOT NULL,
  "forwarding_payload" JSONB NOT NULL,
  "forwarding_payload_fingerprint" VARCHAR NOT NULL,
  "provider_signature_evidence_fingerprint" VARCHAR,
  "forwarded_transfer_event_fingerprint" VARCHAR,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "next_attempt_at" TIMESTAMPTZ(3),
  "worker_lease_id" VARCHAR,
  "worker_lease_expires_at" TIMESTAMPTZ(3),
  "last_attempt_at" TIMESTAMPTZ(3),
  "forwarded_at" TIMESTAMPTZ(3),
  "dead_lettered_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR,
  "failure_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_status_check"
    CHECK ("status" IN ('queued', 'processing', 'retry_scheduled', 'forwarded', 'dead_lettered')),
  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_string_shape_check"
    CHECK (
      length(btrim("id")) BETWEEN 1 AND 768
      AND length(btrim("authorization_id")) BETWEEN 1 AND 512
      AND ("event_id" IS NULL OR length(btrim("event_id")) BETWEEN 1 AND 512)
      AND length(btrim("event_source")) BETWEEN 1 AND 512
      AND ("worker_lease_id" IS NULL OR length(btrim("worker_lease_id")) BETWEEN 1 AND 128)
      AND ("failure_code" IS NULL OR length(btrim("failure_code")) BETWEEN 1 AND 128)
      AND ("failure_message" IS NULL OR length(btrim("failure_message")) BETWEEN 1 AND 512)
    ),
  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_fingerprint_check"
    CHECK (
      "forwarding_event_fingerprint" ~ '^[a-f0-9]{16}$'
      AND "forwarding_payload_fingerprint" ~ '^[a-f0-9]{16}$'
      AND (
        "provider_signature_evidence_fingerprint" IS NULL
        OR "provider_signature_evidence_fingerprint" ~ '^[a-f0-9]{16}$'
      )
      AND (
        "forwarded_transfer_event_fingerprint" IS NULL
        OR "forwarded_transfer_event_fingerprint" ~ '^[a-f0-9]{16}$'
      )
    ),
  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_attempt_check"
    CHECK (
      "attempt_count" >= 0
      AND "max_attempts" BETWEEN 1 AND 10
      AND "attempt_count" <= "max_attempts"
    ),
  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_payload_check"
    CHECK (
      ai_support_bundle_transfer_forwarding_payload_valid(
        "forwarding_payload",
        "authorization_id",
        "event_id",
        "event_source",
        "provider_signature_evidence_fingerprint"
      )
    ),
  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_state_check"
    CHECK (
      (
        "status" = 'queued'
        AND "attempt_count" = 0
        AND "next_attempt_at" IS NOT NULL
        AND "worker_lease_id" IS NULL
        AND "worker_lease_expires_at" IS NULL
        AND "last_attempt_at" IS NULL
        AND "forwarded_at" IS NULL
        AND "dead_lettered_at" IS NULL
        AND "forwarded_transfer_event_fingerprint" IS NULL
        AND "failure_code" IS NULL
        AND "failure_message" IS NULL
      )
      OR (
        "status" = 'processing'
        AND "attempt_count" BETWEEN 1 AND "max_attempts"
        AND "next_attempt_at" IS NULL
        AND "worker_lease_id" IS NOT NULL
        AND "worker_lease_expires_at" IS NOT NULL
        AND "last_attempt_at" IS NOT NULL
        AND "forwarded_at" IS NULL
        AND "dead_lettered_at" IS NULL
        AND "forwarded_transfer_event_fingerprint" IS NULL
        AND "failure_code" IS NULL
        AND "failure_message" IS NULL
      )
      OR (
        "status" = 'retry_scheduled'
        AND "attempt_count" BETWEEN 1 AND ("max_attempts" - 1)
        AND "next_attempt_at" IS NOT NULL
        AND "worker_lease_id" IS NULL
        AND "worker_lease_expires_at" IS NULL
        AND "last_attempt_at" IS NOT NULL
        AND "forwarded_at" IS NULL
        AND "dead_lettered_at" IS NULL
        AND "forwarded_transfer_event_fingerprint" IS NULL
        AND "failure_code" IS NOT NULL
        AND "failure_message" IS NOT NULL
      )
      OR (
        "status" = 'forwarded'
        AND "attempt_count" BETWEEN 1 AND "max_attempts"
        AND "next_attempt_at" IS NULL
        AND "worker_lease_id" IS NULL
        AND "worker_lease_expires_at" IS NULL
        AND "last_attempt_at" IS NOT NULL
        AND "forwarded_at" IS NOT NULL
        AND "dead_lettered_at" IS NULL
        AND "forwarded_transfer_event_fingerprint" IS NOT NULL
        AND "failure_code" IS NULL
        AND "failure_message" IS NULL
      )
      OR (
        "status" = 'dead_lettered'
        AND "attempt_count" BETWEEN 1 AND "max_attempts"
        AND "next_attempt_at" IS NULL
        AND "worker_lease_id" IS NULL
        AND "worker_lease_expires_at" IS NULL
        AND "last_attempt_at" IS NOT NULL
        AND "forwarded_at" IS NULL
        AND "dead_lettered_at" IS NOT NULL
        AND "forwarded_transfer_event_fingerprint" IS NULL
        AND "failure_code" IS NOT NULL
        AND "failure_message" IS NOT NULL
      )
    ),
  CONSTRAINT "ai_support_bundle_transfer_forwarding_events_time_check"
    CHECK (
      "updated_at" >= "created_at"
      AND ("next_attempt_at" IS NULL OR "next_attempt_at" >= "created_at")
      AND ("worker_lease_expires_at" IS NULL OR "worker_lease_expires_at" >= "created_at")
      AND ("last_attempt_at" IS NULL OR "last_attempt_at" >= "created_at")
      AND ("forwarded_at" IS NULL OR "forwarded_at" >= "created_at")
      AND ("dead_lettered_at" IS NULL OR "dead_lettered_at" >= "created_at")
    )
);

CREATE UNIQUE INDEX "ai_support_bundle_transfer_forwarding_events_auth_event_key"
ON "ai_support_bundle_transfer_forwarding_events" (
  "authorization_id",
  "forwarding_event_fingerprint"
);

CREATE INDEX "ai_support_bundle_transfer_forwarding_events_due_idx"
ON "ai_support_bundle_transfer_forwarding_events"(
  "status",
  "next_attempt_at",
  "created_at"
);

CREATE INDEX "ai_support_bundle_transfer_forwarding_events_auth_created_idx"
ON "ai_support_bundle_transfer_forwarding_events"("authorization_id", "created_at");

CREATE INDEX "ai_support_bundle_transfer_forwarding_events_source_created_idx"
ON "ai_support_bundle_transfer_forwarding_events"("event_source", "created_at");

ALTER TABLE "ai_support_bundle_transfer_forwarding_events"
  ADD CONSTRAINT "ai_support_bundle_transfer_forwarding_events_auth_fkey"
  FOREIGN KEY ("authorization_id")
  REFERENCES "ai_support_bundle_download_authorizations"("id")
  ON DELETE CASCADE
  ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION ai_support_bundle_transfer_forwarding_content_update_restrict()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.event_source IS DISTINCT FROM OLD.event_source
    OR NEW.forwarding_event_fingerprint IS DISTINCT FROM OLD.forwarding_event_fingerprint
    OR NEW.forwarding_payload IS DISTINCT FROM OLD.forwarding_payload
    OR NEW.forwarding_payload_fingerprint IS DISTINCT FROM OLD.forwarding_payload_fingerprint
    OR NEW.provider_signature_evidence_fingerprint IS DISTINCT FROM OLD.provider_signature_evidence_fingerprint
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Cannot mutate support bundle transfer forwarding event evidence'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_support_bundle_transfer_forwarding_events_content_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ai_support_bundle_transfer_forwarding_events_content_check"
AFTER UPDATE ON "ai_support_bundle_transfer_forwarding_events"
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_transfer_forwarding_content_update_restrict();

CREATE OR REPLACE FUNCTION ai_support_bundle_transfer_forwarding_delete_restrict()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_support_bundle_download_authorizations" auth
    WHERE auth."id" = OLD.authorization_id
  ) THEN
    RAISE EXCEPTION 'Cannot delete support bundle transfer forwarding event while authorization exists'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_support_bundle_transfer_forwarding_events_delete_check';
  END IF;

  RETURN OLD;
END;
$$;

CREATE CONSTRAINT TRIGGER
  "zz_ai_support_bundle_tfwd_delete_check"
AFTER DELETE
ON "ai_support_bundle_transfer_forwarding_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_transfer_forwarding_delete_restrict();
