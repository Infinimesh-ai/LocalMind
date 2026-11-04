ALTER TABLE document_event_outbox
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN last_error VARCHAR(64);
CREATE INDEX document_event_outbox_next_attempt_at_created_at_idx
  ON document_event_outbox(next_attempt_at, created_at);
CREATE INDEX replies_comment_id_user_id_idx ON replies(comment_id, user_id);
