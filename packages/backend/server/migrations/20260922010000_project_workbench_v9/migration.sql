-- Project Workbench v9: owned conversation state, private work orders,
-- immutable delivery revisions, and the third Agent Runtime owner.

ALTER TYPE "NotificationType" ADD VALUE 'WorkOrder';

ALTER TABLE ai_sessions_metadata
  ADD COLUMN scope_type varchar(16),
  ADD COLUMN title_source varchar(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN title_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN title_generation_status varchar(16) NOT NULL DEFAULT 'pending';

UPDATE ai_sessions_metadata
SET scope_type = CASE
  WHEN workspace_id IS NULL AND selected_context_project_id IS NOT NULL
    THEN 'project'
  ELSE 'workspace'
END
WHERE scope_type IS NULL;

ALTER TABLE ai_sessions_metadata
  ALTER COLUMN scope_type SET NOT NULL,
  ALTER COLUMN scope_type SET DEFAULT 'workspace',
  ADD CONSTRAINT ai_sessions_scope_type_check CHECK (
    (scope_type = 'workspace' AND workspace_id IS NOT NULL)
    OR (
      scope_type = 'project'
      AND workspace_id IS NULL
      AND selected_context_project_id IS NOT NULL
      AND doc_id IS NULL
    )
    OR (
      scope_type = 'work_order'
      AND workspace_id IS NULL
      AND selected_context_project_id IS NULL
      AND doc_id IS NULL
      AND parent_session_id IS NULL
    )
  ),
  ADD CONSTRAINT ai_sessions_title_source_check
    CHECK (title_source IN ('pending', 'auto', 'manual')),
  ADD CONSTRAINT ai_sessions_title_generation_status_check
    CHECK (title_generation_status IN ('pending', 'running', 'complete', 'failed')),
  ADD CONSTRAINT ai_sessions_title_revision_check CHECK (title_revision > 0);

ALTER TABLE ai_sessions_metadata DROP CONSTRAINT ai_session_native_owner;

CREATE INDEX ai_sessions_metadata_user_id_scope_type_updated_at_idx
  ON ai_sessions_metadata(user_id, scope_type, updated_at DESC);

ALTER TABLE ai_session_context_sources ADD COLUMN work_order_id varchar;
ALTER TABLE ai_session_context_sources DROP CONSTRAINT ai_session_source_owner;
ALTER TABLE ai_session_context_sources ADD CONSTRAINT ai_session_source_owner
  CHECK (num_nonnulls(workspace_id, project_id, work_order_id) = 1);
ALTER TABLE ai_session_context_sources
  DROP CONSTRAINT ai_session_context_sources_kind_check;
ALTER TABLE ai_session_context_sources
  ADD CONSTRAINT ai_session_context_sources_kind_check CHECK (
    kind IN (
      'workspace', 'document', 'project', 'project_resource', 'project_blob',
      'work_order', 'work_order_delivery', 'private', 'private_attachment', 'unknown'
    )
  );
CREATE UNIQUE INDEX ai_session_context_sources_session_work_order_kind_source_key
  ON ai_session_context_sources(session_id, work_order_id, kind, source_id);

ALTER TABLE ai_project_byok_config
  ADD COLUMN work_order_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE ai_project_byok_audit_events
  ADD COLUMN work_order_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE ai_session_work_states (
  session_id varchar PRIMARY KEY REFERENCES ai_sessions_metadata(id) ON DELETE CASCADE,
  owner_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  completed_at timestamptz(3),
  completion_reason varchar(256),
  completion_request_key varchar,
  last_business_at timestamptz(3) NOT NULL DEFAULT now(),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT ai_session_work_states_version_check CHECK (version > 0),
  CONSTRAINT ai_session_work_states_completion_check CHECK (
    (completed_at IS NULL AND completion_reason IS NULL
      AND completion_request_key IS NULL)
    OR (completed_at IS NOT NULL AND completion_request_key IS NOT NULL)
  )
);
CREATE INDEX ai_session_work_states_owner_business_idx
  ON ai_session_work_states(owner_user_id, last_business_at DESC, session_id);

INSERT INTO ai_session_work_states(session_id, owner_user_id, last_business_at)
SELECT id, user_id, updated_at
FROM ai_sessions_metadata
ON CONFLICT (session_id) DO NOTHING;

CREATE TABLE ai_session_attentions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id varchar NOT NULL REFERENCES ai_sessions_metadata(id) ON DELETE CASCADE,
  actor_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason varchar(64) NOT NULL,
  source_type varchar(64) NOT NULL,
  source_id varchar NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status varchar(16) NOT NULL DEFAULT 'open',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  resolved_at timestamptz(3),
  resolved_by varchar REFERENCES users(id) ON DELETE SET NULL,
  resolution_evidence jsonb,
  CONSTRAINT ai_session_attentions_status_check CHECK (status IN ('open', 'resolved')),
  CONSTRAINT ai_session_attentions_version_check CHECK (version > 0),
  CONSTRAINT ai_session_attentions_resolution_check CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT ai_session_attentions_source_key
    UNIQUE(session_id, actor_id, source_type, source_id)
);
CREATE INDEX ai_session_attentions_actor_status_updated_idx
  ON ai_session_attentions(actor_id, status, updated_at DESC);

