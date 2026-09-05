ALTER TABLE "ai_context_projects"
  ADD COLUMN "ai_policy" VARCHAR NOT NULL DEFAULT 'read_only',
  ADD COLUMN "ai_policy_updated_by_user_id" VARCHAR,
  ADD COLUMN "ai_policy_updated_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "ai_context_projects_ai_policy_check"
    CHECK ("ai_policy" IN ('read_only', 'read_write')),
  ADD CONSTRAINT "ai_context_projects_ai_policy_audit_shape_check"
    CHECK (
      "ai_policy_updated_by_user_id" IS NULL OR
      "ai_policy_updated_at" IS NOT NULL
    );

ALTER TABLE "ai_context_projects"
  ADD CONSTRAINT "ai_context_projects_ai_policy_updated_by_user_id_fkey"
  FOREIGN KEY ("ai_policy_updated_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_context_projects_ai_policy_updated_by_user_id_idx"
  ON "ai_context_projects"("ai_policy_updated_by_user_id");

ALTER TABLE "ai_context_project_docs"
  ADD COLUMN "status" VARCHAR NOT NULL DEFAULT 'granted',
  ADD COLUMN "requested_level" VARCHAR NOT NULL DEFAULT 'read',
  ADD COLUMN "added_by_user_id" VARCHAR,
  ADD COLUMN "placeholder_initiator_user_id" VARCHAR,
  ADD COLUMN "supplied_title" VARCHAR,
  ADD COLUMN "revoked_at" TIMESTAMPTZ(3),
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ai_context_project_docs" document
SET "added_by_user_id" = project."created_by_user_id"
FROM "ai_context_projects" project
WHERE project."id" = document."project_id";

ALTER TABLE "ai_context_project_docs"
  ADD CONSTRAINT "ai_context_project_docs_status_check"
    CHECK ("status" IN ('pending', 'granted', 'revoked')),
  ADD CONSTRAINT "ai_context_project_docs_requested_level_check"
    CHECK ("requested_level" IN ('read', 'write')),
  ADD CONSTRAINT "ai_context_project_docs_placeholder_shape_check"
    CHECK (
      (
        "status" = 'pending' AND
        "revoked_at" IS NULL
      ) OR (
        "status" = 'granted' AND
        "placeholder_initiator_user_id" IS NULL AND
        "revoked_at" IS NULL
      ) OR (
        "status" = 'revoked' AND
        "placeholder_initiator_user_id" IS NULL AND
        "supplied_title" IS NULL AND
        "revoked_at" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "ai_context_project_docs_supplied_title_check"
    CHECK (
      "supplied_title" IS NULL OR
      (length(btrim("supplied_title")) BETWEEN 1 AND 512)
    );

ALTER TABLE "ai_context_project_docs"
  ADD CONSTRAINT "ai_context_project_docs_added_by_user_id_fkey"
  FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_docs_placeholder_initiator_user_id_fkey"
  FOREIGN KEY ("placeholder_initiator_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "ai_context_project_docs_workspace_id_doc_id_project_id_idx";
DROP INDEX "ai_context_project_docs_project_id_group_id_sort_order_idx";
CREATE INDEX "ai_context_project_docs_workspace_id_doc_id_status_project__idx"
  ON "ai_context_project_docs"("workspace_id", "doc_id", "status", "project_id");
CREATE INDEX "ai_context_project_docs_project_id_status_group_id_sort_ord_idx"
  ON "ai_context_project_docs"("project_id", "status", "group_id", "sort_order");
CREATE INDEX "ai_context_project_docs_placeholder_initiator_user_id_statu_idx"
  ON "ai_context_project_docs"("placeholder_initiator_user_id", "status", "updated_at");

CREATE TABLE "access_requests" (
  "id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "doc_id" VARCHAR NOT NULL,
  "beneficiary_type" VARCHAR NOT NULL,
  "beneficiary_user_id" VARCHAR,
  "beneficiary_project_id" VARCHAR,
  "requester_user_id" VARCHAR,
  "requester_user_id_snapshot" VARCHAR NOT NULL,
  "requester_supplied_identity" BOOLEAN NOT NULL DEFAULT true,
  "requested_level" VARCHAR NOT NULL,
  "requested_title" VARCHAR,
  "request_fingerprint" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'pending',
  "resolved_by_user_id" VARCHAR,
  "resolver_user_id_snapshot" VARCHAR,
  "resolution_reason" VARCHAR,
  "resolved_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "access_requests_beneficiary_shape_check" CHECK (
    (
      "beneficiary_type" = 'user' AND
      "beneficiary_user_id" IS NOT NULL AND
      "beneficiary_project_id" IS NULL AND
      "beneficiary_user_id" = "requester_user_id_snapshot" AND
      "requester_supplied_identity"
    ) OR (
      "beneficiary_type" = 'project' AND
      "beneficiary_user_id" IS NULL AND
      "beneficiary_project_id" IS NOT NULL
    )
  ),
  CONSTRAINT "access_requests_level_check"
    CHECK ("requested_level" IN ('read', 'write')),
  CONSTRAINT "access_requests_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'expired', 'withdrawn')),
  CONSTRAINT "access_requests_lifecycle_check" CHECK (
    (
      "status" = 'pending' AND
      "resolved_by_user_id" IS NULL AND
      "resolver_user_id_snapshot" IS NULL AND
      "resolution_reason" IS NULL AND
      "resolved_at" IS NULL
    ) OR (
      "status" = 'expired' AND
      "resolved_by_user_id" IS NULL AND
      "resolver_user_id_snapshot" IS NULL AND
      "resolved_at" IS NOT NULL
    ) OR (
      "status" IN ('approved', 'rejected', 'withdrawn') AND
      "resolver_user_id_snapshot" IS NOT NULL AND
      "resolved_at" IS NOT NULL
    )
  ),
  CONSTRAINT "access_requests_identity_check" CHECK (
    length(btrim("doc_id")) > 0 AND
    length(btrim("requester_user_id_snapshot")) > 0 AND
    length(btrim("request_fingerprint")) > 0 AND
    ("requester_supplied_identity" OR "requested_title" IS NULL) AND
    ("requested_title" IS NULL OR length(btrim("requested_title")) BETWEEN 1 AND 512) AND
    ("resolution_reason" IS NULL OR length(btrim("resolution_reason")) BETWEEN 1 AND 512) AND
    ("expires_at" IS NULL OR "expires_at" > "created_at")
  )
);

ALTER TABLE "access_requests"
  ADD CONSTRAINT "access_requests_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "access_requests_beneficiary_user_id_fkey"
  FOREIGN KEY ("beneficiary_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "access_requests_beneficiary_project_id_fkey"
  FOREIGN KEY ("beneficiary_project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "access_requests_requester_user_id_fkey"
  FOREIGN KEY ("requester_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "access_requests_resolved_by_user_id_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "access_requests_request_fingerprint_key"
  ON "access_requests"("request_fingerprint");
CREATE UNIQUE INDEX "access_requests_pending_user_beneficiary_key"
  ON "access_requests"("workspace_id", "doc_id", "beneficiary_user_id")
  WHERE "status" = 'pending' AND "beneficiary_type" = 'user';
CREATE UNIQUE INDEX "access_requests_pending_project_beneficiary_key"
  ON "access_requests"("workspace_id", "doc_id", "beneficiary_project_id")
  WHERE "status" = 'pending' AND "beneficiary_type" = 'project';
CREATE INDEX "access_requests_workspace_id_doc_id_status_updated_at_idx"
  ON "access_requests"("workspace_id", "doc_id", "status", "updated_at");
CREATE INDEX "access_requests_beneficiary_user_id_status_updated_at_idx"
  ON "access_requests"("beneficiary_user_id", "status", "updated_at");
CREATE INDEX "access_requests_beneficiary_project_id_status_updated_at_idx"
  ON "access_requests"("beneficiary_project_id", "status", "updated_at");
CREATE INDEX "access_requests_requester_user_id_status_updated_at_idx"
  ON "access_requests"("requester_user_id", "status", "updated_at");
CREATE INDEX "access_requests_status_expires_at_idx"
  ON "access_requests"("status", "expires_at");

CREATE TABLE "ai_context_project_grants" (
  "id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "doc_id" VARCHAR NOT NULL,
  "level" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'active',
  "source" VARCHAR NOT NULL,
  "approving_side" VARCHAR NOT NULL DEFAULT 'source',
  "revocable" BOOLEAN NOT NULL DEFAULT true,
  "granted_by_user_id" VARCHAR,
  "grantor_user_id_snapshot" VARCHAR,
  "access_request_id" VARCHAR,
  "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by_user_id" VARCHAR,
  "revoker_user_id_snapshot" VARCHAR,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_project_grants_level_check"
    CHECK ("level" IN ('read', 'write')),
  CONSTRAINT "ai_context_project_grants_status_check"
    CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "ai_context_project_grants_source_check"
    CHECK ("source" IN ('direct', 'access_request', 'phase1_migration')),
  CONSTRAINT "ai_context_project_grants_approving_side_check"
    CHECK ("approving_side" = 'source'),
  CONSTRAINT "ai_context_project_grants_source_shape_check" CHECK (
    ("source" = 'access_request' AND "access_request_id" IS NOT NULL) OR
    ("source" <> 'access_request' AND "access_request_id" IS NULL)
  ),
  CONSTRAINT "ai_context_project_grants_grantor_shape_check" CHECK (
    "source" = 'phase1_migration' OR
    (
      "grantor_user_id_snapshot" IS NOT NULL AND
      length(btrim("grantor_user_id_snapshot")) > 0
    )
  ),
  CONSTRAINT "ai_context_project_grants_lifecycle_check" CHECK (
    (
      "status" = 'active' AND
      "revoked_by_user_id" IS NULL AND
      "revoker_user_id_snapshot" IS NULL AND
      "revoked_at" IS NULL
    ) OR (
      "status" = 'revoked' AND
      "revoker_user_id_snapshot" IS NOT NULL AND
      length(btrim("revoker_user_id_snapshot")) > 0 AND
      "revoked_at" IS NOT NULL AND
      "revoked_at" >= "granted_at"
    )
  ),
  CONSTRAINT "ai_context_project_grants_revocable_check"
    CHECK ("revocable")
);

ALTER TABLE "ai_context_project_grants"
  ADD CONSTRAINT "ai_context_project_grants_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_grants_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_grants_granted_by_user_id_fkey"
  FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_grants_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_grants_access_request_id_fkey"
  FOREIGN KEY ("access_request_id") REFERENCES "access_requests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_context_project_grants_access_request_id_key"
  ON "ai_context_project_grants"("access_request_id");
CREATE UNIQUE INDEX "ai_context_project_grants_id_project_id_workspace_id_doc_id_key"
  ON "ai_context_project_grants"("id", "project_id", "workspace_id", "doc_id");
CREATE UNIQUE INDEX "ai_context_project_grants_active_document_key"
  ON "ai_context_project_grants"("project_id", "workspace_id", "doc_id")
  WHERE "status" = 'active';
CREATE INDEX "ai_context_project_grants_project_id_status_updated_at_idx"
  ON "ai_context_project_grants"("project_id", "status", "updated_at");
CREATE INDEX "ai_context_project_grants_workspace_id_doc_id_status_update_idx"
  ON "ai_context_project_grants"("workspace_id", "doc_id", "status", "updated_at");
CREATE INDEX "ai_context_project_grants_granted_by_user_id_granted_at_idx"
  ON "ai_context_project_grants"("granted_by_user_id", "granted_at");

CREATE FUNCTION "ai_context_assert_project_document_grant_consistency"(
  "target_project_id" VARCHAR,
  "target_workspace_id" VARCHAR,
  "target_doc_id" VARCHAR
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  document_status VARCHAR;
  active_grant_count INTEGER;
BEGIN
  SELECT document."status"
  INTO document_status
  FROM "ai_context_project_docs" document
  WHERE document."project_id" = "target_project_id"
    AND document."workspace_id" = "target_workspace_id"
    AND document."doc_id" = "target_doc_id";

  SELECT count(*)::integer
  INTO active_grant_count
  FROM "ai_context_project_grants" grant_row
  WHERE grant_row."project_id" = "target_project_id"
    AND grant_row."workspace_id" = "target_workspace_id"
    AND grant_row."doc_id" = "target_doc_id"
    AND grant_row."status" = 'active';

  IF (document_status = 'granted' AND active_grant_count <> 1) OR
     (document_status IN ('pending', 'revoked') AND active_grant_count <> 0) OR
     (document_status IS NULL AND active_grant_count <> 0) THEN
    RAISE EXCEPTION
      'Project document and active grant state must remain consistent'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_context_project_document_grant_consistency_check';
  END IF;
END;
$$;

CREATE FUNCTION "ai_context_project_document_grant_consistency_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM "ai_context_assert_project_document_grant_consistency"(
      OLD."project_id", OLD."workspace_id", OLD."doc_id"
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM "ai_context_assert_project_document_grant_consistency"(
      NEW."project_id", NEW."workspace_id", NEW."doc_id"
    );
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_context_project_docs_grant_consistency_check"
AFTER INSERT OR UPDATE OR DELETE
ON "ai_context_project_docs"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_project_document_grant_consistency_guard"();

CREATE CONSTRAINT TRIGGER "ai_context_project_grants_document_consistency_check"
AFTER INSERT OR UPDATE OR DELETE
ON "ai_context_project_grants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_project_document_grant_consistency_guard"();

-- Phase 1 accepted only documents for which the project owner held sharing
-- authority. Preserve those references as least-privilege read grants.
INSERT INTO "ai_context_project_grants" (
  "id",
  "project_id",
  "workspace_id",
  "doc_id",
  "level",
  "status",
  "source",
  "approving_side",
  "granted_by_user_id",
  "grantor_user_id_snapshot",
  "granted_at",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  document."project_id",
  document."workspace_id",
  document."doc_id",
  'read',
  'active',
  'phase1_migration',
  'source',
  project."created_by_user_id",
  project."created_by_user_id",
  document."created_at",
  document."created_at",
  document."updated_at"
FROM "ai_context_project_docs" document
JOIN "ai_context_projects" project ON project."id" = document."project_id";

CREATE TABLE "access_request_audit_events" (
  "id" VARCHAR NOT NULL,
  "access_request_id" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "from_status" VARCHAR,
  "to_status" VARCHAR NOT NULL,
  "actor_user_id" VARCHAR,
  "actor_user_id_snapshot" VARCHAR,
  "event_fingerprint" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "access_request_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "access_request_audit_events_event_type_check"
    CHECK ("event_type" IN ('requested', 'approved', 'rejected', 'expired', 'withdrawn')),
  CONSTRAINT "access_request_audit_events_status_check" CHECK (
    "to_status" IN ('pending', 'approved', 'rejected', 'expired', 'withdrawn') AND
    ("from_status" IS NULL OR "from_status" IN ('pending', 'approved', 'rejected', 'expired', 'withdrawn'))
  ),
  CONSTRAINT "access_request_audit_events_shape_check" CHECK (
    ("event_type" = 'requested' AND "from_status" IS NULL AND "to_status" = 'pending') OR
    ("event_type" <> 'requested' AND "from_status" = 'pending' AND "to_status" = "event_type")
  )
);

ALTER TABLE "access_request_audit_events"
  ADD CONSTRAINT "access_request_audit_events_access_request_id_fkey"
  FOREIGN KEY ("access_request_id") REFERENCES "access_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "access_request_audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "access_request_audit_events_event_fingerprint_key"
  ON "access_request_audit_events"("event_fingerprint");
CREATE INDEX "access_request_audit_events_access_request_id_created_at_idx"
  ON "access_request_audit_events"("access_request_id", "created_at");
CREATE INDEX "access_request_audit_events_actor_user_id_created_at_idx"
  ON "access_request_audit_events"("actor_user_id", "created_at");

CREATE TABLE "ai_context_project_invitations" (
  "id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "invitee_user_id" VARCHAR NOT NULL,
  "inviter_user_id" VARCHAR,
  "inviter_user_id_snapshot" VARCHAR NOT NULL,
  "status" VARCHAR NOT NULL DEFAULT 'pending',
  "accepted_at" TIMESTAMPTZ(3),
  "declined_at" TIMESTAMPTZ(3),
  "withdrawn_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_project_invitations_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'declined', 'withdrawn')),
  CONSTRAINT "ai_context_project_invitations_lifecycle_check" CHECK (
    ("status" = 'pending' AND "accepted_at" IS NULL AND "declined_at" IS NULL AND "withdrawn_at" IS NULL) OR
    ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "declined_at" IS NULL AND "withdrawn_at" IS NULL) OR
    ("status" = 'declined' AND "accepted_at" IS NULL AND "declined_at" IS NOT NULL AND "withdrawn_at" IS NULL) OR
    ("status" = 'withdrawn' AND "accepted_at" IS NULL AND "declined_at" IS NULL AND "withdrawn_at" IS NOT NULL)
  ),
  CONSTRAINT "ai_context_project_invitations_identity_check" CHECK (
    "invitee_user_id" <> "inviter_user_id_snapshot" AND
    length(btrim("inviter_user_id_snapshot")) > 0
  )
);

ALTER TABLE "ai_context_project_invitations"
  ADD CONSTRAINT "ai_context_project_invitations_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_invitations_invitee_user_id_fkey"
  FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_invitations_inviter_user_id_fkey"
  FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_context_project_invitations_pending_invitee_key"
  ON "ai_context_project_invitations"("project_id", "invitee_user_id")
  WHERE "status" = 'pending';
CREATE INDEX "ai_context_project_invitations_invitee_user_id_status_updat_idx"
  ON "ai_context_project_invitations"("invitee_user_id", "status", "updated_at");
CREATE INDEX "ai_context_project_invitations_project_id_status_updated_at_idx"
  ON "ai_context_project_invitations"("project_id", "status", "updated_at");
CREATE INDEX "ai_context_project_invitations_inviter_user_id_status_updat_idx"
  ON "ai_context_project_invitations"("inviter_user_id", "status", "updated_at");

CREATE TABLE "ai_context_project_invitation_audit_events" (
  "id" VARCHAR NOT NULL,
  "invitation_id" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "from_status" VARCHAR,
  "to_status" VARCHAR NOT NULL,
  "actor_user_id" VARCHAR,
  "actor_user_id_snapshot" VARCHAR,
  "event_fingerprint" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_invitation_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_project_invitation_audit_events_type_check"
    CHECK ("event_type" IN ('sent', 'accepted', 'declined', 'withdrawn')),
  CONSTRAINT "ai_context_project_invitation_audit_events_shape_check" CHECK (
    ("event_type" = 'sent' AND "from_status" IS NULL AND "to_status" = 'pending') OR
    ("event_type" <> 'sent' AND "from_status" = 'pending' AND "to_status" = "event_type")
  )
);

ALTER TABLE "ai_context_project_invitation_audit_events"
  ADD CONSTRAINT "ai_context_project_invitation_audit_events_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "ai_context_project_invitations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_invitation_audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_context_project_invitation_audit_events_event_fingerprin_key"
  ON "ai_context_project_invitation_audit_events"("event_fingerprint");
CREATE INDEX "ai_context_project_invitation_audit_events_invitation_id_cr_idx"
  ON "ai_context_project_invitation_audit_events"("invitation_id", "created_at");
CREATE INDEX "ai_context_project_invitation_audit_events_actor_user_id_cr_idx"
  ON "ai_context_project_invitation_audit_events"("actor_user_id", "created_at");

CREATE TABLE "ai_context_project_grant_audit_events" (
  "id" VARCHAR NOT NULL,
  "grant_id" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "actor_user_id" VARCHAR,
  "actor_user_id_snapshot" VARCHAR,
  "level" VARCHAR NOT NULL,
  "source" VARCHAR NOT NULL,
  "event_fingerprint" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_grant_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_project_grant_audit_events_type_check"
    CHECK ("event_type" IN ('granted', 'revoked')),
  CONSTRAINT "ai_context_project_grant_audit_events_level_check"
    CHECK ("level" IN ('read', 'write')),
  CONSTRAINT "ai_context_project_grant_audit_events_source_check"
    CHECK ("source" IN ('direct', 'access_request', 'phase1_migration'))
);

ALTER TABLE "ai_context_project_grant_audit_events"
  ADD CONSTRAINT "ai_context_project_grant_audit_events_grant_id_fkey"
  FOREIGN KEY ("grant_id") REFERENCES "ai_context_project_grants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_grant_audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_context_project_grant_audit_events_event_fingerprint_key"
  ON "ai_context_project_grant_audit_events"("event_fingerprint");
CREATE INDEX "ai_context_project_grant_audit_events_grant_id_created_at_idx"
  ON "ai_context_project_grant_audit_events"("grant_id", "created_at");
CREATE INDEX "ai_context_project_grant_audit_events_actor_user_id_created_idx"
  ON "ai_context_project_grant_audit_events"("actor_user_id", "created_at");

INSERT INTO "ai_context_project_grant_audit_events" (
  "id",
  "grant_id",
  "event_type",
  "actor_user_id",
  "actor_user_id_snapshot",
  "level",
  "source",
  "event_fingerprint",
  "created_at"
)
SELECT
  gen_random_uuid()::text,
  grant_row."id",
  'granted',
  grant_row."granted_by_user_id",
  grant_row."grantor_user_id_snapshot",
  grant_row."level",
  grant_row."source",
  encode(digest('phase1-migration:grant:' || grant_row."id", 'sha256'), 'hex'),
  grant_row."granted_at"
FROM "ai_context_project_grants" grant_row;

CREATE TABLE "ai_context_project_policy_audit_events" (
  "id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "actor_user_id" VARCHAR,
  "actor_user_id_snapshot" VARCHAR NOT NULL,
  "previous_policy" VARCHAR NOT NULL,
  "policy" VARCHAR NOT NULL,
  "event_fingerprint" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_policy_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_project_policy_audit_events_policy_check" CHECK (
    "previous_policy" IN ('read_only', 'read_write') AND
    "policy" IN ('read_only', 'read_write') AND
    "previous_policy" <> "policy"
  )
);

ALTER TABLE "ai_context_project_policy_audit_events"
  ADD CONSTRAINT "ai_context_project_policy_audit_events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_policy_audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_context_project_policy_audit_events_event_fingerprint_key"
  ON "ai_context_project_policy_audit_events"("event_fingerprint");
CREATE INDEX "ai_context_project_policy_audit_events_project_id_created_a_idx"
  ON "ai_context_project_policy_audit_events"("project_id", "created_at");
CREATE INDEX "ai_context_project_policy_audit_events_actor_user_id_create_idx"
  ON "ai_context_project_policy_audit_events"("actor_user_id", "created_at");

CREATE TABLE "ai_context_project_membership_audit_events" (
  "id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "event_type" VARCHAR NOT NULL,
  "actor_user_id" VARCHAR,
  "actor_user_id_snapshot" VARCHAR NOT NULL,
  "subject_user_id" VARCHAR,
  "subject_user_id_snapshot" VARCHAR NOT NULL,
  "event_fingerprint" VARCHAR NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_project_membership_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_context_project_membership_audit_events_type_check"
    CHECK ("event_type" = 'ownership_transferred'),
  CONSTRAINT "ai_context_project_membership_audit_events_identity_check" CHECK (
    length(btrim("actor_user_id_snapshot")) > 0 AND
    length(btrim("subject_user_id_snapshot")) > 0 AND
    "actor_user_id_snapshot" <> "subject_user_id_snapshot"
  )
);

ALTER TABLE "ai_context_project_membership_audit_events"
  ADD CONSTRAINT "ai_context_project_membership_audit_events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_membership_audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_project_membership_audit_events_subject_user_id_fkey"
  FOREIGN KEY ("subject_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_context_project_membership_audit_events_event_fingerprin_key"
  ON "ai_context_project_membership_audit_events"("event_fingerprint");
CREATE INDEX "ai_context_project_membership_audit_events_project_id_creat_idx"
  ON "ai_context_project_membership_audit_events"("project_id", "created_at");
CREATE INDEX "ai_context_project_membership_audit_events_actor_user_id_cr_idx"
  ON "ai_context_project_membership_audit_events"("actor_user_id", "created_at");
CREATE INDEX "ai_context_project_membership_audit_events_subject_user_id__idx"
  ON "ai_context_project_membership_audit_events"("subject_user_id", "created_at");

ALTER TABLE "ai_context_memories"
  ADD COLUMN "quarantined_at" TIMESTAMPTZ(3),
  ADD COLUMN "quarantine_reason" VARCHAR,
  ADD COLUMN "quarantined_by_project_grant_id" VARCHAR,
  ADD CONSTRAINT "ai_context_memories_quarantine_shape_check" CHECK (
    (
      "quarantined_at" IS NULL AND
      "quarantine_reason" IS NULL AND
      "quarantined_by_project_grant_id" IS NULL
    ) OR (
      "quarantined_at" IS NOT NULL AND
      "quarantine_reason" IS NOT NULL AND
      length(btrim("quarantine_reason")) > 0 AND
      "status" <> 'active'
    )
  );

-- Phase 1 memory rows do not carry a trustworthy source-document edge.
-- Retain the evidence but fail closed until it is explicitly regenerated.
UPDATE "ai_context_memories"
SET
  "status" = CASE WHEN "status" = 'active' THEN 'disabled' ELSE "status" END,
  "quarantined_at" = CURRENT_TIMESTAMP,
  "quarantine_reason" = 'missing_source_provenance'
WHERE "scope" = 'project';

ALTER TABLE "ai_context_memories"
  ADD CONSTRAINT "ai_context_memories_quarantined_by_project_grant_id_fkey"
  FOREIGN KEY ("quarantined_by_project_grant_id") REFERENCES "ai_context_project_grants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ai_context_memories_id_project_id_key"
  ON "ai_context_memories"("id", "project_id");
CREATE INDEX "ai_context_memories_quarantined_by_project_grant_id_status_idx"
  ON "ai_context_memories"("quarantined_by_project_grant_id", "status");

CREATE TABLE "ai_context_memory_sources" (
  "memory_id" VARCHAR NOT NULL,
  "project_id" VARCHAR NOT NULL,
  "workspace_id" VARCHAR NOT NULL,
  "doc_id" VARCHAR NOT NULL,
  "project_grant_id" VARCHAR NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_context_memory_sources_pkey"
    PRIMARY KEY ("memory_id", "project_grant_id")
);

ALTER TABLE "ai_context_memory_sources"
  ADD CONSTRAINT "ai_context_memory_sources_memory_id_project_id_fkey"
  FOREIGN KEY ("memory_id", "project_id") REFERENCES "ai_context_memories"("id", "project_id")
  ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT "ai_context_memory_sources_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "ai_context_projects"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_context_memory_sources_project_grant_id_project_id_work_fkey"
  FOREIGN KEY ("project_grant_id", "project_id", "workspace_id", "doc_id")
  REFERENCES "ai_context_project_grants"("id", "project_id", "workspace_id", "doc_id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX "ai_context_memory_sources_project_id_workspace_id_doc_id_me_idx"
  ON "ai_context_memory_sources"("project_id", "workspace_id", "doc_id", "memory_id");
CREATE INDEX "ai_context_memory_sources_project_grant_id_memory_id_idx"
  ON "ai_context_memory_sources"("project_grant_id", "memory_id");
CREATE INDEX "ai_context_memory_sources_workspace_id_memory_id_idx"
  ON "ai_context_memory_sources"("workspace_id", "memory_id");

CREATE FUNCTION "ai_context_assert_active_memory_sources"("target_memory_id" VARCHAR)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_context_memories" memory
    WHERE memory."id" = "target_memory_id"
      AND memory."scope" = 'project'
      AND memory."status" = 'active'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM "ai_context_memory_sources" source
          WHERE source."memory_id" = memory."id"
        ) OR EXISTS (
          SELECT 1
          FROM "ai_context_memory_sources" source
          JOIN "ai_context_project_grants" grant_row
            ON grant_row."id" = source."project_grant_id"
          WHERE source."memory_id" = memory."id"
            AND grant_row."status" <> 'active'
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Active project memory requires active project-grant source provenance'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_context_memories_active_source_required_check';
  END IF;
END;
$$;

CREATE FUNCTION "ai_context_memory_source_guard"()
RETURNS trigger
LANGUAGE plpgsql
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

CREATE CONSTRAINT TRIGGER "ai_context_memories_active_source_required_check"
AFTER INSERT OR UPDATE
ON "ai_context_memories"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_memory_source_guard"();

CREATE CONSTRAINT TRIGGER "ai_context_memory_sources_active_source_required_check"
AFTER INSERT OR UPDATE OR DELETE
ON "ai_context_memory_sources"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_memory_source_guard"();

CREATE FUNCTION "ai_context_project_grant_active_memory_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'revoked' AND OLD."status" = 'active' THEN
    PERFORM "ai_context_assert_active_memory_sources"(source."memory_id")
    FROM "ai_context_memory_sources" source
    WHERE source."project_grant_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "ai_context_project_grants_active_memory_guard"
AFTER UPDATE OF "status"
ON "ai_context_project_grants"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ai_context_project_grant_active_memory_guard"();

-- A source workspace is a deletable organizational boundary, while Project
-- memories are global state. Lock its grants first so a concurrent provenance
-- insert cannot land after cleanup, then fail closed before the workspace's
-- normal cascades remove the source grants.
CREATE FUNCTION "ai_context_cleanup_memory_sources_before_workspace_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "ai_context_project_grants" grant_row
  WHERE grant_row."workspace_id" = OLD."id"
  ORDER BY grant_row."id"
  FOR UPDATE;

  UPDATE "ai_context_memories" memory
  SET
    "status" = 'disabled',
    "quarantined_at" = CURRENT_TIMESTAMP,
    "quarantine_reason" = 'source_workspace_deleted',
    "quarantined_by_project_grant_id" = NULL,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE memory."scope" = 'project'
    AND memory."status" = 'active'
    AND EXISTS (
      SELECT 1
      FROM "ai_context_memory_sources" source
      WHERE source."memory_id" = memory."id"
        AND source."workspace_id" = OLD."id"
    );

  DELETE FROM "ai_context_memory_sources" source
  WHERE source."workspace_id" = OLD."id";

  RETURN OLD;
END;
$$;

CREATE TRIGGER "ai_context_workspace_memory_source_cleanup"
BEFORE DELETE ON "workspaces"
FOR EACH ROW
EXECUTE FUNCTION "ai_context_cleanup_memory_sources_before_workspace_delete"();

CREATE FUNCTION "intelligence_workbench_audit_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'Intelligence Workbench audit events are immutable'
    USING ERRCODE = '23514',
      CONSTRAINT = 'intelligence_workbench_audit_immutable_check';
END;
$$;

CREATE TRIGGER "access_request_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "access_request_audit_events"
FOR EACH ROW EXECUTE FUNCTION "intelligence_workbench_audit_immutable"();

CREATE TRIGGER "ai_context_project_invitation_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "ai_context_project_invitation_audit_events"
FOR EACH ROW EXECUTE FUNCTION "intelligence_workbench_audit_immutable"();

CREATE TRIGGER "ai_context_project_grant_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "ai_context_project_grant_audit_events"
FOR EACH ROW EXECUTE FUNCTION "intelligence_workbench_audit_immutable"();

CREATE TRIGGER "ai_context_project_policy_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "ai_context_project_policy_audit_events"
FOR EACH ROW EXECUTE FUNCTION "intelligence_workbench_audit_immutable"();

CREATE TRIGGER "ai_context_project_membership_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "ai_context_project_membership_audit_events"
FOR EACH ROW EXECUTE FUNCTION "intelligence_workbench_audit_immutable"();
