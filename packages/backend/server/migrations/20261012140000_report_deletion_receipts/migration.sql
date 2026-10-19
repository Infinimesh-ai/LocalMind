-- A durable deletion owns one immutable request and a recoverable worker lease.
ALTER TABLE project_report_deletions
  ADD CONSTRAINT report_deletion_worker_state CHECK (
    (status = 'purging' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'purging' AND lease_id IS NULL AND lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT report_deletion_hold_state CHECK (
    (status = 'held' AND hold_reason IS NOT NULL AND held_at IS NOT NULL)
    OR (status <> 'held' AND hold_reason IS NULL)
  ),
  ADD CONSTRAINT report_deletion_completion_state CHECK (
    (status = 'purged') = (completed_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION localmind_guard_report_deletion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Report deletion evidence is immutable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('requested', 'held') OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'Report deletion must begin with an unclaimed request';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.report_id, NEW.project_id, NEW.actor_id, NEW.request_key,
         NEW.expected_version, NEW.fingerprint, NEW.eligible_at, NEW.created_at)
    IS DISTINCT FROM
     ROW(OLD.report_id, OLD.project_id, OLD.actor_id, OLD.request_key,
         OLD.expected_version, OLD.fingerprint, OLD.eligible_at, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Report deletion evidence is immutable';
  END IF;
  IF OLD.status = 'purged' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Report purge is terminal';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'Report deletion attempt counter cannot move backwards';
  END IF;
  IF NOT (
    (OLD.status = 'requested' AND NEW.status IN ('requested', 'held', 'purging'))
    OR (OLD.status = 'held' AND NEW.status IN ('held', 'purging'))
    OR (OLD.status = 'purging' AND NEW.status IN ('purging', 'requested', 'held', 'purged'))
    OR (OLD.status = 'purged' AND NEW.status = 'purged')
  ) THEN
    RAISE EXCEPTION 'Invalid report deletion state transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER report_deletion_initial_guard
  BEFORE INSERT ON project_report_deletions
  FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_deletion();

-- The storage object target cannot be retargeted or returned to the queue after
-- a terminal receipt. Shared/native resources are retained, never cascade deleted.
ALTER TABLE project_report_blob_deletions
  ADD CONSTRAINT report_blob_deletion_completion_state CHECK (
    (status = 'pending') = (completed_at IS NULL)
  );

CREATE FUNCTION localmind_guard_report_blob_deletion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Report Blob deletion receipt is immutable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Report Blob deletion must begin pending';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.report_id, NEW.project_id, NEW.blob_key, NEW.created_at)
    IS DISTINCT FROM
     ROW(OLD.id, OLD.report_id, OLD.project_id, OLD.blob_key, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Report Blob deletion target is immutable';
  END IF;
  IF OLD.status IN ('deleted', 'retained') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Report Blob deletion receipt is terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER report_blob_deletion_evidence_guard
  BEFORE INSERT OR UPDATE OR DELETE ON project_report_blob_deletions
  FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_deletion();
