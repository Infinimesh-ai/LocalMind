-- Deliveries adopted before the context-source integration shipped still need
-- to participate in later turns. Rebuild the exact immutable delivery source
-- from the adoption ledger; deleted conversations and actor-mismatched rows are
-- deliberately excluded rather than weakening the trigger's ownership proof.
INSERT INTO ai_session_context_sources (
  id,
  session_id,
  workspace_id,
  project_id,
  work_order_id,
  kind,
  source_id,
  evidence,
  created_at
)
SELECT
  gen_random_uuid()::text,
  adoption.source_session_id_snapshot,
  NULL,
  NULL,
  item.work_order_id,
  'work_order_delivery',
  delivery.id || '@' || delivery.revision::text,
  jsonb_build_object(
    'adoptionId', adoption.id,
    'contextVersion', adoption.context_version,
    'audience', 'source_session_actor_only'
  ),
  adoption.created_at
FROM work_order_adoptions adoption
JOIN work_order_adoption_items item
  ON item.adoption_id = adoption.id
JOIN work_order_delivery_revisions delivery
  ON delivery.id = item.delivery_revision_id
 AND delivery.work_order_id = item.work_order_id
JOIN ai_sessions_metadata session
  ON session.id = adoption.source_session_id_snapshot
 AND session.user_id = adoption.actor_id
WHERE adoption.actor_id IS NOT NULL
ON CONFLICT DO NOTHING;
