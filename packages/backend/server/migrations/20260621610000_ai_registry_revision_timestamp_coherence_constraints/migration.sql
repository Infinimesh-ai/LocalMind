ALTER TABLE "ai_prompt_registry_revisions"
  ADD CONSTRAINT "ai_prompt_registry_revisions_timestamp_coherence_check"
  CHECK ("updated_at" >= "created_at") NOT VALID;

ALTER TABLE "ai_task_route_policy_revisions"
  ADD CONSTRAINT "ai_task_route_policy_revisions_timestamp_coherence_check"
  CHECK ("updated_at" >= "created_at") NOT VALID;

ALTER TABLE "ai_model_registry_revisions"
  ADD CONSTRAINT "ai_model_registry_revisions_timestamp_coherence_check"
  CHECK ("updated_at" >= "created_at") NOT VALID;

ALTER TABLE "ai_provider_registry_revisions"
  ADD CONSTRAINT "ai_provider_registry_revisions_timestamp_coherence_check"
  CHECK ("updated_at" >= "created_at") NOT VALID;