CREATE TABLE work_order_dispatches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  source_session_id varchar REFERENCES ai_sessions_metadata(id) ON DELETE SET NULL,
  sender_id varchar REFERENCES users(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  draft_version integer NOT NULL DEFAULT 1,
  draft_fingerprint varchar(64) NOT NULL,
  draft jsonb NOT NULL,
  request_key varchar NOT NULL,
  confirmation_hash varchar(64),
  expires_at timestamptz(3) NOT NULL,
  confirmed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_dispatches_status_check
    CHECK (status IN ('draft', 'confirmed', 'expired')),
  CONSTRAINT work_order_dispatches_version_check CHECK (draft_version > 0),
  CONSTRAINT work_order_dispatches_draft_check CHECK (
    jsonb_typeof(draft) = 'object' AND octet_length(draft::text) <= 1048576
  ),
  CONSTRAINT work_order_dispatches_confirmation_check CHECK (
    (status = 'draft' AND confirmed_at IS NULL AND confirmation_hash IS NOT NULL)
    OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmation_hash IS NOT NULL)
    OR status = 'expired'
  ),
  CONSTRAINT work_order_dispatches_sender_request_key
    UNIQUE(sender_id, request_key)
);
CREATE INDEX work_order_dispatches_source_created_idx
  ON work_order_dispatches(source_session_id, created_at DESC);

CREATE TABLE work_orders (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id varchar NOT NULL REFERENCES work_order_dispatches(id) ON DELETE RESTRICT,
  source_session_id varchar REFERENCES ai_sessions_metadata(id) ON DELETE SET NULL,
  sender_id varchar REFERENCES users(id) ON DELETE SET NULL,
  recipient_id varchar REFERENCES users(id) ON DELETE SET NULL,
  related_work_order_id varchar REFERENCES work_orders(id) ON DELETE RESTRICT,
  relation_kind varchar(16) NOT NULL DEFAULT 'original',
  status varchar(24) NOT NULL DEFAULT 'open',
  version integer NOT NULL DEFAULT 1,
  title varchar(256) NOT NULL,
  purpose text NOT NULL,
  requirements_fingerprint varchar(64) NOT NULL,
  background jsonb NOT NULL DEFAULT '{}'::jsonb,
  terminal_reason text,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  completed_at timestamptz(3),
  CONSTRAINT work_orders_relation_kind_check
    CHECK (relation_kind IN ('original', 'supplement', 'replacement')),
  CONSTRAINT work_orders_status_check CHECK (
    status IN ('open', 'waiting_sender', 'validating', 'delivered', 'refused', 'cancelled')
  ),
  CONSTRAINT work_orders_version_check CHECK (version > 0),
  CONSTRAINT work_orders_terminal_check CHECK (
    (status IN ('delivered', 'refused', 'cancelled') AND completed_at IS NOT NULL)
    OR (status NOT IN ('delivered', 'refused', 'cancelled') AND completed_at IS NULL)
  ),
  CONSTRAINT work_orders_relation_check CHECK (
    (relation_kind = 'original' AND related_work_order_id IS NULL)
    OR (relation_kind <> 'original' AND related_work_order_id IS NOT NULL)
  ),
  CONSTRAINT work_orders_distinct_participants_check
    CHECK (sender_id IS NULL OR recipient_id IS NULL OR sender_id <> recipient_id)
);
CREATE INDEX work_orders_sender_source_status_updated_idx
  ON work_orders(sender_id, source_session_id, status, updated_at DESC);
CREATE INDEX work_orders_recipient_status_updated_idx
  ON work_orders(recipient_id, status, updated_at DESC);
CREATE INDEX work_orders_related_idx ON work_orders(related_work_order_id);

