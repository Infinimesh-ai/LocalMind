-- CreateTable
CREATE TABLE "ai_support_bundle_requests" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "source_evidence_summary" JSONB NOT NULL DEFAULT '{}',
    "source_evidence_set_fingerprint" VARCHAR NOT NULL,
    "manifest_fingerprint" VARCHAR NOT NULL,
    "manifest_json" JSONB NOT NULL,
    "retention_status" VARCHAR NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "failure_code" VARCHAR,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_support_bundle_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_support_bundle_requests_status_check" CHECK ("status" IN ('pending', 'ready', 'failed', 'expired')),
    CONSTRAINT "ai_support_bundle_requests_retention_status_check" CHECK ("retention_status" IN ('active', 'expired', 'deleted'))
);

-- CreateTable
CREATE TABLE "ai_support_bundle_audit_events" (
    "id" VARCHAR NOT NULL,
    "bundle_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "event_type" VARCHAR NOT NULL,
    "event_fingerprint" VARCHAR NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_support_bundle_audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_support_bundle_audit_events_type_check" CHECK ("event_type" IN ('created', 'read'))
);

-- CreateIndex
CREATE INDEX "ai_support_bundle_requests_workspace_id_created_at_idx" ON "ai_support_bundle_requests"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_requests_actor_id_created_at_idx" ON "ai_support_bundle_requests"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_requests_status_created_at_idx" ON "ai_support_bundle_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_requests_retention_status_expires_at_idx" ON "ai_support_bundle_requests"("retention_status", "expires_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_audit_events_bundle_id_created_at_idx" ON "ai_support_bundle_audit_events"("bundle_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_audit_events_workspace_id_created_at_idx" ON "ai_support_bundle_audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_audit_events_actor_id_created_at_idx" ON "ai_support_bundle_audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_support_bundle_audit_events_event_type_created_at_idx" ON "ai_support_bundle_audit_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "ai_support_bundle_requests" ADD CONSTRAINT "ai_support_bundle_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_support_bundle_requests" ADD CONSTRAINT "ai_support_bundle_requests_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_support_bundle_audit_events" ADD CONSTRAINT "ai_support_bundle_audit_events_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "ai_support_bundle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_support_bundle_audit_events" ADD CONSTRAINT "ai_support_bundle_audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_support_bundle_audit_events" ADD CONSTRAINT "ai_support_bundle_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
