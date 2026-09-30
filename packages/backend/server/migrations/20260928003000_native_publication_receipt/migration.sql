CREATE OR REPLACE FUNCTION project_publication_completion_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE publication project_publications%ROWTYPE;
DECLARE receipt jsonb;
BEGIN
  IF NEW.snapshot->>'action' <> 'completed' THEN RETURN NEW; END IF;
  SELECT * INTO publication FROM project_publications WHERE id = NEW.publication_id;
  receipt := NEW.snapshot->'receipt';
  IF receipt IS NULL OR NOT EXISTS (
    SELECT 1 FROM ai_agent_runtime_execution_results result
    WHERE result.run_id = publication.run_id AND result.project_id = publication.project_id
      AND result.actor_id = publication.actor_id AND result.result_status = 'completed'
      AND result.side_effects_applied AND result.side_effect_mode = 'workspace_write'
      AND result.result_payload->'sideEffectSummary' = receipt
      AND receipt->>'publicationId' = publication.id
      AND receipt->>'targetResourceId' = publication.target->>'resourceId'
      AND receipt->>'workspaceId' = publication.target->>'workspaceId'
      AND COALESCE(receipt->>'targetKind', 'legacy') = COALESCE(publication.target->>'targetKind', 'legacy')
  ) THEN RAISE EXCEPTION 'Publication completion requires matching immutable worker evidence' USING ERRCODE = '23514'; END IF;
  IF COALESCE(publication.target->>'targetKind', 'legacy') = 'workspace_file' THEN
    IF NOT EXISTS (SELECT 1 FROM workspace_file_revisions revision
      JOIN workspace_file_states state ON state.file_id = revision.file_id AND state.workspace_id = revision.workspace_id
      WHERE revision.id = receipt->>'targetVersion' AND revision.workspace_id = receipt->>'workspaceId'
        AND revision.file_id = receipt->>'targetResourceId' AND state.content_version = revision.sequence
        AND state.trashed_at IS NULL AND state.deleted_at IS NULL)
    THEN RAISE EXCEPTION 'Native publication completion requires its persisted active file revision' USING ERRCODE = '23514'; END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM office_revisions WHERE id = receipt->>'targetVersion'
      AND workspace_id = receipt->>'workspaceId' AND artifact_id = receipt->>'targetResourceId'
  ) AND NOT EXISTS (
    SELECT 1 FROM snapshots WHERE workspace_id = receipt->>'workspaceId' AND guid = receipt->>'targetResourceId'
  ) AND NOT EXISTS (
    SELECT 1 FROM updates WHERE workspace_id = receipt->>'workspaceId' AND guid = receipt->>'targetResourceId'
  ) THEN RAISE EXCEPTION 'Publication completion requires a persisted external resource' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION project_publication_target_receipt_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM project_publications publication
      JOIN ai_agent_runtime_execution_results result ON result.run_id = publication.run_id
    WHERE publication.id = NEW.publication_id AND publication.project_id = NEW.project_id
      AND publication.resource_id = NEW.resource_id AND publication.status = 'submitted'
      AND publication.source_sequence = NEW.source_sequence
      AND publication.target->>'workspaceId' = NEW.workspace_id
      AND publication.target->>'resourceId' = NEW.target_resource_id
      AND COALESCE(publication.target->>'targetKind', 'legacy') = NEW.target_kind
      AND COALESCE(result.result_payload->'sideEffectSummary'->>'targetKind', 'legacy') = NEW.target_kind
      AND result.result_status = 'completed' AND result.side_effects_applied
      AND result.side_effect_mode = 'workspace_write' AND result.project_id = NEW.project_id
      AND result.result_payload->'sideEffectSummary'->>'publicationId' = NEW.publication_id
      AND result.result_payload->'sideEffectSummary'->>'targetVersion' = NEW.target_version
      AND result.result_payload->'sideEffectSummary'->>'targetResourceId' = NEW.target_resource_id
      AND result.result_payload->'sideEffectSummary'->>'workspaceId' = NEW.workspace_id
  ) THEN RAISE EXCEPTION 'Publication target requires a completed execution receipt' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION guard_publication_target_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_kind IS DISTINCT FROM OLD.target_kind THEN RAISE EXCEPTION 'Publication target resource type is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_target_type_immutable BEFORE UPDATE ON project_publication_targets
  FOR EACH ROW EXECUTE FUNCTION guard_publication_target_type();
