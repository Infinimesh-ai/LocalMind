ALTER TABLE "mcp_credentials"
  DROP CONSTRAINT "mcp_credentials_capabilities_check";

ALTER TABLE "mcp_credentials"
  ADD CONSTRAINT "mcp_credentials_capabilities_check"
  CHECK (
    cardinality("capabilities") > 0
    AND "capabilities" <@ ARRAY[
      'upload_localmind_attachment',
      'delegate_to_localmind',
      'get_localmind_task',
      'control_localmind_task'
    ]::TEXT[]
    AND (
      (
        "access_mode" = 'READ_WRITE'
        AND "capabilities" && ARRAY[
          'upload_localmind_attachment',
          'delegate_to_localmind',
          'control_localmind_task'
        ]::TEXT[]
      )
      OR (
        "access_mode" = 'READ_ONLY'
        AND NOT (
          "capabilities" && ARRAY[
            'upload_localmind_attachment',
            'delegate_to_localmind',
            'control_localmind_task'
          ]::TEXT[]
        )
      )
    )
  );

CREATE TABLE "ai_mcp_attachments" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR NOT NULL,
  "credential_id" VARCHAR NOT NULL,
  "credential_family_id" VARCHAR NOT NULL,
  "credential_generation" INTEGER NOT NULL,
  "idempotency_key" VARCHAR NOT NULL,
  "file_name" VARCHAR NOT NULL,
  "mime_type" VARCHAR NOT NULL,
  "blob_key" VARCHAR NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "content_fingerprint" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_mcp_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_mcp_attachments_shape_check" CHECK (
    length(btrim("credential_family_id")) BETWEEN 1 AND 512 AND
    "credential_generation" >= 0 AND
    length(btrim("idempotency_key")) BETWEEN 1 AND 256 AND
    length(btrim("file_name")) BETWEEN 1 AND 512 AND
    length(btrim("mime_type")) BETWEEN 1 AND 256 AND
    length(btrim("blob_key")) BETWEEN 8 AND 1024 AND
    "byte_size" BETWEEN 1 AND 10485760 AND
    length(btrim("content_fingerprint")) BETWEEN 8 AND 128
  )
);

CREATE UNIQUE INDEX "ai_mcp_attachments_workspace_family_idempotency_key"
  ON "ai_mcp_attachments"("workspace_id", "credential_family_id", "idempotency_key");
CREATE INDEX "ai_mcp_attachments_workspace_actor_created_at_idx"
  ON "ai_mcp_attachments"("workspace_id", "actor_id", "created_at");
CREATE INDEX "ai_mcp_attachments_credential_family_created_at_idx"
  ON "ai_mcp_attachments"("credential_family_id", "created_at");

ALTER TABLE "ai_mcp_attachments"
  ADD CONSTRAINT "ai_mcp_attachments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_attachments"
  ADD CONSTRAINT "ai_mcp_attachments_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_mcp_attachments"
  ADD CONSTRAINT "ai_mcp_attachments_credential_id_fkey"
  FOREIGN KEY ("credential_id") REFERENCES "mcp_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ai_mcp_attachment_update_restrict()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ai_mcp_attachment_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_mcp_attachment_update_restrict_check
  BEFORE UPDATE ON "ai_mcp_attachments"
  FOR EACH ROW
  EXECUTE FUNCTION ai_mcp_attachment_update_restrict();

ALTER TABLE "ai_mcp_delegation_requests"
  ADD COLUMN "requested_attachment_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ai_mcp_delegation_requests"
  DROP CONSTRAINT "ai_mcp_delegation_requests_shape_check";

ALTER TABLE "ai_mcp_delegation_requests"
  ADD CONSTRAINT "ai_mcp_delegation_requests_shape_check" CHECK (
    length(btrim("credential_family_id")) BETWEEN 1 AND 512 AND
    "credential_generation" >= 0 AND
    cardinality("capability_snapshot") > 0 AND
    length(btrim("capability_fingerprint")) BETWEEN 8 AND 128 AND
    length(btrim("idempotency_key")) BETWEEN 1 AND 256 AND
    length(btrim("request_text")) BETWEEN 1 AND 12000 AND
    cardinality("requested_document_ids") <= 20 AND
    cardinality("requested_attachment_ids") <= 8 AND
    length(btrim("request_fingerprint")) BETWEEN 8 AND 128 AND
    ("context_fingerprint" IS NULL OR length(btrim("context_fingerprint")) BETWEEN 8 AND 128) AND
    "status" IN ('processing', 'completed', 'waiting_approval', 'unsupported_task', 'credential_scope_denied', 'permission_denied', 'resource_not_accessible', 'failed', 'rejected', 'cancelled') AND
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
    ) AND
    (
      "status" <> 'cancelled' OR
      (
        "agent_run_id" IS NOT NULL AND
        COALESCE("result"->>'code', '') = 'task_cancelled' AND
        COALESCE("result"->>'agentRunId', '') = "agent_run_id"
      )
    )
  );
