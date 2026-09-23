-- Project-native Office resources store their immutable content revisions in
-- office_revisions while Page/Edgeless/plain resources use
-- project_resource_revisions. Context provenance must accept either source of
-- truth without weakening the Project/session ownership checks.
CREATE OR REPLACE FUNCTION bound_ai_session_context_sources() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE session_project varchar;
DECLARE session_work_order varchar;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('context-source:' || NEW.session_id, 0));
  SELECT selected_context_project_id INTO session_project
    FROM ai_sessions_metadata WHERE id = NEW.session_id;
  SELECT work_order_id INTO session_work_order
    FROM work_order_session_bindings WHERE session_id = NEW.session_id;
  IF NEW.project_id IS NOT NULL
     AND (session_project IS DISTINCT FROM NEW.project_id
       OR NEW.workspace_id IS NOT NULL OR NEW.work_order_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Project source does not belong to this conversation'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.work_order_id IS NOT NULL
     AND (session_work_order IS DISTINCT FROM NEW.work_order_id
       OR NEW.workspace_id IS NOT NULL OR NEW.project_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Work order source does not belong to this conversation'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.kind IN ('project', 'project_resource', 'project_blob')
     AND NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'Project source requires a Project owner' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind IN ('work_order', 'work_order_delivery')
     AND NEW.work_order_id IS NULL THEN
    RAISE EXCEPTION 'Work order source requires a work order owner' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind IN ('workspace', 'document') AND NEW.workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace source requires a Workspace owner' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'project_resource'
     AND NOT EXISTS (
       SELECT 1 FROM project_resource_revisions revision
       WHERE revision.project_id = NEW.project_id
         AND revision.resource_id = split_part(NEW.source_id, '@', 1)
         AND revision.sequence::text = split_part(NEW.source_id, '@', 2)
     )
     AND NOT EXISTS (
       SELECT 1
       FROM project_resources resource
       JOIN office_artifacts artifact
         ON artifact.id = resource.office_artifact_id
        AND artifact.project_id = resource.project_id
       JOIN office_revisions revision
         ON revision.artifact_id = artifact.id
        AND revision.project_id = resource.project_id
       WHERE resource.project_id = NEW.project_id
         AND resource.id = split_part(NEW.source_id, '@', 1)
         AND revision.sequence::text = split_part(NEW.source_id, '@', 2)
     ) THEN
    RAISE EXCEPTION 'Project source revision is unavailable' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'project_blob' AND NOT EXISTS (
    SELECT 1 FROM project_blobs blob
    WHERE blob.project_id = NEW.project_id AND blob.key = NEW.source_id
  ) THEN
    RAISE EXCEPTION 'Project source Blob is unavailable' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'work_order_delivery' AND NOT EXISTS (
    SELECT 1 FROM work_order_delivery_revisions delivery
    WHERE delivery.work_order_id = NEW.work_order_id
      AND delivery.id = split_part(NEW.source_id, '@', 1)
      AND delivery.revision::text = split_part(NEW.source_id, '@', 2)
  ) THEN
    RAISE EXCEPTION 'Work order delivery revision is unavailable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ai_session_context_sources source
    WHERE source.session_id = NEW.session_id
      AND source.workspace_id IS NOT DISTINCT FROM NEW.workspace_id
      AND source.project_id IS NOT DISTINCT FROM NEW.project_id
      AND source.work_order_id IS NOT DISTINCT FROM NEW.work_order_id
      AND source.kind = NEW.kind AND source.source_id = NEW.source_id
  ) THEN RETURN NULL; END IF;
  IF NEW.source_id <> 'source-budget-exceeded' AND (
    SELECT count(*) FROM ai_session_context_sources source
    WHERE source.session_id = NEW.session_id
      AND source.source_id <> 'source-budget-exceeded'
  ) >= 4096 THEN
    INSERT INTO ai_session_context_sources(
      session_id, workspace_id, project_id, work_order_id, kind, source_id
    ) VALUES (
      NEW.session_id, NEW.workspace_id, NEW.project_id, NEW.work_order_id,
      'unknown', 'source-budget-exceeded'
    ) ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;
  IF NEW.kind = 'document' AND NEW.evidence = '{}'::jsonb THEN
    NEW.evidence := jsonb_build_object('projectGrantId', (
      SELECT grant_row.id FROM ai_context_project_grants grant_row
      JOIN ai_sessions_metadata session
        ON session.selected_context_project_id = grant_row.project_id
      WHERE session.id = NEW.session_id
        AND grant_row.workspace_id = NEW.workspace_id
        AND grant_row.doc_id = NEW.source_id
        AND grant_row.status = 'active'
    ));
  END IF;
  RETURN NEW;
END;
$$;
