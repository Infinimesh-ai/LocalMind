CREATE TABLE "workspace_files" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "created_by" VARCHAR NOT NULL,
  "source_session_id" VARCHAR NOT NULL,
  "file_name" VARCHAR(512) NOT NULL,
  "mime_type" VARCHAR(256) NOT NULL,
  "byte_size" INTEGER NOT NULL CHECK ("byte_size" >= 0 AND "byte_size" <= 4194304),
  "blob_key" VARCHAR NOT NULL,
  "fingerprint" VARCHAR(128) NOT NULL,
  "request_key" VARCHAR(256) NOT NULL,
  "request_fingerprint" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workspace_files_workspace_id_blob_key_fkey" FOREIGN KEY ("workspace_id", "blob_key") REFERENCES "blobs"("workspace_id", "key") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "workspace_files_workspace_id_request_key_key" ON "workspace_files"("workspace_id", "request_key");
CREATE INDEX "workspace_files_workspace_id_created_at_idx" ON "workspace_files"("workspace_id", "created_at" DESC);
