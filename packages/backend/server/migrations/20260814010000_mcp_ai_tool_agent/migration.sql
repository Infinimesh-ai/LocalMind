CREATE OR REPLACE FUNCTION ai_mcp_delegation_plan_is_valid(plan JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  plan_kind TEXT;
  plan_step JSONB;
  plan_target JSONB;
BEGIN
  IF plan = '{}'::jsonb THEN
    RETURN TRUE;
  END IF;
  IF jsonb_typeof(plan) <> 'object' OR
     plan - ARRAY['version', 'kind', 'summary', 'steps', 'target'] <> '{}'::jsonb OR
     COALESCE(plan->>'version', '') <> 'localmind-task-plan/v1' OR
     COALESCE(plan->>'kind', '') NOT IN ('answer', 'document_update', 'tool_agent', 'unsupported_task') OR
     COALESCE(length(btrim(plan->>'summary')), 0) NOT BETWEEN 1 AND 1000 OR
     COALESCE(jsonb_typeof(plan->'steps'), '') <> 'array' OR
     COALESCE(jsonb_array_length(plan->'steps'), 0) NOT BETWEEN 1 AND 100 THEN
    RETURN FALSE;
  END IF;

  FOR plan_step IN SELECT value FROM jsonb_array_elements(plan->'steps')
  LOOP
    IF jsonb_typeof(plan_step) <> 'object' OR
       plan_step - ARRAY['key', 'type', 'summary'] <> '{}'::jsonb OR
       COALESCE(length(btrim(plan_step->>'key')), 0) NOT BETWEEN 1 AND 128 OR
       COALESCE(plan_step->>'type', '') NOT IN ('model', 'tool', 'approval', 'handoff', 'codex', 'mcp') OR
       COALESCE(length(btrim(plan_step->>'summary')), 0) NOT BETWEEN 1 AND 1000 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  plan_kind := plan->>'kind';
  plan_target := plan->'target';
  IF plan_kind = 'document_update' THEN
    IF jsonb_typeof(plan_target) <> 'object' OR
       plan_target - ARRAY['kind', 'documentId', 'contentFingerprint'] <> '{}'::jsonb OR
       COALESCE(plan_target->>'kind', '') <> 'document' OR
       COALESCE(length(btrim(plan_target->>'documentId')), 0) NOT BETWEEN 1 AND 256 OR
       COALESCE(length(btrim(plan_target->>'contentFingerprint')), 0) NOT BETWEEN 8 AND 128 THEN
      RETURN FALSE;
    END IF;
  ELSIF plan_target IS NOT NULL THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
