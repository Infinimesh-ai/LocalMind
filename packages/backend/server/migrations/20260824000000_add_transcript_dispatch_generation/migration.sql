-- Nullable for rolling compatibility with LocalMind releases that do not
-- attach a dispatch generation to transcript tasks.
ALTER TABLE "ai_transcript_tasks"
  ADD COLUMN "dispatch_generation" VARCHAR;
