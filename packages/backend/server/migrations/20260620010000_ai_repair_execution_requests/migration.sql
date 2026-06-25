-- CreateTable
CREATE TABLE "ai_repair_execution_requests" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "prompt_name" VARCHAR NOT NULL,
    "requested_action" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "approval_state" VARCHAR NOT NULL,
    "permission_status" VARCHAR NOT NULL,
    "idempotency_key" VARCHAR NOT NULL,
    "idempotency_fingerprint" VARCHAR NOT NULL,
    "request_fingerprint" VARCHAR NOT NULL,
    "candidate_evidence_set_fingerprint" VARCHAR NOT NULL,
    "task_route_evidence_set_fingerprint" VARCHAR NOT NULL,
    "target_locator_fingerprint" VARCHAR NOT NULL,
    "repair_job_fingerprint" VARCHAR NOT NULL,
    "approval_record_fingerprint" VARCHAR NOT NULL,
    "audit_event_fingerprint" VARCHAR NOT NULL,
    "runtime_result" JSONB NOT NULL DEFAULT '{}',
    "failure_code" VARCHAR,
    "failure_message" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_repair_execution_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_repair_execution_requests_status_check" CHECK ("status" IN ('queued', 'waiting_approval', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT "ai_repair_execution_requests_approval_state_check" CHECK ("approval_state" IN ('not_required', 'waiting', 'approved', 'rejected'))
);

-- CreateTable
CREATE TABLE "ai_repair_execution_audit_events" (
    "id" VARCHAR NOT NULL,
    "execution_request_id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR NOT NULL,
    "actor_id" VARCHAR NOT NULL,
    "event_type" VARCHAR NOT NULL,
    "event_fingerprint" VARCHAR NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_repair_execution_audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_repair_execution_audit_events_type_check" CHECK ("event_type" IN ('requested', 'queued', 'waiting_approval', 'running', 'completed', 'failed', 'reused'))
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_repair_execution_requests_workspace_id_idempotency_key_key" ON "ai_repair_execution_requests"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "ai_repair_execution_requests_workspace_id_created_at_idx" ON "ai_repair_execution_requests"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_repair_execution_requests_actor_id_created_at_idx" ON "ai_repair_execution_requests"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_repair_execution_requests_status_created_at_idx" ON "ai_repair_execution_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_repair_execution_requests_approval_state_created_at_idx" ON "ai_repair_execution_requests"("approval_state", "created_at");

-- CreateIndex
CREATE INDEX "ai_repair_execution_audit_events_execution_request_id_created_at_idx" ON "ai_repair_execution_audit_events"("execution_request_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_repair_execution_audit_events_workspace_id_created_at_idx" ON "ai_repair_execution_audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_repair_execution_audit_events_actor_id_created_at_idx" ON "ai_repair_execution_audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_repair_execution_audit_events_event_type_created_at_idx" ON "ai_repair_execution_audit_events"("event_type", "created_at");

-- AddForeignKey
ALTER TABLE "ai_repair_execution_requests" ADD CONSTRAINT "ai_repair_execution_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_repair_execution_requests" ADD CONSTRAINT "ai_repair_execution_requests_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_repair_execution_audit_events" ADD CONSTRAINT "ai_repair_execution_audit_events_execution_request_id_fkey" FOREIGN KEY ("execution_request_id") REFERENCES "ai_repair_execution_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_repair_execution_audit_events" ADD CONSTRAINT "ai_repair_execution_audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_repair_execution_audit_events" ADD CONSTRAINT "ai_repair_execution_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
