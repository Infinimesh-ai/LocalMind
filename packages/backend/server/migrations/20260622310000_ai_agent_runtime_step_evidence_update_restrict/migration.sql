CREATE OR REPLACE FUNCTION ai_agent_step_evidence_update_restrict()
RETURNS trigger AS $$
BEGIN
  IF OLD."id" IS NOT DISTINCT FROM NEW."id"
     AND OLD."run_id" IS NOT DISTINCT FROM NEW."run_id"
     AND OLD."workspace_id" IS NOT DISTINCT FROM NEW."workspace_id"
     AND OLD."actor_id" IS NOT DISTINCT FROM NEW."actor_id"
     AND OLD."step_key" IS NOT DISTINCT FROM NEW."step_key"
     AND OLD."title" IS NOT DISTINCT FROM NEW."title"
     AND OLD."order" IS NOT DISTINCT FROM NEW."order"
     AND OLD."evidence_fingerprint" IS NOT DISTINCT FROM
       NEW."evidence_fingerprint"
     AND OLD."started_at" IS NOT DISTINCT FROM NEW."started_at"
     AND OLD."created_at" IS NOT DISTINCT FROM NEW."created_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'ai_agent_steps_evidence_update_restrict_check'
    USING ERRCODE = '23514',
      CONSTRAINT = 'ai_agent_steps_evidence_update_restrict_check';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_ai_agent_steps_evidence_update_restrict_check"
AFTER UPDATE
ON "ai_agent_steps"
FOR EACH ROW
EXECUTE FUNCTION ai_agent_step_evidence_update_restrict();
