ALTER TABLE access_requests ADD COLUMN source_kind VARCHAR(32) NOT NULL DEFAULT 'document';
ALTER TABLE ai_context_project_copy_authorizations ADD COLUMN source_kind VARCHAR(32) NOT NULL DEFAULT 'document';
ALTER TABLE ai_context_project_copy_authorizations ALTER COLUMN grant_id DROP NOT NULL;
ALTER TABLE project_publication_targets ADD COLUMN target_kind VARCHAR(32) NOT NULL DEFAULT 'legacy';
ALTER TABLE access_requests ADD CONSTRAINT access_request_source_kind CHECK (source_kind IN ('document', 'workspace_file'));
ALTER TABLE ai_context_project_copy_authorizations ADD CONSTRAINT copy_authorization_source_kind CHECK (
  (source_kind = 'document' AND grant_id IS NOT NULL) OR (source_kind = 'workspace_file' AND grant_id IS NULL)
);
ALTER TABLE project_publication_targets ADD CONSTRAINT publication_target_kind CHECK (target_kind IN ('legacy', 'workspace_file'));
DROP INDEX access_requests_pending_project_beneficiary_key;
CREATE UNIQUE INDEX access_requests_pending_project_beneficiary_key
  ON access_requests(workspace_id, doc_id, source_kind, beneficiary_project_id, purpose)
  WHERE status = 'pending' AND beneficiary_type = 'project';
CREATE OR REPLACE FUNCTION guard_access_request_purpose() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
  THEN RAISE EXCEPTION 'Access request purpose and source kind are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guard_project_copy_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM access_requests request WHERE request.id = NEW.request_id
      AND request.purpose = 'project_copy' AND request.status = 'approved'
      AND request.beneficiary_project_id = NEW.project_id AND request.workspace_id = NEW.workspace_id
      AND request.doc_id = NEW.doc_id AND request.source_kind = NEW.source_kind
      AND request.resolver_user_id_snapshot = NEW.approved_by
  ) THEN RAISE EXCEPTION 'Project copy authorization requires its explicit approved typed source request'; END IF;
  RETURN NULL;
END $$;
