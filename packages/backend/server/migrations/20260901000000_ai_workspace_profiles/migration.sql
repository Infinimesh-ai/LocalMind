ALTER TABLE "ai_workspace_byok_configs"
  ADD CONSTRAINT "ai_workspace_byok_configs_id_workspace_id_key"
  UNIQUE ("id", "workspace_id");

CREATE TABLE "ai_workspace_profiles" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_by" VARCHAR,
  "updated_by" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ai_workspace_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_workspace_profile_credentials" (
  "profile_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "byok_config_id" VARCHAR NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_workspace_profile_credentials_pkey"
    PRIMARY KEY ("profile_id", "byok_config_id")
);

CREATE TABLE "ai_user_ai_profile_assignments" (
  "user_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "profile_id" VARCHAR NOT NULL,
  "created_by" VARCHAR,
  "updated_by" VARCHAR,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ai_user_ai_profile_assignments_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "ai_workspace_profiles_id_workspace_id_key"
  ON "ai_workspace_profiles"("id", "workspace_id");

CREATE UNIQUE INDEX "ai_workspace_profiles_workspace_id_name_key"
  ON "ai_workspace_profiles"("workspace_id", "name");

CREATE UNIQUE INDEX "ai_workspace_profiles_one_default_per_workspace_key"
  ON "ai_workspace_profiles"("workspace_id")
  WHERE "is_default" = true;

CREATE INDEX "ai_workspace_profiles_workspace_id_enabled_is_default_idx"
  ON "ai_workspace_profiles"("workspace_id", "enabled", "is_default");

CREATE INDEX "ai_workspace_profile_credentials_workspace_id_byok_config_idx"
  ON "ai_workspace_profile_credentials"("workspace_id", "byok_config_id");

CREATE INDEX "ai_user_ai_profile_assignments_workspace_id_profile_id_idx"
  ON "ai_user_ai_profile_assignments"("workspace_id", "profile_id");

ALTER TABLE "ai_workspace_profiles"
  ADD CONSTRAINT "ai_workspace_profiles_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_workspace_profile_credentials"
  ADD CONSTRAINT "ai_workspace_profile_credentials_profile_workspace_fkey"
  FOREIGN KEY ("profile_id", "workspace_id")
  REFERENCES "ai_workspace_profiles"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_workspace_profile_credentials"
  ADD CONSTRAINT "ai_workspace_profile_credentials_byok_workspace_fkey"
  FOREIGN KEY ("byok_config_id", "workspace_id")
  REFERENCES "ai_workspace_byok_configs"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_user_ai_profile_assignments"
  ADD CONSTRAINT "ai_user_ai_profile_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_user_ai_profile_assignments"
  ADD CONSTRAINT "ai_user_ai_profile_assignments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_user_ai_profile_assignments"
  ADD CONSTRAINT "ai_user_ai_profile_assignments_profile_workspace_fkey"
  FOREIGN KEY ("profile_id", "workspace_id")
  REFERENCES "ai_workspace_profiles"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