CREATE TABLE work_order_session_bindings (
  work_order_id varchar PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
  session_id varchar NOT NULL UNIQUE REFERENCES ai_sessions_metadata(id) ON DELETE RESTRICT,
  owner_user_id varchar NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_user_id_snapshot varchar NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX work_order_session_bindings_owner_created_idx
  ON work_order_session_bindings(owner_user_id, created_at DESC);

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
  IF NEW.kind = 'project_resource' AND NOT EXISTS (
    SELECT 1 FROM project_resource_revisions revision
    WHERE revision.project_id = NEW.project_id
      AND revision.resource_id = split_part(NEW.source_id, '@', 1)
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

CREATE OR REPLACE FUNCTION inherit_ai_session_context_sources() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.parent_session_id IS NOT NULL THEN
    INSERT INTO ai_session_context_sources(
      session_id, workspace_id, project_id, work_order_id, kind, source_id, evidence
    )
    SELECT NEW.id, workspace_id, project_id, work_order_id, kind, source_id, evidence
    FROM ai_session_context_sources WHERE session_id = NEW.parent_session_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION capture_ai_message_sources() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE session_row ai_sessions_metadata;
DECLARE source_kind varchar;
DECLARE native_project varchar;
DECLARE bound_work_order varchar;
DECLARE attachment jsonb;
DECLARE blob_key varchar;
BEGIN
  SELECT * INTO session_row FROM ai_sessions_metadata WHERE id = NEW.session_id;
  native_project := CASE WHEN session_row.scope_type = 'project'
    THEN session_row.selected_context_project_id ELSE NULL END;
  SELECT work_order_id INTO bound_work_order
    FROM work_order_session_bindings WHERE session_id = NEW.session_id;
  IF TG_OP = 'UPDATE' AND (
    OLD.session_id, OLD.role, OLD.content, OLD.params::jsonb,
    OLD.attachments::jsonb, OLD."streamObjects"::jsonb
  ) IS DISTINCT FROM (
    NEW.session_id, NEW.role, NEW.content, NEW.params::jsonb,
    NEW.attachments::jsonb, NEW."streamObjects"::jsonb
  ) THEN
    INSERT INTO ai_session_context_sources(
      session_id, workspace_id, project_id, work_order_id, kind, source_id
    ) VALUES (
      NEW.session_id, session_row.workspace_id, native_project,
      bound_work_order, 'unknown', 'rewritten-message:' || NEW.id
    ) ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.role = 'user' THEN
    source_kind := CASE
      WHEN bound_work_order IS NOT NULL THEN 'work_order'
      WHEN native_project IS NOT NULL THEN 'project'
      ELSE 'private'
    END;
    INSERT INTO ai_session_context_sources(
      session_id, workspace_id, project_id, work_order_id, kind, source_id
    ) VALUES (
      NEW.session_id, session_row.workspace_id, native_project,
      bound_work_order, source_kind, 'conversation-input:' || NEW.id
    ) ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.attachments IS NOT NULL
     AND NEW.attachments::jsonb NOT IN ('null'::jsonb, '[]'::jsonb) THEN
    FOR attachment IN SELECT value FROM jsonb_array_elements(NEW.attachments::jsonb) LOOP
      blob_key := NULL;
      IF native_project IS NOT NULL
         AND attachment->>'kind' = 'data'
         AND attachment->>'encoding' = 'base64'
         AND octet_length(attachment->>'data') <= 33554432 THEN
        BEGIN
          blob_key := 'sha256-' || encode(sha256(decode(attachment->>'data', 'base64')), 'hex');
          IF NOT EXISTS (
            SELECT 1 FROM project_blobs
            WHERE project_id = native_project AND key = blob_key
              AND mime_type = attachment->>'mimeType'
          ) THEN blob_key := NULL; END IF;
        EXCEPTION WHEN OTHERS THEN blob_key := NULL;
        END;
      END IF;
      INSERT INTO ai_session_context_sources(
        session_id, workspace_id, project_id, work_order_id, kind, source_id
      ) VALUES (
        NEW.session_id, session_row.workspace_id, native_project,
        bound_work_order,
        CASE WHEN blob_key IS NOT NULL THEN 'project_blob' ELSE 'private_attachment' END,
        COALESCE(blob_key, 'message-attachment:' || NEW.id)
      ) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE work_order_requirements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  item_key varchar(64) NOT NULL,
  kind varchar(16) NOT NULL,
  title varchar(256) NOT NULL,
  instructions text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  accepted_mime_types text[] NOT NULL,
  min_count integer NOT NULL DEFAULT 1,
  max_count integer NOT NULL DEFAULT 1,
  validation_mode varchar(32) NOT NULL,
  ordinal integer NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_requirements_kind_check CHECK (kind IN ('file', 'text')),
  CONSTRAINT work_order_requirements_count_check
    CHECK (min_count >= 0 AND max_count >= min_count AND max_count <= 32),
  CONSTRAINT work_order_requirements_validation_mode_check CHECK (
    validation_mode IN ('mime_and_container', 'non_empty_text', 'bounded_model')
  ),
  CONSTRAINT work_order_requirements_item_key UNIQUE(work_order_id, item_key),
  CONSTRAINT work_order_requirements_snapshot_key UNIQUE(id, work_order_id)
);
CREATE INDEX work_order_requirements_order_idx
  ON work_order_requirements(work_order_id, ordinal);

CREATE TABLE work_order_exchanges (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  actor_id varchar REFERENCES users(id) ON DELETE SET NULL,
  kind varchar(24) NOT NULL,
  body text NOT NULL,
  fingerprint varchar(64) NOT NULL,
  request_key varchar NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_exchanges_kind_check
    CHECK (kind IN ('question', 'answer', 'refusal', 'cancellation')),
  CONSTRAINT work_order_exchanges_body_check CHECK (
    (kind = 'cancellation' AND length(btrim(body)) BETWEEN 0 AND 1200)
    OR (kind <> 'cancellation' AND length(btrim(body)) BETWEEN 1 AND 20000)
  ),
  CONSTRAINT work_order_exchanges_request_key UNIQUE(work_order_id, request_key)
);
CREATE INDEX work_order_exchanges_created_idx
  ON work_order_exchanges(work_order_id, created_at);

CREATE TABLE work_order_blobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  owner_id varchar REFERENCES users(id) ON DELETE SET NULL,
  requirement_id varchar NOT NULL,
  request_key varchar NOT NULL,
  key varchar(256) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'staged',
  file_name varchar(512) NOT NULL,
  mime_type varchar(256) NOT NULL,
  byte_size integer NOT NULL,
  fingerprint varchar(64) NOT NULL,
  expires_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_blobs_status_check CHECK (status IN ('staged', 'delivered', 'held', 'deleted')),
  CONSTRAINT work_order_blobs_size_check CHECK (byte_size > 0 AND byte_size <= 104857600),
  CONSTRAINT work_order_blobs_key UNIQUE(work_order_id, key),
  CONSTRAINT work_order_blobs_request_key UNIQUE(work_order_id, request_key),
  CONSTRAINT work_order_blobs_snapshot_key UNIQUE(id, work_order_id),
  CONSTRAINT work_order_blobs_requirement_fkey
    FOREIGN KEY(requirement_id, work_order_id)
    REFERENCES work_order_requirements(id, work_order_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX work_order_blobs_cleanup_idx ON work_order_blobs(status, expires_at);

CREATE TABLE work_order_delivery_revisions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  submitted_by varchar REFERENCES users(id) ON DELETE SET NULL,
  requirements_fingerprint varchar(64) NOT NULL,
  receipt_fingerprint varchar(64) NOT NULL,
  validation_evidence jsonb NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'complete',
  submitted_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_delivery_revisions_revision_check CHECK (revision > 0),
  CONSTRAINT work_order_delivery_revisions_status_check CHECK (status = 'complete'),
  CONSTRAINT work_order_delivery_revisions_key UNIQUE(work_order_id, revision),
  CONSTRAINT work_order_delivery_revisions_snapshot_key UNIQUE(id, work_order_id)
);
CREATE INDEX work_order_delivery_revisions_created_idx
  ON work_order_delivery_revisions(work_order_id, submitted_at DESC);

CREATE TABLE work_order_delivery_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_revision_id varchar NOT NULL,
  work_order_id varchar NOT NULL,
  requirement_id varchar NOT NULL,
  blob_id varchar,
  text_value text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_delivery_items_revision_fkey
    FOREIGN KEY(delivery_revision_id, work_order_id)
    REFERENCES work_order_delivery_revisions(id, work_order_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT work_order_delivery_items_requirement_fkey
    FOREIGN KEY(requirement_id, work_order_id)
    REFERENCES work_order_requirements(id, work_order_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT work_order_delivery_items_blob_fkey
    FOREIGN KEY(blob_id, work_order_id)
    REFERENCES work_order_blobs(id, work_order_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT work_order_delivery_items_value_check CHECK (
    num_nonnulls(blob_id, text_value) = 1
    AND (text_value IS NULL OR length(btrim(text_value)) BETWEEN 1 AND 200000)
  )
);
CREATE UNIQUE INDEX work_order_delivery_items_identity_key
  ON work_order_delivery_items(delivery_revision_id, requirement_id, COALESCE(blob_id, ''));
CREATE INDEX work_order_delivery_items_requirement_idx
  ON work_order_delivery_items(work_order_id, requirement_id);

CREATE TABLE work_order_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  actor_id varchar REFERENCES users(id) ON DELETE SET NULL,
  event_type varchar(48) NOT NULL,
  version integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_fingerprint varchar(64) NOT NULL UNIQUE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_events_version_check CHECK (version > 0),
  CONSTRAINT work_order_events_version_key UNIQUE(work_order_id, version)
);
CREATE INDEX work_order_events_created_idx ON work_order_events(work_order_id, created_at);

CREATE TABLE work_order_outbox (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  event_id varchar NOT NULL,
  recipient_id varchar NOT NULL,
  channel varchar(24) NOT NULL DEFAULT 'in_app',
  topic varchar(64) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz(3) NOT NULL DEFAULT now(),
  delivered_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_outbox_delivery_key UNIQUE(event_id, recipient_id, channel)
);
CREATE INDEX work_order_outbox_pending_idx ON work_order_outbox(delivered_at, available_at);

CREATE TABLE work_order_adoptions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  source_session_id varchar REFERENCES ai_sessions_metadata(id) ON DELETE SET NULL,
  source_session_id_snapshot varchar NOT NULL,
  actor_id varchar REFERENCES users(id) ON DELETE SET NULL,
  context_version integer NOT NULL,
  request_key varchar NOT NULL,
  revision_set_fingerprint varchar(64) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT work_order_adoptions_context_version_check CHECK (context_version > 0),
  CONSTRAINT work_order_adoptions_request_key UNIQUE(source_session_id_snapshot, request_key),
  CONSTRAINT work_order_adoptions_context_key UNIQUE(source_session_id_snapshot, context_version)
);

CREATE TABLE work_order_adoption_items (
  adoption_id varchar NOT NULL REFERENCES work_order_adoptions(id) ON DELETE CASCADE,
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE RESTRICT,
  delivery_revision_id varchar NOT NULL,
  PRIMARY KEY(adoption_id, work_order_id),
  CONSTRAINT work_order_adoption_items_delivery_fkey
    FOREIGN KEY(delivery_revision_id, work_order_id)
    REFERENCES work_order_delivery_revisions(id, work_order_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION ai_session_work_state_assert_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_sessions_metadata s
    WHERE s.id = NEW.session_id AND s.user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Conversation work state must match the session owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_session_work_state_owner_guard
  BEFORE INSERT OR UPDATE OF session_id, owner_user_id
  ON ai_session_work_states FOR EACH ROW
  EXECUTE FUNCTION ai_session_work_state_assert_owner();

CREATE FUNCTION ai_session_attention_assert_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ai_sessions_metadata s
    WHERE s.id = NEW.session_id AND s.user_id = NEW.actor_id
  ) THEN
    RAISE EXCEPTION 'Conversation attention must match the session owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_session_attention_owner_guard
  BEFORE INSERT OR UPDATE OF session_id, actor_id
  ON ai_session_attentions FOR EACH ROW
  EXECUTE FUNCTION ai_session_attention_assert_owner();

CREATE FUNCTION work_order_assert_dispatch() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       (
         NEW.source_session_id IS NULL
         AND OLD.source_session_id IS NOT NULL
         AND (
           OLD.source_session_id = NULLIF(
             current_setting('localmind.ai_session_purge_id', true), ''
           )
           OR NULLIF(
             current_setting('localmind.work_order_user_delete_actor', true), ''
           ) IS NOT NULL
         )
       )
       OR (
         NEW.sender_id IS NULL
         AND OLD.sender_id = NULLIF(
           current_setting('localmind.work_order_user_delete_actor', true), ''
         )
       )
     ) THEN
    RETURN NEW;
  END IF;
  IF NEW.sender_id IS NULL OR NEW.source_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM ai_sessions_metadata s
    WHERE s.id = NEW.source_session_id
      AND s.user_id = NEW.sender_id
      AND s.scope_type IN ('workspace', 'project')
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Work order dispatch must belong to an active source conversation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_dispatch_owner_guard
  BEFORE INSERT OR UPDATE OF source_session_id, sender_id
  ON work_order_dispatches FOR EACH ROW
  EXECUTE FUNCTION work_order_assert_dispatch();

CREATE FUNCTION work_order_assert_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       (
         NEW.source_session_id IS NULL
         AND OLD.source_session_id IS NOT NULL
         AND (
           OLD.source_session_id = NULLIF(
             current_setting('localmind.ai_session_purge_id', true), ''
           )
           OR NULLIF(
             current_setting('localmind.work_order_user_delete_actor', true), ''
           ) IS NOT NULL
         )
       )
       OR (
         NEW.sender_id IS NULL
         AND OLD.sender_id = NULLIF(
           current_setting('localmind.work_order_user_delete_actor', true), ''
         )
       )
       OR (
         NEW.recipient_id IS NULL
         AND OLD.recipient_id = NULLIF(
           current_setting('localmind.work_order_user_delete_actor', true), ''
         )
       )
     ) THEN
    RETURN NEW;
  END IF;
  IF NEW.sender_id IS NULL OR NEW.recipient_id IS NULL OR NEW.source_session_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM work_order_dispatches d
       WHERE d.id = NEW.dispatch_id
         AND d.sender_id = NEW.sender_id
         AND d.source_session_id = NEW.source_session_id
         AND d.status = 'confirmed'
     ) THEN
    RAISE EXCEPTION 'Work order identity must match a confirmed dispatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.related_work_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_orders parent
    WHERE parent.id = NEW.related_work_order_id
      AND parent.source_session_id = NEW.source_session_id
      AND parent.sender_id = NEW.sender_id
  ) THEN
    RAISE EXCEPTION 'Supplemental work order must keep the source conversation and sender'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_identity_guard
  BEFORE INSERT OR UPDATE OF dispatch_id, source_session_id, sender_id, recipient_id, related_work_order_id
  ON work_orders FOR EACH ROW EXECUTE FUNCTION work_order_assert_identity();

