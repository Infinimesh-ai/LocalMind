CREATE OR REPLACE FUNCTION ai_registry_revision_publish_history_required(
  revision_id text,
  revision_family text,
  revision_scope_type text,
  revision_workspace_id text,
  revision_actor_id text,
  revision_status text,
  revision_revision text,
  revision_fingerprint text,
  revision_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NOT (
      jsonb_typeof(revision_metadata) = 'object'
      AND revision_scope_type = 'workspace'
      AND revision_workspace_id IS NOT NULL
      AND revision_actor_id IS NOT NULL
      AND revision_status = 'active'
      AND (
        (
          jsonb_typeof(revision_metadata->'publishSource') = 'string'
          AND btrim(revision_metadata->>'publishSource') = 'graphql_mutation'
        )
        OR (
          jsonb_typeof(revision_metadata->'publishSource') = 'string'
          AND btrim(revision_metadata->>'publishSource') =
            'repair_execution_worker'
          AND jsonb_typeof(revision_metadata->'executionRequestId') = 'string'
          AND revision_revision =
            'repair-' || btrim(revision_metadata->>'executionRequestId')
          AND (
            (
              revision_family = 'prompt_registry'
              AND revision_id =
                'prompt-revision-' ||
                btrim(revision_metadata->>'executionRequestId')
            )
            OR (
              revision_family = 'task_route_policy'
              AND revision_id =
                'task-route-policy-revision-' ||
                btrim(revision_metadata->>'executionRequestId')
            )
            OR (
              revision_family = 'model_registry'
              AND revision_id =
                'model-registry-revision-' ||
                btrim(revision_metadata->>'executionRequestId')
            )
            OR (
              revision_family = 'provider_registry'
              AND revision_id =
                'provider-registry-revision-' ||
                btrim(revision_metadata->>'executionRequestId')
            )
          )
        )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM "ai_registry_revision_publish_events" event
      WHERE event."revision_id" = revision_id
        AND event."registry_family" = revision_family
        AND event."event_type" = 'revision_published'
        AND event."scope_type" IS NOT DISTINCT FROM revision_scope_type
        AND event."workspace_id" IS NOT DISTINCT FROM revision_workspace_id
        AND event."actor_id" IS NOT DISTINCT FROM revision_actor_id
        AND event."revision" IS NOT DISTINCT FROM revision_revision
        AND event."revision_fingerprint" IS NOT DISTINCT FROM
          revision_fingerprint
        AND event."revision_status" IS NOT DISTINCT FROM revision_status
        AND event."publish_source" IS NOT DISTINCT FROM
          btrim(revision_metadata->>'publishSource')
    ),
    true
  );
$$;

CREATE OR REPLACE FUNCTION ai_registry_publish_event_reuse_history_required(
  event_revision_id text,
  event_registry_family text,
  event_scope_type text,
  event_workspace_id text,
  event_actor_id text,
  event_revision text,
  event_revision_fingerprint text,
  event_revision_status text,
  event_type text,
  event_publish_source text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    event_type <> 'revision_reused'
    OR EXISTS (
      SELECT 1
      FROM "ai_registry_revision_publish_events" published
      WHERE published."revision_id" = event_revision_id
        AND published."registry_family" = event_registry_family
        AND published."event_type" = 'revision_published'
        AND published."scope_type" IS NOT DISTINCT FROM event_scope_type
        AND published."workspace_id" IS NOT DISTINCT FROM event_workspace_id
        AND published."actor_id" IS NOT DISTINCT FROM event_actor_id
        AND published."revision" IS NOT DISTINCT FROM event_revision
        AND published."revision_fingerprint" IS NOT DISTINCT FROM
          event_revision_fingerprint
        AND published."revision_status" IS NOT DISTINCT FROM
          event_revision_status
        AND published."publish_source" IS NOT DISTINCT FROM
          event_publish_source
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION ai_prompt_registry_revision_publish_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."revision" IS NOT DISTINCT FROM NEW."revision"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."fingerprint" IS NOT DISTINCT FROM NEW."fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF NOT ai_registry_revision_publish_history_required(
    NEW."id",
    'prompt_registry',
    NEW."scope_type",
    NEW."workspace_id",
    NEW."actor_id",
    NEW."status",
    NEW."revision",
    NEW."fingerprint",
    NEW."metadata"
  ) THEN
    RAISE EXCEPTION
      'ai_prompt_registry_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_prompt_registry_revisions_publish_history_required_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ai_task_route_policy_revision_publish_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."revision" IS NOT DISTINCT FROM NEW."revision"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."fingerprint" IS NOT DISTINCT FROM NEW."fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF NOT ai_registry_revision_publish_history_required(
    NEW."id",
    'task_route_policy',
    NEW."scope_type",
    NEW."workspace_id",
    NEW."actor_id",
    NEW."status",
    NEW."revision",
    NEW."fingerprint",
    NEW."metadata"
  ) THEN
    RAISE EXCEPTION
      'ai_task_route_policy_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_task_route_policy_revisions_publish_history_required_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ai_model_registry_revision_publish_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."revision" IS NOT DISTINCT FROM NEW."revision"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."fingerprint" IS NOT DISTINCT FROM NEW."fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF NOT ai_registry_revision_publish_history_required(
    NEW."id",
    'model_registry',
    NEW."scope_type",
    NEW."workspace_id",
    NEW."actor_id",
    NEW."status",
    NEW."revision",
    NEW."fingerprint",
    NEW."metadata"
  ) THEN
    RAISE EXCEPTION
      'ai_model_registry_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_model_registry_revisions_publish_history_required_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ai_provider_registry_revision_publish_history_required()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."revision" IS NOT DISTINCT FROM NEW."revision"
     AND OLD."status" IS NOT DISTINCT FROM NEW."status"
     AND OLD."fingerprint" IS NOT DISTINCT FROM NEW."fingerprint"
     AND OLD."metadata" IS NOT DISTINCT FROM NEW."metadata" THEN
    RETURN NEW;
  END IF;

  IF NOT ai_registry_revision_publish_history_required(
    NEW."id",
    'provider_registry',
    NEW."scope_type",
    NEW."workspace_id",
    NEW."actor_id",
    NEW."status",
    NEW."revision",
    NEW."fingerprint",
    NEW."metadata"
  ) THEN
    RAISE EXCEPTION
      'ai_provider_registry_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_provider_registry_revisions_publish_history_required_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ai_registry_publish_event_history_required()
