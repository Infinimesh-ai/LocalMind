ALTER TABLE "notifications"
ADD COLUMN "dismissed_at" TIMESTAMPTZ(3);

CREATE INDEX "notifications_user_id_dismissed_at_read_created_at_idx"
ON "notifications"("user_id", "dismissed_at", "read", "created_at");
