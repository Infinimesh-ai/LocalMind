CREATE TYPE "ExternalMcpConnectionStatus" AS ENUM (
  'CONNECTING',
  'ACTIVE',
  'DEGRADED',
  'REAUTH_REQUIRED',
  'DISABLED'
);

CREATE TABLE "ai_external_mcp_connections" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "created_by" VARCHAR,
  "name" VARCHAR NOT NULL DEFAULT 'SparkClaw MCP',
  "endpoint" TEXT NOT NULL,
  "protocol_version" VARCHAR NOT NULL DEFAULT '2025-06-18',
  "status" "ExternalMcpConnectionStatus" NOT NULL DEFAULT 'CONNECTING',
  "encrypted_session_id" TEXT,
  "session_fingerprint" VARCHAR,
  "server_name" VARCHAR,
  "server_version" VARCHAR,
  "tool_catalog" JSONB NOT NULL DEFAULT '[]',
  "tool_catalog_fingerprint" VARCHAR,
  "enabled_tool_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_connected_at" TIMESTAMPTZ(3),
  "last_checked_at" TIMESTAMPTZ(3),
  "last_used_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR,
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),

  CONSTRAINT "ai_external_mcp_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_external_mcp_connections_session_pair_check" CHECK (
    ("encrypted_session_id" IS NULL AND "session_fingerprint" IS NULL) OR
    ("encrypted_session_id" IS NOT NULL AND "session_fingerprint" IS NOT NULL)
  ),
  CONSTRAINT "ai_external_mcp_connections_catalog_check" CHECK (
    jsonb_typeof("tool_catalog") = 'array' AND
    ("tool_catalog_fingerprint" IS NULL OR length(btrim("tool_catalog_fingerprint")) > 0)
  ),
  CONSTRAINT "ai_external_mcp_connections_identity_check" CHECK (
    length(btrim("name")) BETWEEN 1 AND 128 AND
    length(btrim("endpoint")) BETWEEN 1 AND 2048 AND
    length(btrim("protocol_version")) BETWEEN 1 AND 32
  ),
  CONSTRAINT "ai_external_mcp_connections_error_pair_check" CHECK (
    ("last_error_code" IS NULL AND "last_error_message" IS NULL) OR
    ("last_error_code" IS NOT NULL AND "last_error_message" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ai_external_mcp_connections_workspace_id_key"
  ON "ai_external_mcp_connections"("workspace_id");
CREATE INDEX "ai_external_mcp_connections_status_updated_at_idx"
  ON "ai_external_mcp_connections"("status", "updated_at");

CREATE TABLE "ai_external_mcp_audit_events" (
  "id" VARCHAR NOT NULL,
  "connection_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR,
  "event_type" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_external_mcp_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_external_mcp_audit_events_shape_check" CHECK (
    length(btrim("event_type")) BETWEEN 1 AND 64 AND
    length(btrim("status")) BETWEEN 1 AND 32 AND
    jsonb_typeof("metadata") = 'object'
  )
);

CREATE INDEX "ai_external_mcp_audit_events_connection_id_created_at_idx"
  ON "ai_external_mcp_audit_events"("connection_id", "created_at");
CREATE INDEX "ai_external_mcp_audit_events_workspace_id_created_at_idx"
  ON "ai_external_mcp_audit_events"("workspace_id", "created_at");

ALTER TABLE "ai_external_mcp_connections"
  ADD CONSTRAINT "ai_external_mcp_connections_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_external_mcp_connections"
  ADD CONSTRAINT "ai_external_mcp_connections_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_external_mcp_audit_events"
  ADD CONSTRAINT "ai_external_mcp_audit_events_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "ai_external_mcp_connections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_external_mcp_audit_events"
  ADD CONSTRAINT "ai_external_mcp_audit_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_external_mcp_audit_events"
  ADD CONSTRAINT "ai_external_mcp_audit_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
