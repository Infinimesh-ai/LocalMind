-- Project AI always has internal read and write capability. Historical policy
-- events remain as audit evidence; this transition is system-owned.
ALTER TABLE ai_context_projects
  ALTER COLUMN ai_policy SET DEFAULT 'read_write';

WITH previous AS (
  SELECT id, ai_policy
  FROM ai_context_projects
  WHERE ai_policy <> 'read_write'
  FOR UPDATE
), upgraded AS (
  UPDATE ai_context_projects AS project
  SET ai_policy = 'read_write',
      ai_policy_updated_by_user_id = NULL,
      ai_policy_updated_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  FROM previous
  WHERE project.id = previous.id
  RETURNING project.id, previous.ai_policy AS previous_policy
)
INSERT INTO ai_context_project_policy_audit_events (
  id,
  project_id,
  actor_user_id,
  actor_user_id_snapshot,
  previous_policy,
  policy,
  event_fingerprint,
  created_at
)
SELECT
  gen_random_uuid()::text,
  id,
  NULL,
  'system:migration:20260923020000',
  previous_policy,
  'read_write',
  encode(digest('fixed-project-ai-read-write/v1:' || id, 'sha256'), 'hex'),
  CURRENT_TIMESTAMP
FROM upgraded;

ALTER TABLE ai_context_projects
  DROP CONSTRAINT ai_context_projects_ai_policy_check,
  ADD CONSTRAINT ai_context_projects_ai_policy_check
    CHECK (ai_policy = 'read_write');
