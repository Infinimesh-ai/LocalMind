WITH inserted AS (
  INSERT INTO notifications (id, user_id, level, type, body)
  SELECT
    'project-invitation:' || invitation.id || ':' || invitation.invitee_user_id,
    invitation.invitee_user_id,
    'Default'::"NotificationLevel",
    'ProjectInvitation'::"NotificationType",
    jsonb_build_object(
      'invitationId', invitation.id,
      'createdByUserId', invitation.inviter_user_id_snapshot
    )
  FROM ai_context_project_invitations invitation
  JOIN ai_context_projects project ON project.id = invitation.project_id
  WHERE invitation.status = 'pending' AND project.status = 'active'
  ON CONFLICT (id) DO NOTHING
  RETURNING user_id
)
INSERT INTO notification_refresh (user_id, revision)
SELECT user_id, gen_random_uuid()::text
FROM (SELECT DISTINCT user_id FROM inserted) recipients
ON CONFLICT (user_id) DO UPDATE
SET revision = EXCLUDED.revision, updated_at = CURRENT_TIMESTAMP;
