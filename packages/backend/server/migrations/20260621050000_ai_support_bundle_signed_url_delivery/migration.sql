-- AlterTable
ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD COLUMN "delivery_method" VARCHAR NOT NULL DEFAULT 'api_proxy',
  ADD COLUMN "direct_download_url" TEXT,
  ADD COLUMN "direct_download_expires_at" TIMESTAMPTZ(3);

-- AlterCheckConstraint
ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_delivery_method_check"
  CHECK ("delivery_method" IN ('api_proxy', 'object_storage_signed_url'));
