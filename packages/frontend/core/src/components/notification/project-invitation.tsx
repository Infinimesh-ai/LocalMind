import { Avatar, Button, notify } from '@affine/component';
import {
  type Notification,
  NotificationListService,
} from '@affine/core/modules/notification';
import { UserFriendlyError } from '@affine/error';
import type { ProjectInvitationNotificationBodyType } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useNavigate } from 'react-router-dom';

import * as styles from './list.style.css';

export function ProjectInvitationNotificationItem({
  notification,
}: {
  notification: Notification;
}) {
  const t = useI18n();
  const list = useService(NotificationListService);
  const navigate = useNavigate();
  const body = notification.body as ProjectInvitationNotificationBodyType;
  const statusLabels: Record<string, string> = {
    pending: t['com.affine.localmind.workbench.status.pending'](),
    accepted: t['com.affine.localmind.workbench.status.accepted'](),
    declined: t['com.affine.localmind.workbench.status.declined'](),
    withdrawn: t['com.affine.localmind.workbench.status.withdrawn'](),
  };
  const statusLabel =
    statusLabels[body.status] ??
    t['com.affine.localmind.accessNotification.unavailable']();

  return (
    <div className={styles.itemContainer}>
      <Avatar
        size={22}
        name={body.createdByUser?.name}
        url={body.createdByUser?.avatarUrl}
      />
      <div className={styles.itemMain}>
        <strong>
          {t['com.affine.localmind.tasks.authorization.invitation']()}
        </strong>
        <div>
          {body.createdByUser?.name ?? t['com.affine.inactive-member']()} ·{' '}
          {body.projectName}
        </div>
        <div className={styles.itemDate}>{statusLabel}</div>
        {body.status === 'pending' && (
          <Button
            onClick={() => {
              navigate(
                `/tasks?taskId=${encodeURIComponent(`project-invitation:${body.invitationId}`)}`
              );
              void list.readNotification(notification.id).catch(error => {
                notify.error(UserFriendlyError.fromAny(error));
              });
            }}
          >
            {t['com.affine.localmind.projectInvitation.view']()}
          </Button>
        )}
      </div>
    </div>
  );
}
