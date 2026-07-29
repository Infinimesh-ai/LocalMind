DELETE FROM "ai_context_preferences" AS "preference"
WHERE NOT EXISTS (
  SELECT 1
  FROM "workspaces" AS "workspace"
  WHERE "workspace"."id" = "preference"."workspace_id"
);

ALTER TABLE "ai_context_preferences"
  ADD CONSTRAINT "ai_context_preferences_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
