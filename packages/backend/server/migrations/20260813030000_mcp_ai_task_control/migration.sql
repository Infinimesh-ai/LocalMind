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

ALTER TABLE "ai_mcp_delegation_callback_deliveries"
  DROP CONSTRAINT "ai_mcp_delegation_callback_deliveries_shape_check";

ALTER TABLE "ai_mcp_delegation_callback_deliveries"
  ADD CONSTRAINT "ai_mcp_delegation_callback_deliveries_shape_check" CHECK (
    length(btrim("event_type")) BETWEEN 1 AND 128 AND
    "status" IN ('queued', 'processing', 'delivered', 'retry_scheduled', 'failed', 'cancelled') AND
    jsonb_typeof("payload") = 'object' AND
    length(btrim("payload_fingerprint")) BETWEEN 8 AND 128 AND
    "attempt_count" >= 0 AND
    "max_attempts" BETWEEN 1 AND 20 AND
    (("worker_lease_id" IS NULL AND "worker_lease_expires_at" IS NULL) OR ("worker_lease_id" IS NOT NULL AND "worker_lease_expires_at" IS NOT NULL)) AND
    (("last_error_code" IS NULL AND "last_error_message" IS NULL) OR ("last_error_code" IS NOT NULL AND "last_error_message" IS NOT NULL)) AND
    ("status" <> 'cancelled' OR ("worker_lease_id" IS NULL AND "worker_lease_expires_at" IS NULL AND "next_attempt_at" IS NULL))
  );

CREATE TABLE "ai_mcp_delegation_controls" (
  "id" VARCHAR NOT NULL,
  "request_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "actor_id" VARCHAR NOT NULL,
  "credential_family_id" VARCHAR NOT NULL,
  "action" VARCHAR NOT NULL,
  "idempotency_key" VARCHAR NOT NULL,
  "request_fingerprint" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL,
  "outcome" JSONB NOT NULL DEFAULT '{}',
  "outcome_fingerprint" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_mcp_delegation_controls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_mcp_delegation_controls_shape_check" CHECK (
    length(btrim("credential_family_id")) BETWEEN 1 AND 512 AND
    "action" = 'cancel' AND
    length(btrim("idempotency_key")) BETWEEN 1 AND 256 AND
    length(btrim("request_fingerprint")) BETWEEN 8 AND 128 AND
    "status" IN ('processing', 'completed') AND
    jsonb_typeof("outcome") = 'object' AND
    (
      ("status" = 'processing' AND "outcome" = '{}'::jsonb AND "outcome_fingerprint" IS NULL) OR
      (
        "status" = 'completed' AND
        "outcome" <> '{}'::jsonb AND
        length(btrim("outcome_fingerprint")) BETWEEN 8 AND 128
      )
    )
  )
);

CREATE UNIQUE INDEX "ai_mcp_delegation_controls_request_family_idempotency_key"
  ON "ai_mcp_delegation_controls"("request_id", "credential_family_id", "idempotency_key");
CREATE INDEX "ai_mcp_delegation_controls_request_id_created_at_idx"
  ON "ai_mcp_delegation_controls"("request_id", "created_at");
CREATE INDEX "ai_mcp_delegation_controls_workspace_actor_created_at_idx"
  ON "ai_mcp_delegation_controls"("workspace_id", "actor_id", "created_at");

ALTER TABLE "ai_mcp_delegation_controls"
  ADD CONSTRAINT "ai_mcp_delegation_controls_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "ai_mcp_delegation_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION ai_mcp_delegation_control_parent_is_valid()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_mcp_delegation_requests" request
    WHERE request."id" = NEW."request_id"
      AND request."workspace_id" = NEW."workspace_id"
      AND request."actor_id" = NEW."actor_id"
      AND request."credential_family_id" = NEW."credential_family_id"
  ) THEN
    RAISE EXCEPTION 'ai_mcp_delegation_control_parent_is_valid_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_mcp_delegation_control_parent_is_valid_check
  BEFORE INSERT OR UPDATE
  ON "ai_mcp_delegation_controls"
  FOR EACH ROW
  EXECUTE FUNCTION ai_mcp_delegation_control_parent_is_valid();

CREATE OR REPLACE FUNCTION ai_mcp_delegation_control_update_restrict()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."request_id" IS DISTINCT FROM OLD."request_id" OR
     NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" OR
     NEW."actor_id" IS DISTINCT FROM OLD."actor_id" OR
     NEW."credential_family_id" IS DISTINCT FROM OLD."credential_family_id" OR
     NEW."action" IS DISTINCT FROM OLD."action" OR
     NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key" OR
     NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint" OR
     NEW."created_at" IS DISTINCT FROM OLD."created_at" OR
     OLD."status" = 'completed' THEN
    RAISE EXCEPTION 'ai_mcp_delegation_control_update_restrict_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_mcp_delegation_control_update_restrict_check
  BEFORE UPDATE
  ON "ai_mcp_delegation_controls"
  FOR EACH ROW
  EXECUTE FUNCTION ai_mcp_delegation_control_update_restrict();

CREATE OR REPLACE FUNCTION ai_mcp_delegation_cancelled_run_is_valid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" = 'cancelled' AND NOT EXISTS (
    SELECT 1
    FROM "ai_agent_runs" run
    WHERE run."id" = NEW."agent_run_id"
      AND run."workspace_id" = NEW."workspace_id"
      AND run."actor_id" = NEW."actor_id"
      AND run."source_type" = 'mcp_ai_delegation'
      AND run."source_id" = NEW."id"
      AND run."status" = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'ai_mcp_delegation_cancelled_run_is_valid_check';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ai_mcp_delegation_cancelled_run_is_valid_check
  AFTER INSERT OR UPDATE OF "status", "result", "agent_run_id"
  ON "ai_mcp_delegation_requests"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION ai_mcp_delegation_cancelled_run_is_valid();
