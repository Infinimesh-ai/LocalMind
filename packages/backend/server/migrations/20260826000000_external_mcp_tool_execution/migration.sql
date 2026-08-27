CREATE TYPE "ExternalMcpToolExecutionStatus" AS ENUM (
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "ai_external_mcp_tool_executions" (
  "id" VARCHAR NOT NULL,
  "connection_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR,
  "tool_name" VARCHAR NOT NULL,
  "risk" VARCHAR NOT NULL,
  "status" "ExternalMcpToolExecutionStatus" NOT NULL DEFAULT 'RUNNING',
  "idempotency_key" VARCHAR NOT NULL,
  "arguments_fingerprint" VARCHAR NOT NULL,
  "result_fingerprint" VARCHAR,
  "encrypted_result" TEXT,
  "error_code" VARCHAR,
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "lease_id" VARCHAR,
  "lease_expires_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_external_mcp_tool_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_external_mcp_tool_executions_identity_check" CHECK (
    length(btrim("tool_name")) BETWEEN 1 AND 256 AND
    length(btrim("idempotency_key")) BETWEEN 1 AND 128 AND
    length(btrim("arguments_fingerprint")) BETWEEN 1 AND 128 AND
    "risk" IN ('read', 'write', 'high') AND
    "attempt_count" BETWEEN 1 AND 3
  ),
  CONSTRAINT "ai_external_mcp_tool_executions_lease_pair_check" CHECK (
    ("lease_id" IS NULL AND "lease_expires_at" IS NULL) OR
    ("lease_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
  ),
  CONSTRAINT "ai_external_mcp_tool_executions_state_check" CHECK (
    (
      "status" = 'RUNNING' AND
      "lease_id" IS NOT NULL AND
      "completed_at" IS NULL AND
      "result_fingerprint" IS NULL AND
      "encrypted_result" IS NULL AND
      "error_code" IS NULL
    ) OR (
      "status" = 'COMPLETED' AND
      "lease_id" IS NULL AND
      "completed_at" IS NOT NULL AND
      "result_fingerprint" IS NOT NULL AND
      "encrypted_result" IS NOT NULL AND
      "error_code" IS NULL
    ) OR (
      "status" IN ('FAILED', 'CANCELLED') AND
      "lease_id" IS NULL AND
      "completed_at" IS NOT NULL AND
      "result_fingerprint" IS NULL AND
      "encrypted_result" IS NULL AND
      "error_code" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "ai_external_mcp_tool_executions_connection_id_idempotency_key_key"
  ON "ai_external_mcp_tool_executions"("connection_id", "idempotency_key");
CREATE UNIQUE INDEX "ai_external_mcp_connections_id_workspace_id_key"
  ON "ai_external_mcp_connections"("id", "workspace_id");
CREATE INDEX "ai_external_mcp_tool_executions_workspace_id_created_at_idx"
  ON "ai_external_mcp_tool_executions"("workspace_id", "created_at");
CREATE INDEX "ai_external_mcp_tool_executions_status_lease_expires_at_idx"
  ON "ai_external_mcp_tool_executions"("status", "lease_expires_at");

ALTER TABLE "ai_external_mcp_tool_executions"
  ADD CONSTRAINT "ai_external_mcp_tool_executions_connection_workspace_fkey"
  FOREIGN KEY ("connection_id", "workspace_id")
  REFERENCES "ai_external_mcp_connections"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "ai_external_mcp_tool_executions"
  ADD CONSTRAINT "ai_external_mcp_tool_executions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_external_mcp_tool_executions"
  ADD CONSTRAINT "ai_external_mcp_tool_executions_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