RETURNS trigger AS $$
DECLARE
  check_revision_id text;
  check_family text;
  parent_revision_exists boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    check_revision_id := OLD."revision_id";
    check_family := OLD."registry_family";
  ELSE
    check_revision_id := NEW."revision_id";
    check_family := NEW."registry_family";
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."revision_id" IS NOT DISTINCT FROM NEW."revision_id"
     AND OLD."registry_family" IS NOT DISTINCT FROM NEW."registry_family"
     AND OLD."scope_type" IS NOT DISTINCT FROM NEW."scope_type"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."revision" IS NOT DISTINCT FROM NEW."revision"
     AND OLD."revision_fingerprint" IS NOT DISTINCT FROM
       NEW."revision_fingerprint"
     AND OLD."revision_status" IS NOT DISTINCT FROM NEW."revision_status"
     AND OLD."event_type" IS NOT DISTINCT FROM NEW."event_type"
     AND OLD."publish_source" IS NOT DISTINCT FROM NEW."publish_source" THEN
    RETURN NEW;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NOT ai_registry_publish_event_reuse_history_required(
       NEW."revision_id",
       NEW."registry_family",
       NEW."scope_type",
       NEW."workspace_id",
       NEW."actor_id",
       NEW."revision",
       NEW."revision_fingerprint",
       NEW."revision_status",
       NEW."event_type",
       NEW."publish_source"
     ) THEN
    RAISE EXCEPTION
      'ai_registry_revision_publish_events_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_registry_revision_publish_events_history_required_check';
  END IF;

  parent_revision_exists := (
    (
      check_family = 'prompt_registry'
      AND EXISTS (
        SELECT 1
        FROM "ai_prompt_registry_revisions" revision
        WHERE revision."id" = check_revision_id
      )
    )
    OR (
      check_family = 'task_route_policy'
      AND EXISTS (
        SELECT 1
        FROM "ai_task_route_policy_revisions" revision
        WHERE revision."id" = check_revision_id
      )
    )
    OR (
      check_family = 'model_registry'
      AND EXISTS (
        SELECT 1
        FROM "ai_model_registry_revisions" revision
        WHERE revision."id" = check_revision_id
      )
    )
    OR (
      check_family = 'provider_registry'
      AND EXISTS (
        SELECT 1
        FROM "ai_provider_registry_revisions" revision
        WHERE revision."id" = check_revision_id
      )
    )
  );

  IF TG_OP = 'DELETE'
     AND parent_revision_exists
     AND EXISTS (
       SELECT 1
       FROM "ai_registry_revision_publish_events" reused
       WHERE reused."revision_id" = OLD."revision_id"
         AND reused."registry_family" = OLD."registry_family"
         AND reused."event_type" = 'revision_reused'
         AND reused."scope_type" IS NOT DISTINCT FROM OLD."scope_type"
         AND reused."workspace_id" IS NOT DISTINCT FROM OLD."workspace_id"
         AND reused."actor_id" IS NOT DISTINCT FROM OLD."actor_id"
         AND reused."revision" IS NOT DISTINCT FROM OLD."revision"
         AND reused."revision_fingerprint" IS NOT DISTINCT FROM
           OLD."revision_fingerprint"
         AND reused."revision_status" IS NOT DISTINCT FROM
           OLD."revision_status"
         AND reused."publish_source" IS NOT DISTINCT FROM
           OLD."publish_source"
         AND NOT ai_registry_publish_event_reuse_history_required(
           reused."revision_id",
           reused."registry_family",
           reused."scope_type",
           reused."workspace_id",
           reused."actor_id",
           reused."revision",
           reused."revision_fingerprint",
           reused."revision_status",
           reused."event_type",
           reused."publish_source"
         )
     ) THEN
    RAISE EXCEPTION
      'ai_registry_revision_publish_events_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_registry_revision_publish_events_history_required_check';
  END IF;

  IF check_family = 'prompt_registry'
     AND EXISTS (
       SELECT 1
       FROM "ai_prompt_registry_revisions" revision
       WHERE revision."id" = check_revision_id
         AND NOT ai_registry_revision_publish_history_required(
           revision."id",
           'prompt_registry',
           revision."scope_type",
           revision."workspace_id",
           revision."actor_id",
           revision."status",
           revision."revision",
           revision."fingerprint",
           revision."metadata"
         )
     ) THEN
    RAISE EXCEPTION
      'ai_prompt_registry_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_prompt_registry_revisions_publish_history_required_check';
  END IF;

  IF check_family = 'task_route_policy'
     AND EXISTS (
       SELECT 1
       FROM "ai_task_route_policy_revisions" revision
       WHERE revision."id" = check_revision_id
         AND NOT ai_registry_revision_publish_history_required(
           revision."id",
           'task_route_policy',
           revision."scope_type",
           revision."workspace_id",
           revision."actor_id",
           revision."status",
           revision."revision",
           revision."fingerprint",
           revision."metadata"
         )
     ) THEN
    RAISE EXCEPTION
      'ai_task_route_policy_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_task_route_policy_revisions_publish_history_required_check';
  END IF;

  IF check_family = 'model_registry'
     AND EXISTS (
       SELECT 1
       FROM "ai_model_registry_revisions" revision
       WHERE revision."id" = check_revision_id
         AND NOT ai_registry_revision_publish_history_required(
           revision."id",
           'model_registry',
           revision."scope_type",
           revision."workspace_id",
           revision."actor_id",
           revision."status",
           revision."revision",
           revision."fingerprint",
           revision."metadata"
         )
     ) THEN
    RAISE EXCEPTION
      'ai_model_registry_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_model_registry_revisions_publish_history_required_check';
  END IF;

  IF check_family = 'provider_registry'
     AND EXISTS (
       SELECT 1
       FROM "ai_provider_registry_revisions" revision
       WHERE revision."id" = check_revision_id
         AND NOT ai_registry_revision_publish_history_required(
           revision."id",
           'provider_registry',
           revision."scope_type",
           revision."workspace_id",
           revision."actor_id",
           revision."status",
           revision."revision",
           revision."fingerprint",
           revision."metadata"
         )
     ) THEN
    RAISE EXCEPTION
      'ai_provider_registry_revisions_publish_history_required_check'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'ai_provider_registry_revisions_publish_history_required_check';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
  "zz_ai_prompt_reg_revisions_publish_history_required_check"
