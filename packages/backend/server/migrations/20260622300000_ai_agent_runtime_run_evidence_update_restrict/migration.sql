CREATE OR REPLACE FUNCTION ai_agent_run_evidence_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."workflow" IS NOT DISTINCT FROM NEW."workflow"
     AND OLD."source_type" IS NOT DISTINCT FROM NEW."source_type"
     AND OLD."source_id" IS NOT DISTINCT FROM NEW."source_id"
     AND OLD."title" IS NOT DISTINCT FROM NEW."title"
     AND OLD."target_fingerprint" IS NOT DISTINCT FROM
       NEW."target_fingerprint"
     AND OLD."evidence_fingerprint" IS NOT DISTINCT FROM
       NEW."evidence_fingerprint"
     AND OLD."started_at" IS NOT DISTINCT FROM NEW."started_at"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_runs_evidence_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_agent_runs_evidence_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_agent_runs_evidence_update_restrict_check"
AFTER UPDATE
ON "ai_agent_runs"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_run_evidence_update_restrict();
