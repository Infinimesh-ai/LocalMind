-- Preserve the stable chapter selected when a comment is created. Existing
-- comments retain their original revision and text anchor without guessing a
-- chapter identity from a possibly duplicated title.
ALTER TABLE "project_report_comments"
  ADD COLUMN "chapter_id" VARCHAR(256);
