-- Preserve existing writer events; add immutable receipts for manual recall changes.
ALTER TABLE ai_context_memory_events
  ADD COLUMN actor_id_snapshot VARCHAR,
  ADD COLUMN memory_revision INTEGER,
  DROP CONSTRAINT ai_context_memory_events_operation_check,
  DROP CONSTRAINT ai_context_memory_events_shape_check,
  ADD CONSTRAINT ai_context_memory_events_operation_check CHECK (
    operation IN ('ADD', 'UPDATE', 'DELETE', 'NOOP', 'UNDO', 'WITHDRAW', 'PENDING_CONFLICT', 'PAUSE', 'RESUME')
  ),
  ADD CONSTRAINT ai_context_memory_events_shape_check CHECK (
    (operation = 'ADD' AND memory_id IS NOT NULL AND previous_memory_id IS NULL AND target_event_id IS NULL) OR
    (operation = 'UPDATE' AND memory_id IS NOT NULL AND previous_memory_id IS NOT NULL AND target_event_id IS NULL) OR
    (operation IN ('DELETE', 'WITHDRAW', 'PENDING_CONFLICT') AND memory_id IS NOT NULL AND target_event_id IS NULL) OR
    (operation = 'NOOP' AND target_event_id IS NULL) OR
    (operation = 'UNDO' AND target_event_id IS NOT NULL) OR
    (operation IN ('PAUSE', 'RESUME') AND project_id IS NOT NULL AND workspace_id IS NULL
      AND memory_id IS NOT NULL AND previous_memory_id IS NULL AND target_event_id IS NULL
      AND source_session_id IS NULL AND source_turn_id IS NULL
      AND actor_id_snapshot IS NOT NULL AND memory_revision IS NOT NULL AND memory_revision >= 2 AND explicit
      AND writer_version = 'project-memory-lifecycle/v1' AND undone_at IS NULL)
  );

CREATE UNIQUE INDEX ai_context_memory_lifecycle_revision_key
  ON ai_context_memory_events(memory_id, memory_revision)
  WHERE operation IN ('PAUSE', 'RESUME');

CREATE FUNCTION ai_context_memory_lifecycle_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.operation IN ('PAUSE', 'RESUME') AND NOT EXISTS (
      SELECT 1 FROM ai_context_memories memory
      WHERE memory.id = NEW.memory_id AND memory.project_id = NEW.project_id
        AND memory.scope = 'project' AND memory.sharing_status = 'shared'
        AND memory.revision = NEW.memory_revision
        AND memory.fact_key IS NOT DISTINCT FROM NEW.fact_key
        AND memory.last_edited_by_user_id = NEW.actor_id_snapshot
        AND NEW.owner_user_id = NEW.actor_id_snapshot
        AND memory.status = CASE NEW.operation WHEN 'PAUSE' THEN 'disabled' ELSE 'active' END
    ) THEN
      RAISE EXCEPTION 'Project memory lifecycle receipt does not match the applied revision' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.operation IN ('PAUSE', 'RESUME') THEN
    -- Account deletion may detach its live FK, while the immutable actor snapshot remains.
    IF TG_OP = 'UPDATE' AND OLD.owner_user_id IS NOT NULL AND NEW.owner_user_id IS NULL
      AND (to_jsonb(NEW) - 'owner_user_id') = (to_jsonb(OLD) - 'owner_user_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Project memory lifecycle receipts are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.operation IN ('PAUSE', 'RESUME') THEN
    RAISE EXCEPTION 'Historical events cannot become lifecycle receipts' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_context_memory_lifecycle_receipt_guard
  BEFORE INSERT OR UPDATE OR DELETE ON ai_context_memory_events
  FOR EACH ROW EXECUTE FUNCTION ai_context_memory_lifecycle_receipt_guard();
