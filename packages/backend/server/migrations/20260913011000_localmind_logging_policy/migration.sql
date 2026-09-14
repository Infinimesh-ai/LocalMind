CREATE TABLE "localmind_log_policies" (
  "id" VARCHAR NOT NULL DEFAULT 'default',
  "runtime_retention_days" INTEGER NOT NULL DEFAULT 30,
  "failure_retention_days" INTEGER NOT NULL DEFAULT 90,
  "trace_retention_days" INTEGER NOT NULL DEFAULT 14,
  "audit_retention_days" INTEGER NOT NULL DEFAULT 365,
  "spool_max_bytes" BIGINT NOT NULL DEFAULT 52428800,
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "external_telemetry_enabled" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "localmind_log_policies_pkey" PRIMARY KEY ("id")
);
INSERT INTO "localmind_log_policies" ("id") VALUES ('default') ON CONFLICT DO NOTHING;
