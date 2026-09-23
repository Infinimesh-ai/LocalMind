BEGIN;

-- CreateTable
CREATE TABLE "office_comments" (
    "id" VARCHAR NOT NULL,
    "workspace_id" VARCHAR,
    "project_id" VARCHAR,
    "artifact_id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "content" JSONB NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "office_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_comment_replies" (
    "id" VARCHAR NOT NULL,
    "comment_id" VARCHAR NOT NULL,
    "user_id" VARCHAR NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "office_comment_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "office_comments_workspace_id_artifact_id_created_at_idx" ON "office_comments"("workspace_id", "artifact_id", "created_at");

-- CreateIndex
CREATE INDEX "office_comments_project_id_artifact_id_created_at_idx" ON "office_comments"("project_id", "artifact_id", "created_at");

-- CreateIndex
CREATE INDEX "office_comment_replies_comment_id_created_at_idx" ON "office_comment_replies"("comment_id", "created_at");

-- AddForeignKey
ALTER TABLE "office_comments" ADD CONSTRAINT "office_comments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_comments" ADD CONSTRAINT "office_comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_comments" ADD CONSTRAINT "office_comments_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "office_artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_comments" ADD CONSTRAINT "office_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_comment_replies" ADD CONSTRAINT "office_comment_replies_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "office_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_comment_replies" ADD CONSTRAINT "office_comment_replies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Each comment belongs to exactly one real artifact owner. Replies inherit that
-- owner through their parent FK rather than duplicating mutable scope columns.
ALTER TABLE office_comments ADD CONSTRAINT office_comments_one_owner
  CHECK (num_nonnulls(workspace_id, project_id) = 1);
ALTER TABLE office_comments ADD CONSTRAINT office_comments_workspace_artifact_fk
  FOREIGN KEY (artifact_id, workspace_id) REFERENCES office_artifacts(id, workspace_id) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE office_comments ADD CONSTRAINT office_comments_project_artifact_fk
  FOREIGN KEY (artifact_id, project_id) REFERENCES office_artifacts(id, project_id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- Move only native Office threads, retaining public IDs, content, resolution,
-- authors, deletion markers and timestamps. Ordinary BlockSuite threads stay put.
INSERT INTO office_comments (id, workspace_id, artifact_id, user_id, content, resolved, created_at, updated_at, deleted_at)
SELECT c.id, c.workspace_id, c.doc_id, c.user_id, c.content, c.resolved, c.created_at, c.updated_at, c.deleted_at
FROM comments c JOIN office_artifacts a ON a.id = c.doc_id AND a.workspace_id = c.workspace_id
WHERE c.content->>'version' = 'localmind-office-comment/v1';
INSERT INTO office_comment_replies (id, comment_id, user_id, content, created_at, updated_at, deleted_at)
SELECT r.id, r.comment_id, r.user_id, r.content, r.created_at, r.updated_at, r.deleted_at
FROM replies r JOIN office_comments c ON c.id = r.comment_id;
-- The parent delete cascades old replies only after both copies are durable in
-- this migration transaction; there is one writable source after cutover.
DELETE FROM comments WHERE id IN (SELECT id FROM office_comments);

COMMIT;