CREATE FUNCTION work_order_assert_session_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.owner_user_id_snapshot <> NEW.owner_user_id OR NOT EXISTS (
    SELECT 1
    FROM work_orders w
    JOIN ai_sessions_metadata s ON s.id = NEW.session_id
    WHERE w.id = NEW.work_order_id
      AND w.recipient_id = NEW.owner_user_id
      AND s.user_id = NEW.owner_user_id
      AND s.scope_type = 'work_order'
      AND s.workspace_id IS NULL
      AND s.selected_context_project_id IS NULL
      AND s.parent_session_id IS NULL
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Work order session binding must match its recipient and private scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_session_binding_guard
  BEFORE INSERT OR UPDATE ON work_order_session_bindings
  FOR EACH ROW EXECUTE FUNCTION work_order_assert_session_binding();

CREATE FUNCTION work_order_assert_delivery_submitter() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.submitted_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.id = NEW.work_order_id
      AND w.recipient_id = NEW.submitted_by
      AND w.status IN ('open', 'validating', 'delivered')
      AND w.requirements_fingerprint = NEW.requirements_fingerprint
  ) THEN
    RAISE EXCEPTION 'Delivery must match the recipient and frozen requirements'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_delivery_submitter_guard
  BEFORE INSERT ON work_order_delivery_revisions
  FOR EACH ROW EXECUTE FUNCTION work_order_assert_delivery_submitter();

