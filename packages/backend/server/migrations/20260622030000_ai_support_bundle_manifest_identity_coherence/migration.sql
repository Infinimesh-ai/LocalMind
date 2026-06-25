ALTER TABLE "ai_support_bundle_requests"
  ADD CONSTRAINT "ai_support_bundle_requests_manifest_identity_check"
  CHECK (
    jsonb_typeof("manifest_json") = 'object'
    AND jsonb_typeof("manifest_json"->'bundleId') = 'string'
    AND btrim("manifest_json"->>'bundleId') = "id"
    AND jsonb_typeof("manifest_json"->'workspaceId') = 'string'
    AND btrim("manifest_json"->>'workspaceId') = "workspace_id"
    AND jsonb_typeof("manifest_json"->'actorId') = 'string'
    AND btrim("manifest_json"->>'actorId') = "actor_id"
    AND jsonb_typeof("manifest_json"->'sourceEvidenceSetFingerprint') =
      'string'
    AND btrim("manifest_json"->>'sourceEvidenceSetFingerprint') =
      "source_evidence_set_fingerprint"
  ) NOT VALID;
