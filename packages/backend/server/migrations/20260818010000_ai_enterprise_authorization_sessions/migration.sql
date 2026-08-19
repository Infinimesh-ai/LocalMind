CREATE TYPE "EnterpriseAuthorizationStatus" AS ENUM (
  'PENDING',
  'STARTING',
  'WAITING',
  'AUTHORIZED',
  'FAILED',
  'EXPIRED',
  'CANCELLED'
);

ALTER TABLE "ai_enterprise_connections"
  ADD COLUMN "active_authorization_session_id" VARCHAR;
CREATE INDEX "ai_enterprise_connections_active_authorization_session_id_idx"
  ON "ai_enterprise_connections"("active_authorization_session_id");

CREATE TABLE "ai_enterprise_authorization_sessions" (
  "id" VARCHAR NOT NULL,
  "connection_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "user_id" VARCHAR NOT NULL,
  "provider" "EnterpriseProvider" NOT NULL,
  "status" "EnterpriseAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
  "authorization_url" TEXT,
  "user_code" VARCHAR,
  "qr_code_path" VARCHAR,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "last_error_code" VARCHAR,
  "last_error_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_enterprise_authorization_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_enterprise_authorization_sessions_connection_id_created_at_idx"
  ON "ai_enterprise_authorization_sessions"("connection_id", "created_at");
CREATE INDEX "ai_enterprise_authorization_sessions_workspace_id_user_id_status_idx"
  ON "ai_enterprise_authorization_sessions"("workspace_id", "user_id", "status");
CREATE INDEX "ai_enterprise_authorization_sessions_status_expires_at_idx"
  ON "ai_enterprise_authorization_sessions"("status", "expires_at");
CREATE UNIQUE INDEX "ai_enterprise_authorization_sessions_one_active_per_connection"
  ON "ai_enterprise_authorization_sessions"("connection_id")
  WHERE "status" IN ('PENDING', 'STARTING', 'WAITING');

ALTER TABLE "ai_enterprise_authorization_sessions"
  ADD CONSTRAINT "ai_enterprise_authorization_sessions_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "ai_enterprise_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_enterprise_authorization_sessions"
  ADD CONSTRAINT "ai_enterprise_authorization_sessions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_enterprise_authorization_sessions"
  ADD CONSTRAINT "ai_enterprise_authorization_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
