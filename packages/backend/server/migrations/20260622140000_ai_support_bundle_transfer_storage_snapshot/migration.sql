CREATE OR REPLACE FUNCTION ai_support_bundle_transfer_storage_snapshot_valid()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_support_bundle_requests" bundle
    WHERE bundle."id" = NEW."bundle_id"
      AND bundle."workspace_id" = NEW."workspace_id"
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "ai_support_bundle_requests" bundle
    WHERE bundle."id" = NEW."bundle_id"
      AND bundle."workspace_id" = NEW."workspace_id"
      AND (
        (
          NEW."artifact_kind" = 'manifest_json'
          AND bundle."manifest_storage_key" = NEW."storage_key"
          AND bundle."manifest_byte_size" = NEW."storage_byte_size"
          AND bundle."manifest_mime" = NEW."storage_content_type"
          AND bundle."manifest_fingerprint" = NEW."artifact_fingerprint"
        )
        OR (
          NEW."artifact_kind" = 'archive_json'
          AND bundle."archive_storage_key" = NEW."storage_key"
          AND bundle."archive_byte_size" = NEW."storage_byte_size"
          AND bundle."archive_mime" = NEW."storage_content_type"
          AND bundle."archive_fingerprint" = NEW."artifact_fingerprint"
        )
      )
  ) THEN
    RAISE EXCEPTION
      'ai_support_bundle_transfer_events_storage_snapshot_check'
      USING ERRCODE = '23514',
        CONSTRAINT = 'ai_support_bundle_transfer_events_storage_snapshot_check';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_support_bundle_transfer_events_storage_snapshot_check"
BEFORE INSERT OR UPDATE OF
  "bundle_id",
  "workspace_id",
  "artifact_kind",
  "artifact_fingerprint",
  "storage_key",
  "storage_byte_size",
  "storage_content_type"
ON "ai_support_bundle_transfer_events"
FOR EACH ROW
EXECUTE FUNCTION ai_support_bundle_transfer_storage_snapshot_valid();