AFTER INSERT OR UPDATE OF
  "scope_type",
  "workspace_id",
  "actor_id",
  "revision",
  "status",
  "fingerprint",
  "metadata"
ON "ai_prompt_registry_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_prompt_registry_revision_publish_history_required();

CREATE CONSTRAINT TRIGGER
  "zz_ai_task_route_revisions_publish_history_required_check"
AFTER INSERT OR UPDATE OF
  "scope_type",
  "workspace_id",
  "actor_id",
  "revision",
  "status",
  "fingerprint",
  "metadata"
ON "ai_task_route_policy_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_task_route_policy_revision_publish_history_required();

CREATE CONSTRAINT TRIGGER
  "zz_ai_model_reg_revisions_publish_history_required_check"
AFTER INSERT OR UPDATE OF
  "scope_type",
  "workspace_id",
  "actor_id",
  "revision",
  "status",
  "fingerprint",
  "metadata"
ON "ai_model_registry_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_model_registry_revision_publish_history_required();

CREATE CONSTRAINT TRIGGER
  "zz_ai_provider_reg_revisions_publish_history_required_check"
AFTER INSERT OR UPDATE OF
  "scope_type",
  "workspace_id",
  "actor_id",
  "revision",
  "status",
  "fingerprint",
  "metadata"
ON "ai_provider_registry_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_provider_registry_revision_publish_history_required();

CREATE CONSTRAINT TRIGGER
  "zz_ai_registry_publish_events_history_required_check"
AFTER INSERT OR UPDATE OR DELETE
ON "ai_registry_revision_publish_events"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ai_registry_publish_event_history_required();
