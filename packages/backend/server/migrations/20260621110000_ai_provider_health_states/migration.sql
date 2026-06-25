CREATE TABLE "ai_provider_health_states" (
  "id" VARCHAR NOT NULL,
  "provider_id" VARCHAR NOT NULL,
  "provider_type" VARCHAR,
  "scope_type" VARCHAR NOT NULL DEFAULT 'global',
  "workspace_id" VARCHAR,
  "actor_id" VARCHAR,
  "status" VARCHAR NOT NULL,
  "checked_at" TIMESTAMPTZ(3) NOT NULL,
  "last_error" TEXT,
  "source" VARCHAR NOT NULL DEFAULT 'manual_override',
  "fingerprint" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_provider_health_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_health_states_workspace_provider_uidx"
  ON "ai_provider_health_states"("scope_type", "workspace_id", "provider_id")
  WHERE "scope_type" = 'workspace';

CREATE UNIQUE INDEX "ai_provider_health_states_global_provider_uidx"
  ON "ai_provider_health_states"("scope_type", "provider_id")
  WHERE "scope_type" = 'global' AND "workspace_id" IS NULL;

CREATE INDEX "ai_provider_health_states_scope_checked_at_idx"
  ON "ai_provider_health_states"("provider_id", "scope_type", "workspace_id", "checked_at");

CREATE INDEX "ai_provider_health_states_workspace_id_checked_at_idx"
  ON "ai_provider_health_states"("workspace_id", "checked_at");

CREATE INDEX "ai_provider_health_states_actor_id_checked_at_idx"
  ON "ai_provider_health_states"("actor_id", "checked_at");

CREATE INDEX "ai_provider_health_states_status_checked_at_idx"
  ON "ai_provider_health_states"("status", "checked_at");

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_provider_health_states"
  ADD CONSTRAINT "ai_provider_health_states_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
