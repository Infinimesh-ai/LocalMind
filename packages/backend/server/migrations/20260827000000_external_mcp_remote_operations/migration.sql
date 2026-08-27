ALTER TABLE "ai_external_mcp_tool_executions"
  DROP CONSTRAINT "ai_external_mcp_tool_executions_identity_check",
  DROP CONSTRAINT "ai_external_mcp_tool_executions_state_check",
  ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "ExternalMcpToolExecutionStatus_new" AS ENUM (
  'RUNNING',
  'PENDING',
  'APPROVAL_REQUIRED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

ALTER TABLE "ai_external_mcp_tool_executions"
  ALTER COLUMN "status" TYPE "ExternalMcpToolExecutionStatus_new"
  USING ("status"::text::"ExternalMcpToolExecutionStatus_new");

DROP TYPE "ExternalMcpToolExecutionStatus";
ALTER TYPE "ExternalMcpToolExecutionStatus_new"
  RENAME TO "ExternalMcpToolExecutionStatus";

ALTER TABLE "ai_external_mcp_tool_executions"
  ALTER COLUMN "status" SET DEFAULT 'RUNNING';

ALTER TABLE "ai_external_mcp_tool_executions"
  ADD COLUMN "remote_operation_id" VARCHAR,
  ADD COLUMN "remote_state" VARCHAR,
  ADD COLUMN "remote_deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "next_poll_at" TIMESTAMPTZ(3),
  ADD COLUMN "poll_attempt_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ai_external_mcp_tool_executions"
  ADD CONSTRAINT "ai_external_mcp_tool_executions_identity_check" CHECK (
    length(btrim("tool_name")) BETWEEN 1 AND 256 AND
    length(btrim("idempotency_key")) BETWEEN 1 AND 128 AND
    length(btrim("arguments_fingerprint")) BETWEEN 1 AND 128 AND
    "risk" IN ('read', 'write', 'high') AND
    "attempt_count" BETWEEN 1 AND 3 AND
    "poll_attempt_count" BETWEEN 0 AND 20 AND
    ("remote_operation_id" IS NULL OR length(btrim("remote_operation_id")) BETWEEN 1 AND 256) AND
    ("remote_state" IS NULL OR "remote_state" IN (
      'running',
      'approval_required',
      'succeeded',
      'failed',
      'cancelled',
      'revoked'
    ))
  ),
  ADD CONSTRAINT "ai_external_mcp_tool_executions_state_check" CHECK (
    (
      "status" = 'RUNNING' AND
      "lease_id" IS NOT NULL AND
      "completed_at" IS NULL AND
      "result_fingerprint" IS NULL AND
      "encrypted_result" IS NULL AND
      "error_code" IS NULL AND
      "next_poll_at" IS NULL
    ) OR (
      "status" IN ('PENDING', 'APPROVAL_REQUIRED') AND
      "lease_id" IS NULL AND
      "completed_at" IS NULL AND
      "result_fingerprint" IS NULL AND
      "encrypted_result" IS NULL AND
      "error_code" IS NULL AND
      "remote_operation_id" IS NOT NULL AND
      "remote_state" = CASE
        WHEN "status" = 'PENDING' THEN 'running'
        ELSE 'approval_required'
      END AND
      "next_poll_at" IS NOT NULL
    ) OR (
      "status" = 'COMPLETED' AND
      "lease_id" IS NULL AND
      "completed_at" IS NOT NULL AND
      "result_fingerprint" IS NOT NULL AND
      "encrypted_result" IS NOT NULL AND
      "error_code" IS NULL AND
      "next_poll_at" IS NULL
    ) OR (
      "status" IN ('FAILED', 'CANCELLED') AND
      "lease_id" IS NULL AND
      "completed_at" IS NOT NULL AND
      "result_fingerprint" IS NULL AND
      "encrypted_result" IS NULL AND
      "error_code" IS NOT NULL AND
      "next_poll_at" IS NULL
    )
  );

CREATE INDEX "ai_external_mcp_tool_executions_status_next_poll_at_idx"
  ON "ai_external_mcp_tool_executions"("status", "next_poll_at");
