ALTER TABLE "work_orders"
  ADD COLUMN "source_project_id_snapshot" VARCHAR,
  ADD COLUMN "source_project_name_snapshot" VARCHAR;

UPDATE "work_orders" AS work_order
SET
  "source_project_id_snapshot" = project."id",
  "source_project_name_snapshot" = project."name"
FROM "ai_sessions_metadata" AS source_session
JOIN "ai_context_projects" AS project
  ON project."id" = source_session."selected_context_project_id"
WHERE work_order."source_session_id" = source_session."id"
  AND source_session."scope_type" = 'project';
