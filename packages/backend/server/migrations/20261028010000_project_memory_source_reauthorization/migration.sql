-- Keep immutable document grants and memory source bindings unchanged. No legacy
-- quarantine is cleared by migration; restoration requires fresh source consent.
CREATE TABLE ai_project_memory_source_authorizations (
  grant_id VARCHAR PRIMARY KEY REFERENCES ai_context_project_grants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  status VARCHAR NOT NULL CHECK (status IN ('active', 'revoked')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ai_project_memory_source_authorization_events (
  id VARCHAR PRIMARY KEY,
  grant_id VARCHAR NOT NULL REFERENCES ai_context_project_grants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status VARCHAR NOT NULL CHECK (status IN ('active', 'revoked')),
  actor_user_id_snapshot VARCHAR NOT NULL CHECK (length(btrim(actor_user_id_snapshot)) > 0),
  request_key VARCHAR NOT NULL,
  request_fingerprint VARCHAR NOT NULL,
  restored_memories JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(restored_memories) = 'array'),
  restored_count INTEGER NOT NULL DEFAULT 0 CHECK (restored_count >= 0),
  quarantined_count INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_count >= 0),
  deferred_count INTEGER NOT NULL DEFAULT 0 CHECK (deferred_count >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (grant_id, revision),
  UNIQUE (grant_id, request_key),
  CHECK (restored_count = jsonb_array_length(restored_memories))
);

CREATE FUNCTION ai_project_memory_source_authorized(target_grant_id VARCHAR)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(consent.status, grant_row.status) = 'active'
  FROM ai_context_project_grants grant_row
  LEFT JOIN ai_project_memory_source_authorizations consent ON consent.grant_id = grant_row.id
  WHERE grant_row.id = target_grant_id;
$$;

CREATE FUNCTION ai_project_memory_source_event_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM ai_context_project_grants WHERE id = OLD.grant_id) THEN
    RAISE EXCEPTION 'Memory source authorization evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER ai_project_memory_source_event_immutable BEFORE UPDATE OR DELETE
ON ai_project_memory_source_authorization_events FOR EACH ROW EXECUTE FUNCTION ai_project_memory_source_event_immutable();

CREATE FUNCTION ai_project_memory_source_authorization_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE target_id VARCHAR; memory_row RECORD;
BEGIN
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.grant_id ELSE NEW.grant_id END;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM ai_context_project_grants WHERE id = target_id) THEN
      RAISE EXCEPTION 'Memory source consent cannot be removed' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (TG_OP = 'UPDATE' AND (NEW.grant_id <> OLD.grant_id OR NEW.revision <> OLD.revision + 1))
    OR (TG_OP = 'INSERT' AND NEW.revision <> 1)
    OR NOT EXISTS (
      SELECT 1 FROM ai_project_memory_source_authorization_events event
      WHERE event.grant_id = NEW.grant_id AND event.revision = NEW.revision AND event.status = NEW.status
    ) THEN
    RAISE EXCEPTION 'Memory source consent requires matching versioned evidence' USING ERRCODE = '23514';
  END IF;
  FOR memory_row IN SELECT memory_id FROM ai_context_memory_sources WHERE project_grant_id = target_id LOOP
    PERFORM ai_context_assert_active_memory_sources(memory_row.memory_id);
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ai_project_memory_source_authorization_guard AFTER INSERT OR UPDATE OR DELETE
ON ai_project_memory_source_authorizations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ai_project_memory_source_authorization_guard();

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
            AND NOT ai_project_memory_source_authorized(grant_row.id)
        )
      )
  ) THEN
    RAISE EXCEPTION 'Active project memory requires authorized source provenance'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_context_memories_active_source_required_check';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "ai_context_memory_source_guard"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'ai_context_memories' THEN
    IF TG_OP <> 'DELETE' THEN
      IF TG_OP = 'UPDATE'
        AND OLD."scope" = 'project'
        AND OLD."quarantined_at" IS NOT NULL
        AND (
          NEW."scope" IS DISTINCT FROM OLD."scope" OR
          NEW."status" = 'active' OR
          NEW."quarantined_at" IS NULL OR
          NEW."quarantine_reason" IS NULL
        )
        AND NOT COALESCE((
          OLD.status = 'disabled'
          AND OLD.quarantine_reason IN ('project_grant_revoked', 'source_document_deleted', 'memory_source_revoked')
          AND NEW.scope = OLD.scope AND NEW.project_id = OLD.project_id
          AND NEW.content = OLD.content AND NEW.fingerprint = OLD.fingerprint
          AND NEW.sharing_status = OLD.sharing_status AND NEW.sharing_status = 'shared'
          AND NEW.status = 'active' AND NEW.revision = OLD.revision + 1
          AND NEW.quarantined_at IS NULL AND NEW.quarantine_reason IS NULL
          AND NEW.quarantined_by_project_grant_id IS NULL
          AND EXISTS (SELECT 1 FROM ai_context_memory_sources source
            WHERE source.memory_id = OLD.id AND source.project_grant_id = OLD.quarantined_by_project_grant_id)
          AND NOT EXISTS (SELECT 1 FROM ai_context_memory_sources source
            WHERE source.memory_id = OLD.id AND NOT ai_project_memory_source_authorized(source.project_grant_id))
          AND EXISTS (
            SELECT 1 FROM ai_project_memory_source_authorization_events event
            JOIN ai_context_memory_sources source ON source.project_grant_id = event.grant_id AND source.memory_id = OLD.id
            WHERE event.status = 'active' AND event.restored_memories @>
              jsonb_build_array(jsonb_build_object('id', OLD.id, 'revision', OLD.revision,
                'quarantinedAt', to_char(OLD.quarantined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
          )
        ), false)
      THEN
        RAISE EXCEPTION
          'Quarantined project memory cannot be reactivated'
          USING ERRCODE = '23514',
            CONSTRAINT = 'ai_context_memories_project_quarantine_irreversible_check';
      END IF;
      PERFORM "ai_context_assert_active_memory_sources"(NEW."id");
      RETURN NEW;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    PERFORM "ai_context_assert_active_memory_sources"(OLD."memory_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "ai_context_assert_active_memory_sources"(NEW."memory_id");
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;


-- Project list invalidation already uses per-user authenticated delivery. Memory
-- revision is Project state too; notify all current members without any content.
CREATE FUNCTION ai_project_memory_revision_notify()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.project_memory_revision IS DISTINCT FROM OLD.project_memory_revision THEN
    INSERT INTO project_realtime_outbox (topic, scope_id)
      SELECT 'project.list.changed', member.user_id
      FROM ai_context_project_members member
      JOIN ai_context_projects project ON project.id = member.project_id
      WHERE member.project_id = NEW.project_id AND project.status = 'active';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_project_memory_revision_notify AFTER INSERT OR UPDATE
ON ai_project_memory_settings FOR EACH ROW EXECUTE FUNCTION ai_project_memory_revision_notify();
