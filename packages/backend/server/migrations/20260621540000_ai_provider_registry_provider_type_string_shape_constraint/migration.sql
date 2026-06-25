ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_provider_type_shape_check"
  CHECK (
    "provider_type" IS NULL
    OR length(btrim("provider_type")) BETWEEN 1 AND 512
  ) NOT VALID;
