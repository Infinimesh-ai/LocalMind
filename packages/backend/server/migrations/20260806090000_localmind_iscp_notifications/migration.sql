CREATE TABLE "iscp_agent_endpoints" (
    "id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "device_id" VARCHAR NOT NULL,
    "domain_id" VARCHAR NOT NULL,
    "identity" JSONB NOT NULL,
    "thumbprint" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'active',
    "spark_session_id" VARCHAR,
    "last_seen_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "iscp_agent_endpoints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "iscp_agent_endpoints_status_check" CHECK ("status" IN ('active', 'offline', 'revoked'))
);

CREATE TABLE "iscp_enrollments" (
    "id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "pairing_token_hash" VARCHAR NOT NULL,
    "device_id" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "request" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "bundle_downloaded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "iscp_enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "iscp_enrollments_status_check" CHECK ("status" IN ('pending', 'enrolled', 'expired', 'revoked'))
);

CREATE TABLE "notification_deliveries" (
    "id" VARCHAR NOT NULL,
    "notification_id" VARCHAR NOT NULL,
    "endpoint_id" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_by" VARCHAR,
    "locked_until" TIMESTAMPTZ(3),
    "operation_id" VARCHAR,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('pending', 'processing', 'retrying', 'delivered', 'failed', 'skipped')),
    CONSTRAINT "notification_deliveries_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" > 0)
);

CREATE UNIQUE INDEX "iscp_agent_endpoints_device_id_key" ON "iscp_agent_endpoints"("device_id");
CREATE INDEX "iscp_agent_endpoints_user_id_status_idx" ON "iscp_agent_endpoints"("user_id", "status");
CREATE UNIQUE INDEX "iscp_enrollments_pairing_token_hash_key" ON "iscp_enrollments"("pairing_token_hash");
CREATE UNIQUE INDEX "iscp_enrollments_device_id_key" ON "iscp_enrollments"("device_id");
CREATE INDEX "iscp_enrollments_user_id_status_idx" ON "iscp_enrollments"("user_id", "status");
CREATE INDEX "iscp_enrollments_expires_at_idx" ON "iscp_enrollments"("expires_at");
CREATE UNIQUE INDEX "notification_deliveries_notification_id_endpoint_id_key" ON "notification_deliveries"("notification_id", "endpoint_id");
CREATE INDEX "notification_deliveries_status_next_attempt_at_locked_until_idx" ON "notification_deliveries"("status", "next_attempt_at", "locked_until");
CREATE INDEX "notification_deliveries_endpoint_id_status_idx" ON "notification_deliveries"("endpoint_id", "status");

ALTER TABLE "iscp_agent_endpoints" ADD CONSTRAINT "iscp_agent_endpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "iscp_enrollments" ADD CONSTRAINT "iscp_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "iscp_agent_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
