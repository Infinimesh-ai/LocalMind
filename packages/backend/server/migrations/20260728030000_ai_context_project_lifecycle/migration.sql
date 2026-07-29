ALTER TABLE "ai_context_projects"
  DROP CONSTRAINT "ai_context_projects_created_by_user_id_fkey";

ALTER TABLE "ai_context_projects"
  ALTER COLUMN "created_by_user_id" DROP NOT NULL;

ALTER TABLE "ai_context_projects"
  ADD CONSTRAINT "ai_context_projects_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_context_memories"
  DROP CONSTRAINT "ai_context_memories_project_id_fkey";

ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
