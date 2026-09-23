-- A managed shared-memory correction is an immutable superseding version. It
-- may inherit the prior version's authorized source evidence, but only when
-- the editor is a current Project Owner and the chain stays inside one Project.
CREATE OR REPLACE FUNCTION ai_context_native_memory_provenance_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.project_source_check_id IS DISTINCT FROM OLD.project_source_check_id
  THEN
    RAISE EXCEPTION 'Project memory source evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW.project_source_check_id IS NOT NULL
    AND NOT (
      EXISTS (
        SELECT 1
        FROM ai_shared_write_source_checks evidence
        JOIN ai_sessions_metadata session ON session.id = evidence.session_id
        WHERE evidence.id = NEW.project_source_check_id
          AND evidence.allowed
          AND evidence.project_id = NEW.project_id
          AND evidence.actor_id = NEW.owner_user_id
          AND evidence.session_id = NEW.source_session_id
          AND evidence.sink_type = 'project_memory'
          AND evidence.sink_workspace_id IS NULL
          AND evidence.phase = 'execute'
          AND session.workspace_id IS NULL
          AND session.selected_context_project_id = NEW.project_id
          AND session.user_id = NEW.owner_user_id
          AND session.deleted_at IS NULL
          AND NEW.scope = 'project'
          AND NEW.workspace_id IS NULL
          AND NEW.doc_id IS NULL
      )
      OR (
        NEW.supersedes_id IS NOT NULL
        AND NEW.scope = 'project'
        AND NEW.workspace_id IS NULL
        AND NEW.doc_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM ai_context_memories previous
          WHERE previous.id = NEW.supersedes_id
            AND previous.project_id = NEW.project_id
            AND previous.scope = 'project'
            AND previous.sharing_status = 'shared'
            AND previous.status = 'superseded'
            AND previous.project_source_check_id = NEW.project_source_check_id
        )
        AND EXISTS (
          SELECT 1
          FROM ai_context_projects project
          JOIN ai_context_project_members member
            ON member.project_id = project.id
          WHERE project.id = NEW.project_id
            AND project.status = 'active'
            AND member.user_id = NEW.last_edited_by_user_id
            AND member.role = 'owner'
        )
      )
    )
  THEN
    RAISE EXCEPTION 'Native memory requires authorized Project conversation evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_context_assert_active_memory_sources(target_memory_id VARCHAR)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_context_memories memory
    WHERE memory.id = target_memory_id
      AND memory.scope = 'project'
      AND memory.status = 'active'
      AND (
        (
          NOT EXISTS (
            SELECT 1
            FROM ai_context_memory_sources source
            WHERE source.memory_id = memory.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ai_shared_write_source_checks evidence
            JOIN ai_context_memory_events event
              ON event.decision_fingerprint = evidence.sink_id
             AND event.memory_id = memory.id
             AND event.operation IN ('ADD', 'UPDATE')
            WHERE evidence.id = memory.project_source_check_id
              AND evidence.allowed
              AND evidence.project_id = memory.project_id
              AND evidence.sink_type = 'project_memory'
              AND evidence.sink_workspace_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM project_summary_revisions revision
            WHERE revision.memory_id = memory.id
              AND revision.project_id = memory.project_id
              AND memory.kind = 'project_summary'
              AND memory.capture_mode = 'manual'
              AND memory.source_session_id IS NULL
              AND memory.project_source_check_id IS NULL
              AND revision.content_fingerprint =
                encode(digest(memory.content, 'sha256'), 'hex')
          )
          AND NOT (
            memory.supersedes_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM ai_context_projects project
              JOIN ai_context_project_members member
                ON member.project_id = project.id
              WHERE project.id = memory.project_id
                AND project.status = 'active'
                AND member.user_id = memory.last_edited_by_user_id
                AND member.role = 'owner'
            )
            AND EXISTS (
              WITH RECURSIVE lineage AS (
                SELECT ancestor.id, ancestor.project_id,
                  ancestor.supersedes_id, ancestor.project_source_check_id
                FROM ai_context_memories ancestor
                WHERE ancestor.id = memory.supersedes_id
                  AND ancestor.project_id = memory.project_id
                  AND ancestor.scope = 'project'
                  AND ancestor.sharing_status = 'shared'
                UNION ALL
                SELECT ancestor.id, ancestor.project_id,
                  ancestor.supersedes_id, ancestor.project_source_check_id
                FROM ai_context_memories ancestor
                JOIN lineage child ON child.supersedes_id = ancestor.id
                WHERE ancestor.project_id = memory.project_id
                  AND ancestor.scope = 'project'
                  AND ancestor.sharing_status = 'shared'
              )
              SELECT 1
              FROM lineage ancestor
              JOIN ai_shared_write_source_checks evidence
                ON evidence.id = ancestor.project_source_check_id
              JOIN ai_context_memory_events event
                ON event.decision_fingerprint = evidence.sink_id
               AND event.memory_id = ancestor.id
               AND event.operation IN ('ADD', 'UPDATE')
              WHERE evidence.allowed
                AND evidence.project_id = memory.project_id
                AND evidence.sink_type = 'project_memory'
                AND evidence.sink_workspace_id IS NULL
                AND ancestor.project_source_check_id = memory.project_source_check_id
              LIMIT 1
            )
          )
        )
        OR EXISTS (
          SELECT 1
          FROM ai_context_memory_sources source
          JOIN ai_context_project_grants grant_row
            ON grant_row.id = source.project_grant_id
          WHERE source.memory_id = memory.id
            AND grant_row.status <> 'active'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Active project memory requires authorized source provenance'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_context_memories_active_source_required_check';
  END IF;
END;
$$;
