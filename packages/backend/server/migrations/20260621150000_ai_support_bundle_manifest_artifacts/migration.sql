ALTER TABLE "ai_support_bundle_requests"
  ADD COLUMN "manifest_storage_key" VARCHAR,
  ADD COLUMN "manifest_byte_size" INTEGER,
  ADD COLUMN "manifest_mime" VARCHAR,
  ADD COLUMN "manifest_filename" VARCHAR;
