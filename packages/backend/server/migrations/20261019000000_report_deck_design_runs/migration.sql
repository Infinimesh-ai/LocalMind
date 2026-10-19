ALTER TABLE report_decks ADD COLUMN generation_version INTEGER NOT NULL DEFAULT 2;
ALTER TABLE report_decks ADD COLUMN quality JSONB;
ALTER TABLE report_decks ADD CONSTRAINT report_deck_generation_version CHECK (generation_version IN (2,3));

CREATE TABLE report_deck_runs (
  id VARCHAR PRIMARY KEY, deck_id VARCHAR NOT NULL REFERENCES report_decks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt >= 0), status VARCHAR(24) NOT NULL DEFAULT 'running' CHECK (status IN ('running','ready','failed','cancelled')),
  lease_owner VARCHAR(64) NOT NULL, lease_expires_at TIMESTAMPTZ(3) NOT NULL,
  fence INTEGER NOT NULL DEFAULT 1 CHECK (fence > 0), deadline TIMESTAMPTZ(3) NOT NULL,
  snapshot JSONB NOT NULL, calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  format_retries INTEGER NOT NULL DEFAULT 0 CHECK (format_retries BETWEEN 0 AND 2),
  repairs INTEGER NOT NULL DEFAULT 0 CHECK (repairs BETWEEN 0 AND 2),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(deck_id, attempt)
);
CREATE INDEX report_deck_runs_status_lease_expires_at_idx ON report_deck_runs(status,lease_expires_at);
CREATE TABLE report_deck_steps (
  id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL REFERENCES report_deck_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0), stage VARCHAR(80) NOT NULL,
  input_hash VARCHAR(64) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','outcome_unknown')),
  input_chars INTEGER NOT NULL CHECK (input_chars >= 0), output_chars INTEGER,
  error_code VARCHAR(64), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMPTZ(3),
  UNIQUE(run_id, sequence)
);
CREATE TABLE report_deck_artifacts (
  id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL REFERENCES report_deck_runs(id) ON DELETE CASCADE,
  key VARCHAR(160) NOT NULL, input_hash VARCHAR(64) NOT NULL, hash VARCHAR(64) NOT NULL,
  mime VARCHAR(64) NOT NULL, payload BYTEA NOT NULL, byte_length INTEGER NOT NULL CHECK (byte_length >= 0 AND byte_length <= 10485760),
  expires_at TIMESTAMPTZ(3) NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT report_deck_artifact_size CHECK (octet_length(payload) = byte_length),
  UNIQUE(run_id,key)
);
CREATE INDEX report_deck_artifacts_expires_at_idx ON report_deck_artifacts(expires_at);
CREATE FUNCTION protect_report_design_evidence() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'report_deck_artifacts' THEN
    RAISE EXCEPTION 'Report design artifacts are immutable';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.deadline IS DISTINCT FROM OLD.deadline
    OR NEW.deck_id IS DISTINCT FROM OLD.deck_id OR NEW.attempt IS DISTINCT FROM OLD.attempt THEN
    RAISE EXCEPTION 'Report design run identity and snapshot are immutable';
  END IF;
  IF NEW.calls < OLD.calls OR NEW.repairs < OLD.repairs OR NEW.format_retries < OLD.format_retries OR NEW.fence < OLD.fence THEN
    RAISE EXCEPTION 'Report design counters cannot decrease';
  END IF;
  IF OLD.status <> 'running' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Report design terminal state cannot change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER report_deck_artifact_immutable BEFORE UPDATE ON report_deck_artifacts FOR EACH ROW EXECUTE FUNCTION protect_report_design_evidence();
CREATE TRIGGER report_deck_run_evidence BEFORE UPDATE ON report_deck_runs FOR EACH ROW EXECUTE FUNCTION protect_report_design_evidence();
