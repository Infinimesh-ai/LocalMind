-- Report GC shares immutable blobs with native resources. Every new reference
-- locks the blob so a committed deletion fence cannot race an adoption.
CREATE OR REPLACE FUNCTION localmind_guard_report_blob_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blob_key_value TEXT;
BEGIN
 IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
 blob_key_value := to_jsonb(NEW)->>TG_ARGV[0];
 IF blob_key_value IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM project_blobs WHERE project_id=NEW.project_id AND key=blob_key_value AND pending_deletion_id IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project blob is unavailable or pending deletion'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_gc_blob_key_guard BEFORE INSERT OR UPDATE OF blob_key ON project_resource_revisions FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('blob_key');
CREATE TRIGGER report_gc_key_guard BEFORE INSERT OR UPDATE OF key ON project_resource_attachments FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('key');
CREATE TRIGGER report_gc_source_blob_key_guard BEFORE INSERT OR UPDATE OF source_blob_key ON office_artifacts FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('source_blob_key');
CREATE TRIGGER report_gc_package_blob_key_guard BEFORE INSERT OR UPDATE OF package_blob_key ON office_revisions FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('package_blob_key');
CREATE TRIGGER report_gc_state_blob_key_guard BEFORE INSERT OR UPDATE OF state_blob_key ON office_revisions FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('state_blob_key');
CREATE TRIGGER report_gc_command_blob_key_guard BEFORE INSERT OR UPDATE OF command_blob_key ON office_command_requests FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('command_blob_key');
CREATE TRIGGER report_gc_blob_key_guard BEFORE INSERT OR UPDATE OF blob_key ON ai_session_project_blob_references FOR EACH ROW EXECUTE FUNCTION localmind_guard_report_blob_reference('blob_key');
