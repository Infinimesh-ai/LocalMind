CREATE TABLE "ai_mcp_delegation_endpoints" (
  "id" VARCHAR NOT NULL,
  "credential_family_id" VARCHAR NOT NULL,
  "user_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "callback_url" TEXT NOT NULL,
  "encrypted_callback_secret" TEXT NOT NULL,
  "callback_secret_fingerprint" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_mcp_delegation_endpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_mcp_delegation_endpoints_shape_check" CHECK (
    length(btrim("credential_family_id")) BETWEEN 1 AND 512 AND
    length(btrim("callback_url")) BETWEEN 1 AND 2048 AND
    length(btrim("encrypted_callback_secret")) > 0 AND
    length(btrim("callback_secret_fingerprint")) BETWEEN 8 AND 128
  )
);

CREATE UNIQUE INDEX "ai_mcp_delegation_endpoints_credential_family_id_key"
  ON "ai_mcp_delegation_endpoints"("credential_family_id");
CREATE INDEX "ai_mcp_delegation_endpoints_user_id_workspace_id_idx"
  ON "ai_mcp_delegation_endpoints"("user_id", "workspace_id");

CREATE TABLE "ai_mcp_delegation_requests" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR NOT NULL,
  "credential_id" VARCHAR NOT NULL,
  "credential_family_id" VARCHAR NOT NULL,
  "credential_generation" INTEGER NOT NULL,
  "capability_snapshot" TEXT[] NOT NULL,
  "capability_fingerprint" VARCHAR NOT NULL,
  "idempotency_key" VARCHAR NOT NULL,
  "request_text" TEXT NOT NULL,
  "requested_document_ids" TEXT[] NOT NULL,
  "request_fingerprint" VARCHAR NOT NULL,
  "context_fingerprint" VARCHAR,
  "status" VARCHAR NOT NULL,
  "result" JSONB NOT NULL DEFAULT '{}',
  "agent_run_id" VARCHAR,
  "target_document_id" VARCHAR,
  "target_document_version" TIMESTAMPTZ(3),
  "approval_id" VARCHAR,
  "approval_preview_hash" VARCHAR,
  "approval_expires_at" TIMESTAMPTZ(3),
  "approval_decision" VARCHAR,
  "approval_decision_fingerprint" VARCHAR,
  "approval_idempotency_key" VARCHAR,
  "approval_resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_mcp_delegation_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_mcp_delegation_requests_shape_check" CHECK (
    length(btrim("credential_family_id")) BETWEEN 1 AND 512 AND
    "credential_generation" >= 0 AND
    cardinality("capability_snapshot") > 0 AND
    length(btrim("capability_fingerprint")) BETWEEN 8 AND 128 AND
    length(btrim("idempotency_key")) BETWEEN 1 AND 256 AND
    length(btrim("request_text")) BETWEEN 1 AND 12000 AND
    cardinality("requested_document_ids") <= 20 AND
    length(btrim("request_fingerprint")) BETWEEN 8 AND 128 AND
    ("context_fingerprint" IS NULL OR length(btrim("context_fingerprint")) BETWEEN 8 AND 128) AND
    "status" IN ('processing', 'completed', 'waiting_approval', 'unsupported_task', 'credential_scope_denied', 'permission_denied', 'resource_not_accessible', 'failed', 'rejected') AND
    jsonb_typeof("result") = 'object' AND
    (
      ("approval_id" IS NULL AND "approval_preview_hash" IS NULL AND "approval_expires_at" IS NULL) OR
      ("approval_id" IS NOT NULL AND "approval_preview_hash" IS NOT NULL AND "approval_expires_at" IS NOT NULL)
    ) AND
    (
      ("approval_decision" IS NULL AND "approval_decision_fingerprint" IS NULL AND "approval_idempotency_key" IS NULL AND "approval_resolved_at" IS NULL) OR
      (
        "approval_decision" IN ('approved', 'rejected') AND
        length(btrim("approval_decision_fingerprint")) BETWEEN 8 AND 128 AND
        length(btrim("approval_idempotency_key")) BETWEEN 1 AND 300 AND
        "approval_resolved_at" IS NOT NULL
      )
    ) AND
    (
      ("target_document_id" IS NULL AND "target_document_version" IS NULL) OR
      ("target_document_id" IS NOT NULL AND "target_document_version" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "ai_mcp_delegation_requests_approval_id_key"
  ON "ai_mcp_delegation_requests"("approval_id");
CREATE UNIQUE INDEX "ai_mcp_delegation_requests_workspace_family_idempotency_key"
  ON "ai_mcp_delegation_requests"("workspace_id", "credential_family_id", "idempotency_key");
CREATE INDEX "ai_mcp_delegation_requests_workspace_id_created_at_idx"
  ON "ai_mcp_delegation_requests"("workspace_id", "created_at");
CREATE INDEX "ai_mcp_delegation_requests_actor_id_created_at_idx"
  ON "ai_mcp_delegation_requests"("actor_id", "created_at");
CREATE INDEX "ai_mcp_delegation_requests_status_updated_at_idx"
  ON "ai_mcp_delegation_requests"("status", "updated_at");

CREATE TABLE "ai_mcp_delegation_callback_deliveries" (
  "id" VARCHAR NOT NULL,
  "request_id" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_fingerprint" VARCHAR NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_attempt_at" TIMESTAMPTZ(3),
  "worker_lease_id" VARCHAR,
  "worker_lease_expires_at" TIMESTAMPTZ(3),
  "delivered_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR,
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_mcp_delegation_callback_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_mcp_delegation_callback_deliveries_shape_check" CHECK (
    length(btrim("event_type")) BETWEEN 1 AND 128 AND
    "status" IN ('queued', 'processing', 'delivered', 'retry_scheduled', 'failed') AND
    jsonb_typeof("payload") = 'object' AND
    length(btrim("payload_fingerprint")) BETWEEN 8 AND 128 AND
    "attempt_count" >= 0 AND
    "max_attempts" BETWEEN 1 AND 20 AND
    (("worker_lease_id" IS NULL AND "worker_lease_expires_at" IS NULL) OR ("worker_lease_id" IS NOT NULL AND "worker_lease_expires_at" IS NOT NULL)) AND
    (("last_error_code" IS NULL AND "last_error_message" IS NULL) OR ("last_error_code" IS NOT NULL AND "last_error_message" IS NOT NULL))
  )
);

CREATE UNIQUE INDEX "ai_mcp_delegation_callback_deliveries_request_event_key"
  ON "ai_mcp_delegation_callback_deliveries"("request_id", "event_type");
CREATE INDEX "ai_mcp_delegation_callback_deliveries_status_next_attempt_at_idx"
  ON "ai_mcp_delegation_callback_deliveries"("status", "next_attempt_at");

ALTER TABLE "ai_mcp_delegation_endpoints"
  ADD CONSTRAINT "ai_mcp_delegation_endpoints_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_delegation_endpoints"
  ADD CONSTRAINT "ai_mcp_delegation_endpoints_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_delegation_requests"
  ADD CONSTRAINT "ai_mcp_delegation_requests_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_delegation_requests"
  ADD CONSTRAINT "ai_mcp_delegation_requests_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_delegation_requests"
  ADD CONSTRAINT "ai_mcp_delegation_requests_credential_id_fkey"
  FOREIGN KEY ("credential_id") REFERENCES "mcp_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_delegation_requests"
  ADD CONSTRAINT "ai_mcp_delegation_requests_agent_run_id_fkey"
  FOREIGN KEY ("agent_run_id") REFERENCES "ai_agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_delegation_callback_deliveries"
  ADD CONSTRAINT "ai_mcp_delegation_callback_deliveries_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "ai_mcp_delegation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
