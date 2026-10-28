CREATE TABLE "ai_workspace_embedding_tasks" (
  "workspace_id" VARCHAR NOT NULL,
  "kind" VARCHAR(16) NOT NULL CHECK ("kind" IN ('doc', 'file')),
  "resource_id" VARCHAR NOT NULL,
  "request_id" UUID NOT NULL,
  "run_id" UUID,
  "user_id" VARCHAR,
  "status" VARCHAR(16) NOT NULL CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed')),
  "error_code" VARCHAR(64),
  "lease_until" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("workspace_id", "kind", "resource_id"),
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_workspace_embedding_tasks_workspace_id_status_idx"
  ON "ai_workspace_embedding_tasks"("workspace_id", "status");
-- Historical file rows do not record the uploader needed to locate the private blob.
-- Preserve the resource and expose a recoverable UI state, never invent its owner.
INSERT INTO "ai_workspace_embedding_tasks"
  ("workspace_id", "kind", "resource_id", "request_id", "status", "error_code", "lease_until")
SELECT f."workspace_id", 'file', f."file_id", gen_random_uuid(), 'failed', 'source_owner_missing', CURRENT_TIMESTAMP
FROM "ai_workspace_files" f
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_workspace_file_embeddings" e
  WHERE e."workspace_id" = f."workspace_id" AND e."file_id" = f."file_id" AND e."embedding" IS NOT NULL
);
