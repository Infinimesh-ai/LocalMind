CREATE TYPE "EnterpriseProvider" AS ENUM ('WECOM', 'LARK', 'DINGTALK');
CREATE TYPE "EnterpriseConnectionTransport" AS ENUM ('CLI', 'MCP');
CREATE TYPE "EnterpriseConnectionStatus" AS ENUM (
  'CONNECTING',
  'ACTIVE',
  'DEGRADED',
  'REAUTH_REQUIRED',
  'DISABLED'
);

CREATE TABLE "ai_enterprise_connections" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "user_id" VARCHAR NOT NULL,
  "provider" "EnterpriseProvider" NOT NULL,
  "transport" "EnterpriseConnectionTransport" NOT NULL DEFAULT 'CLI',
  "name" VARCHAR NOT NULL,
  "profile_key" VARCHAR NOT NULL,
  "status" "EnterpriseConnectionStatus" NOT NULL DEFAULT 'CONNECTING',
  "external_tenant_id" VARCHAR,
  "external_user_id" VARCHAR,
  "identity_type" VARCHAR,
  "tool_catalog" JSONB NOT NULL DEFAULT '[]',
  "tool_catalog_fingerprint" VARCHAR,
  "enabled_tool_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expires_at" TIMESTAMPTZ(3),
  "last_connected_at" TIMESTAMPTZ(3),
  "last_checked_at" TIMESTAMPTZ(3),
  "last_used_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR,
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_enterprise_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_enterprise_audit_events" (
  "id" VARCHAR NOT NULL,
  "connection_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR,
  "event_type" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "tool_name" VARCHAR,
  "risk" VARCHAR,
  "idempotency_key" VARCHAR,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_enterprise_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_enterprise_connections_workspace_id_user_id_provider_profile_key_key"
  ON "ai_enterprise_connections"("workspace_id", "user_id", "provider", "profile_key");
CREATE INDEX "ai_enterprise_connections_workspace_id_user_id_status_idx"
  ON "ai_enterprise_connections"("workspace_id", "user_id", "status");
CREATE INDEX "ai_enterprise_connections_provider_status_updated_at_idx"
  ON "ai_enterprise_connections"("provider", "status", "updated_at");
CREATE INDEX "ai_enterprise_audit_events_connection_id_created_at_idx"
  ON "ai_enterprise_audit_events"("connection_id", "created_at");
CREATE INDEX "ai_enterprise_audit_events_workspace_id_actor_id_created_at_idx"
  ON "ai_enterprise_audit_events"("workspace_id", "actor_id", "created_at");
CREATE INDEX "ai_enterprise_audit_events_idempotency_key_idx"
  ON "ai_enterprise_audit_events"("idempotency_key");

ALTER TABLE "ai_enterprise_connections"
  ADD CONSTRAINT "ai_enterprise_connections_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_enterprise_connections"
  ADD CONSTRAINT "ai_enterprise_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_enterprise_audit_events"
  ADD CONSTRAINT "ai_enterprise_audit_events_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "ai_enterprise_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_enterprise_audit_events"
  ADD CONSTRAINT "ai_enterprise_audit_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_enterprise_audit_events"
  ADD CONSTRAINT "ai_enterprise_audit_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
