-- Report decks are owned by one user and are not attached to a project or
-- workspace: their sources may span several scopes. Generated HTML is stored
-- gzip-compressed in the row; sharing uses hashed link tokens.

-- CreateTable
CREATE TABLE "report_decks" (
    "id" VARCHAR NOT NULL,
    "owner_user_id" VARCHAR NOT NULL,
    "request_key" VARCHAR(128),
    "title" VARCHAR(512) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "mode" VARCHAR(16) NOT NULL,
    "template_key" VARCHAR(64),
    "config" JSONB NOT NULL,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "html_gzip" BYTEA,
    "html_bytes" INTEGER,
    "slide_count" INTEGER,
    "error_code" VARCHAR(64),
    "ai_scope_kind" VARCHAR(16) NOT NULL,
    "ai_scope_id" VARCHAR NOT NULL,
    "model_id" VARCHAR,
    "usage" JSONB,
    "run_attempt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "report_decks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_deck_sources" (
    "id" VARCHAR NOT NULL,
    "deck_id" VARCHAR NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "scope_kind" VARCHAR(16) NOT NULL,
    "scope_id" VARCHAR NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "resource_id" VARCHAR,
    "title_snapshot" VARCHAR(512) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "reason" VARCHAR(64),
    "chars" INTEGER,

    CONSTRAINT "report_deck_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_deck_shares" (
    "id" VARCHAR NOT NULL,
    "deck_id" VARCHAR NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "token_ciphertext" TEXT NOT NULL,
    "password_hash" VARCHAR,
    "allow_download" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_deck_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_decks_owner_user_id_request_key_key" ON "report_decks"("owner_user_id", "request_key");

-- CreateIndex
CREATE INDEX "report_decks_owner_user_id_deleted_at_created_at_idx" ON "report_decks"("owner_user_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "report_deck_sources_deck_id_idx" ON "report_deck_sources"("deck_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_deck_shares_token_hash_key" ON "report_deck_shares"("token_hash");

-- CreateIndex
CREATE INDEX "report_deck_shares_deck_id_idx" ON "report_deck_shares"("deck_id");

-- AddForeignKey
ALTER TABLE "report_deck_sources" ADD CONSTRAINT "report_deck_sources_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "report_decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deck_shares" ADD CONSTRAINT "report_deck_shares_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "report_decks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