CREATE FUNCTION work_order_immutable_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'Work order evidence is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER work_order_requirements_immutable
  BEFORE UPDATE OR DELETE ON work_order_requirements
  FOR EACH ROW EXECUTE FUNCTION work_order_immutable_row();
CREATE FUNCTION work_order_delivery_revision_immutable_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.submitted_by = NULLIF(
       current_setting('localmind.work_order_user_delete_actor', true), ''
     )
     AND NEW.submitted_by IS NULL
     AND ROW(OLD.id, OLD.work_order_id, OLD.revision,
             OLD.requirements_fingerprint, OLD.receipt_fingerprint,
             OLD.validation_evidence, OLD.submitted_at)
         IS NOT DISTINCT FROM
         ROW(NEW.id, NEW.work_order_id, NEW.revision,
             NEW.requirements_fingerprint, NEW.receipt_fingerprint,
             NEW.validation_evidence, NEW.submitted_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Work order delivery evidence is immutable'
    USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER work_order_delivery_revisions_immutable
  BEFORE UPDATE OR DELETE ON work_order_delivery_revisions
  FOR EACH ROW EXECUTE FUNCTION work_order_delivery_revision_immutable_row();
CREATE TRIGGER work_order_delivery_items_immutable
  BEFORE UPDATE OR DELETE ON work_order_delivery_items
  FOR EACH ROW EXECUTE FUNCTION work_order_immutable_row();
CREATE FUNCTION work_order_event_immutable_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.actor_id = NULLIF(
       current_setting('localmind.work_order_user_delete_actor', true), ''
     )
     AND NEW.actor_id IS NULL
     AND ROW(OLD.id, OLD.work_order_id, OLD.event_type, OLD.version,
             OLD.payload, OLD.event_fingerprint, OLD.created_at)
         IS NOT DISTINCT FROM
         ROW(NEW.id, NEW.work_order_id, NEW.event_type, NEW.version,
             NEW.payload, NEW.event_fingerprint, NEW.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Work order event evidence is immutable'
    USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER work_order_events_immutable
  BEFORE UPDATE OR DELETE ON work_order_events
  FOR EACH ROW EXECUTE FUNCTION work_order_event_immutable_row();
CREATE FUNCTION work_order_adoption_immutable_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       OLD.source_session_id IS NOT DISTINCT FROM NEW.source_session_id
       OR (OLD.source_session_id IS NOT NULL AND NEW.source_session_id IS NULL)
     )
     AND (
       OLD.actor_id IS NOT DISTINCT FROM NEW.actor_id
       OR (
         OLD.actor_id = NULLIF(
           current_setting('localmind.work_order_user_delete_actor', true), ''
         )
         AND NEW.actor_id IS NULL
       )
     )
     AND ROW(OLD.id, OLD.source_session_id_snapshot,
             OLD.context_version, OLD.request_key,
             OLD.revision_set_fingerprint, OLD.created_at)
         IS NOT DISTINCT FROM
         ROW(NEW.id, NEW.source_session_id_snapshot,
             NEW.context_version, NEW.request_key,
             NEW.revision_set_fingerprint, NEW.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Work order adoption evidence is immutable'
    USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER work_order_adoptions_immutable
  BEFORE UPDATE OR DELETE ON work_order_adoptions
  FOR EACH ROW EXECUTE FUNCTION work_order_adoption_immutable_row();
CREATE TRIGGER work_order_adoption_items_immutable
  BEFORE UPDATE OR DELETE ON work_order_adoption_items
  FOR EACH ROW EXECUTE FUNCTION work_order_immutable_row();

CREATE FUNCTION work_order_blob_content_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (
       OLD.owner_id IS NOT DISTINCT FROM NEW.owner_id
       OR (
         OLD.owner_id = NULLIF(
           current_setting('localmind.work_order_user_delete_actor', true), ''
         )
         AND NEW.owner_id IS NULL
       )
     )
     OR ROW(OLD.work_order_id, OLD.requirement_id, OLD.request_key, OLD.key, OLD.file_name, OLD.mime_type,
         OLD.byte_size, OLD.fingerprint, OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.work_order_id, NEW.requirement_id, NEW.request_key, NEW.key, NEW.file_name, NEW.mime_type,
         NEW.byte_size, NEW.fingerprint, NEW.created_at) THEN
    RAISE EXCEPTION 'Work order Blob identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'delivered' AND NEW.status <> 'delivered' THEN
    RAISE EXCEPTION 'Delivered work order Blob cannot be demoted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER work_order_blob_content_guard BEFORE UPDATE ON work_order_blobs
  FOR EACH ROW EXECUTE FUNCTION work_order_blob_content_immutable();

CREATE FUNCTION work_order_event_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND ROW(OLD.status, OLD.version, OLD.terminal_reason, OLD.completed_at)
       IS DISTINCT FROM
       ROW(NEW.status, NEW.version, NEW.terminal_reason, NEW.completed_at)
     AND NOT EXISTS (
       SELECT 1 FROM work_order_events event
       WHERE event.work_order_id = NEW.id
         AND event.version = NEW.version
         AND event.created_at >= OLD.updated_at
     ) THEN
    RAISE EXCEPTION 'Work order state change requires an immutable event'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND ROW(OLD.status, OLD.version, OLD.terminal_reason, OLD.completed_at)
       IS DISTINCT FROM
       ROW(NEW.status, NEW.version, NEW.terminal_reason, NEW.completed_at)
     AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Work order version must advance by one' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'cancelled'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Cancelled work order cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'refused'
     AND NEW.status NOT IN ('refused', 'cancelled') THEN
    RAISE EXCEPTION 'Refused work order may only be explicitly withdrawn'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'delivered'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Delivered work order cannot be cancelled or refused'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER work_order_event_required_guard
  AFTER UPDATE ON work_orders DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION work_order_event_required();

CREATE FUNCTION work_order_delivery_complete_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE missing_required integer;
BEGIN
  SELECT count(*) INTO missing_required
  FROM work_order_requirements requirement
  WHERE requirement.work_order_id = NEW.work_order_id
    AND requirement.required
    AND NOT EXISTS (
      SELECT 1 FROM work_order_delivery_items item
      WHERE item.delivery_revision_id = NEW.id
        AND item.requirement_id = requirement.id
        AND (
          (requirement.kind = 'text' AND length(btrim(item.text_value)) > 0)
          OR (requirement.kind = 'file' AND item.blob_id IS NOT NULL)
        )
    );
  IF missing_required > 0 THEN
    RAISE EXCEPTION 'Delivery revision is missing required items'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER work_order_delivery_complete_guard
  AFTER INSERT ON work_order_delivery_revisions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION work_order_delivery_complete_guard();

-- Extend Agent Runtime owner snapshots from Workspace/Project to
-- Workspace/Project/WorkOrder. All three descendants retain composite FKs.
ALTER TABLE ai_agent_runs ADD COLUMN work_order_id varchar
  REFERENCES work_orders(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE ai_agent_steps ADD COLUMN work_order_id varchar;
ALTER TABLE ai_agent_timeline_events ADD COLUMN work_order_id varchar;
ALTER TABLE ai_agent_runtime_execution_results ADD COLUMN work_order_id varchar;

ALTER TABLE ai_agent_runs DROP CONSTRAINT ai_agent_runs_owner_check;
ALTER TABLE ai_agent_steps DROP CONSTRAINT ai_agent_steps_owner_check;
ALTER TABLE ai_agent_timeline_events DROP CONSTRAINT ai_agent_timeline_events_owner_check;
ALTER TABLE ai_agent_runtime_execution_results DROP CONSTRAINT ai_agent_results_owner_check;
ALTER TABLE ai_agent_runs ADD CONSTRAINT ai_agent_runs_owner_check
  CHECK (num_nonnulls(workspace_id, project_id, work_order_id) = 1);
ALTER TABLE ai_agent_steps ADD CONSTRAINT ai_agent_steps_owner_check
  CHECK (num_nonnulls(workspace_id, project_id, work_order_id) = 1);
ALTER TABLE ai_agent_timeline_events ADD CONSTRAINT ai_agent_timeline_events_owner_check
  CHECK (num_nonnulls(workspace_id, project_id, work_order_id) = 1);
ALTER TABLE ai_agent_runtime_execution_results ADD CONSTRAINT ai_agent_results_owner_check
  CHECK (num_nonnulls(workspace_id, project_id, work_order_id) = 1);

ALTER TABLE ai_agent_runs
  ADD CONSTRAINT ai_agent_runs_work_order_snapshot_key
    UNIQUE(id, work_order_id, actor_id),
  ADD CONSTRAINT ai_agent_runs_work_order_source_snapshot_key
    UNIQUE(id, work_order_id, actor_id, workflow, source_type, source_id);
CREATE UNIQUE INDEX ai_agent_runs_work_order_source_key
  ON ai_agent_runs(work_order_id, source_type, source_id);
CREATE INDEX ai_agent_runs_work_order_status_updated_idx
  ON ai_agent_runs(work_order_id, status, updated_at);

ALTER TABLE ai_agent_steps
  ADD CONSTRAINT ai_agent_steps_work_order_snapshot_fkey
    FOREIGN KEY(run_id, work_order_id, actor_id)
    REFERENCES ai_agent_runs(id, work_order_id, actor_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT ai_agent_steps_work_order_timeline_snapshot_key
    UNIQUE(id, run_id, work_order_id, actor_id);
ALTER TABLE ai_agent_timeline_events
  ADD CONSTRAINT ai_agent_timeline_events_work_order_snapshot_fkey
    FOREIGN KEY(run_id, work_order_id, actor_id)
    REFERENCES ai_agent_runs(id, work_order_id, actor_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT ai_agent_timeline_work_order_step_fkey
    FOREIGN KEY(step_id, run_id, work_order_id, actor_id)
    REFERENCES ai_agent_steps(id, run_id, work_order_id, actor_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ai_agent_runtime_execution_results
  ADD CONSTRAINT ai_agent_results_work_order_snapshot_fkey
    FOREIGN KEY(run_id, work_order_id, actor_id)
    REFERENCES ai_agent_runs(id, work_order_id, actor_id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT ai_agent_results_work_order_source_fkey
    FOREIGN KEY(run_id, work_order_id, actor_id, workflow, source_type, source_id)
    REFERENCES ai_agent_runs(id, work_order_id, actor_id, workflow, source_type, source_id)
    ON DELETE CASCADE ON UPDATE RESTRICT;
CREATE UNIQUE INDEX ai_agent_results_work_order_fingerprint_key
  ON ai_agent_runtime_execution_results(work_order_id, result_fingerprint);

CREATE OR REPLACE FUNCTION ai_agent_project_owner_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(OLD.workspace_id, OLD.project_id, OLD.work_order_id)
     IS DISTINCT FROM ROW(NEW.workspace_id, NEW.project_id, NEW.work_order_id) THEN
    RAISE EXCEPTION 'Agent Runtime owner is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_agent_run_assert_session_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM ai_sessions_metadata session
    LEFT JOIN work_order_session_bindings binding
      ON binding.session_id = session.id
    WHERE session.id = NEW.session_id
      AND session.user_id = NEW.actor_id
      AND (
        (NEW.workspace_id IS NOT NULL
          AND session.scope_type = 'workspace'
          AND session.workspace_id = NEW.workspace_id)
        OR (NEW.project_id IS NOT NULL
          AND session.scope_type = 'project'
          AND session.workspace_id IS NULL
          AND session.selected_context_project_id = NEW.project_id)
        OR (NEW.work_order_id IS NOT NULL
          AND session.scope_type = 'work_order'
          AND binding.work_order_id = NEW.work_order_id
          AND binding.owner_user_id = NEW.actor_id)
      )
  ) THEN
    RAISE EXCEPTION 'Agent run session must match its actor and resource owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER ai_agent_runs_session_scope_guard ON ai_agent_runs;
CREATE TRIGGER ai_agent_runs_session_scope_guard
  BEFORE INSERT OR UPDATE OF session_id, actor_id, workspace_id, project_id, work_order_id
  ON ai_agent_runs FOR EACH ROW EXECUTE FUNCTION ai_agent_run_assert_session_scope();

ALTER TABLE ai_agent_steps DROP CONSTRAINT ai_agent_step_input_check;
ALTER TABLE ai_agent_steps ADD CONSTRAINT ai_agent_step_input_check CHECK (
  input IS NULL OR (
    (project_id IS NOT NULL OR work_order_id IS NOT NULL)
    AND jsonb_typeof(input) = 'object'
    AND octet_length(input::text) <= 2097152
  )
);
ALTER TABLE ai_agent_runtime_execution_results
  DROP CONSTRAINT ai_agent_runtime_execution_results_side_effect_mode_check;
ALTER TABLE ai_agent_runtime_execution_results
  ADD CONSTRAINT ai_agent_runtime_execution_results_side_effect_mode_check CHECK (
    side_effect_mode IN ('none', 'workspace_write', 'project_write', 'work_order_write', 'external_tool')
    AND (side_effect_mode <> 'project_write' OR project_id IS NOT NULL)
    AND (side_effect_mode <> 'work_order_write' OR work_order_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION ai_agent_runtime_adapter_resolution_snapshot_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, public
AS $$
  SELECT COALESCE(
    jsonb_typeof(value) = 'object'
    AND jsonb_typeof(value->'workflow') = 'string'
    AND length(btrim(value->>'workflow')) BETWEEN 1 AND 512
    AND ai_agent_runtime_adapter_resolution_step_types_valid(
      value->'supportedStepTypes'
    )
    AND jsonb_typeof(value->'sideEffectMode') = 'string'
    AND btrim(value->>'sideEffectMode') IN (
      'none', 'workspace_write', 'project_write', 'work_order_write',
      'external_tool'
    ),
    false
  );
$$;

ALTER TABLE ai_agent_runtime_execution_results
  DROP CONSTRAINT ai_agent_runtime_execution_results_status_payload_check;
ALTER TABLE ai_agent_runtime_execution_results
  ADD CONSTRAINT ai_agent_runtime_execution_results_status_payload_check CHECK (
    (
      result_status = 'completed'
      AND executor = 'agent_runtime_record_only_adapter'
      AND adapter_workflow = 'agent_runtime_record_only'
      AND side_effect_mode = 'none'
      AND side_effects_applied = false
      AND failure_code IS NULL
      AND failure_message IS NULL
      AND NOT (result_payload ? 'failureCode')
      AND NOT (result_payload ? 'failureMessage')
    )
    OR (
      result_status = 'completed'
      AND executor = 'agent_runtime_worker'
      AND adapter_workflow = workflow
      AND failure_code IS NULL
      AND failure_message IS NULL
      AND NOT (result_payload ? 'failureCode')
      AND NOT (result_payload ? 'failureMessage')
      AND jsonb_typeof(result_payload->'sideEffectsApplied') = 'boolean'
      AND (result_payload->>'sideEffectsApplied')::boolean = side_effects_applied
      AND (
        (
          side_effects_applied = false
          AND NOT (result_payload ? 'sideEffectSummary')
        )
        OR (
          side_effects_applied = true
          AND side_effect_mode IN (
            'workspace_write', 'project_write', 'work_order_write',
            'external_tool'
          )
          AND jsonb_typeof(result_payload->'sideEffectSummary') = 'object'
        )
      )
      AND ai_agent_runtime_adapter_resolution_valid(
        result_payload->'adapterResolution'
      )
      AND btrim(result_payload->'adapterResolution'->>'status') = 'completed'
      AND btrim(result_payload->'adapterResolution'->>'workflow') = workflow
      AND btrim(
        result_payload->'adapterResolution'->'adapter'->>'workflow'
      ) = adapter_workflow
      AND btrim(
        result_payload->'adapterResolution'->'adapter'->>'sideEffectMode'
      ) = side_effect_mode
    )
    OR (
      result_status = 'failed'
      AND executor IN (
        'agent_runtime_stale_recovery_worker', 'agent_runtime_worker'
      )
      AND (
        executor <> 'agent_runtime_stale_recovery_worker'
        OR (
          adapter_workflow = workflow
          AND side_effect_mode = 'none'
          AND failure_code = 'stale_worker_lease'
        )
      )
      AND side_effects_applied = false
      AND failure_code IS NOT NULL
      AND failure_message IS NOT NULL
      AND jsonb_typeof(result_payload->'failureCode') = 'string'
      AND btrim(result_payload->>'failureCode') = failure_code
      AND jsonb_typeof(result_payload->'failureMessage') = 'string'
      AND btrim(result_payload->>'failureMessage') = btrim(failure_message)
      AND (
        NOT (result_payload ? 'adapterResolution')
        OR (
          ai_agent_runtime_adapter_resolution_valid(
            result_payload->'adapterResolution'
          )
          AND btrim(result_payload->'adapterResolution'->>'status') IN (
            'unsupported_workflow', 'unsupported_contract',
            'execution_failed', 'invalid_executor_result',
            'incomplete_execution'
          )
        )
      )
    )
  );

CREATE FUNCTION ai_agent_work_order_terminal_receipt_required() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.work_order_id IS NOT NULL
     AND NEW.status IN ('completed', 'failed')
     AND NOT EXISTS (
       SELECT 1
       FROM ai_agent_runtime_execution_results result
       WHERE result.run_id = NEW.id
         AND result.work_order_id = NEW.work_order_id
         AND result.workspace_id IS NULL
         AND result.project_id IS NULL
         AND result.actor_id = NEW.actor_id
         AND result.worker_attempt = NEW.worker_attempt
         AND result.result_status = NEW.status
         AND result.completed_at = NEW.completed_at
         AND result.failure_code IS NOT DISTINCT FROM NEW.failure_code
         AND result.failure_message IS NOT DISTINCT FROM NEW.failure_message
     ) THEN
    RAISE EXCEPTION
      'Work-order Agent Runtime terminal state requires an immutable execution receipt'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER ai_agent_work_order_terminal_receipt_guard
  AFTER INSERT OR UPDATE ON ai_agent_runs DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_agent_work_order_terminal_receipt_required();

CREATE FUNCTION work_order_account_delete_prepare() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM set_config('localmind.work_order_user_delete_actor', OLD.id, true);
  DELETE FROM work_order_session_bindings WHERE owner_user_id = OLD.id;
  DELETE FROM ai_agent_runs
    WHERE work_order_id IS NOT NULL AND actor_id = OLD.id;
  INSERT INTO work_order_events(
    work_order_id, actor_id, event_type, version, payload, event_fingerprint
  )
  SELECT id, NULL, 'participant_account_deleted', version + 1,
    jsonb_build_object(
      'reason', 'account_deleted',
      'role', CASE WHEN sender_id = OLD.id THEN 'sender' ELSE 'recipient' END
    ),
    encode(sha256(convert_to(
      id || ':' || (version + 1)::text || ':account_deleted', 'UTF8'
    )), 'hex')
  FROM work_orders
  WHERE (sender_id = OLD.id OR recipient_id = OLD.id)
    AND status NOT IN ('delivered', 'refused', 'cancelled')
  ON CONFLICT DO NOTHING;
  INSERT INTO work_order_outbox(
    work_order_id, event_id, recipient_id, topic
  )
  SELECT order_row.id, event_row.id,
    CASE WHEN order_row.sender_id = OLD.id
      THEN order_row.recipient_id ELSE order_row.sender_id END,
    'work-order.account-deleted'
  FROM work_orders order_row
  JOIN work_order_events event_row
    ON event_row.work_order_id = order_row.id
   AND event_row.version = order_row.version + 1
   AND event_row.event_type = 'participant_account_deleted'
  WHERE (order_row.sender_id = OLD.id OR order_row.recipient_id = OLD.id)
    AND order_row.status NOT IN ('delivered', 'refused', 'cancelled')
    AND CASE WHEN order_row.sender_id = OLD.id
      THEN order_row.recipient_id ELSE order_row.sender_id END IS NOT NULL
  ON CONFLICT DO NOTHING;
  UPDATE work_orders
    SET status = 'cancelled', version = version + 1,
        terminal_reason = 'account_deleted', completed_at = now(), updated_at = now()
    WHERE (sender_id = OLD.id OR recipient_id = OLD.id)
      AND status NOT IN ('delivered', 'refused', 'cancelled');
  UPDATE work_order_blobs
    SET status = CASE WHEN status = 'staged' THEN
          CASE WHEN EXISTS (
            SELECT 1 FROM localmind_log_policies
            WHERE id = 'default' AND (legal_hold OR retention_frozen)
          ) THEN 'held' ELSE 'deleted' END
        ELSE status END,
        expires_at = CASE WHEN status = 'staged' THEN now() ELSE expires_at END
    WHERE owner_id = OLD.id;
  RETURN OLD;
END;
$$;
-- Runs before ai_context_cleanup_user_context_before_delete (trigger names are
-- ordered alphabetically) so the restrictive private-session binding is gone
-- before the existing account cleanup removes the owned session.
CREATE TRIGGER a_work_order_account_delete_guard
  BEFORE DELETE ON users FOR EACH ROW
  EXECUTE FUNCTION work_order_account_delete_prepare();
