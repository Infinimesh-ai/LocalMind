ALTER TABLE "ai_support_bundle_download_authorizations"
  ADD CONSTRAINT "ai_support_bundle_download_authorizations_delivery_shape_check"
  CHECK (
    (
      "delivery_method" = 'api_proxy'
      AND "direct_download_url" IS NULL
      AND "direct_download_expires_at" IS NULL
    )
    OR
    (
      "delivery_method" = 'object_storage_signed_url'
      AND "direct_download_url" IS NOT NULL
      AND "direct_download_expires_at" IS NOT NULL
    )
  ) NOT VALID;
