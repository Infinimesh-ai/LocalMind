import { Avatar, Button } from '@affine/component';
import {
  getProjectConversationPath,
  getWorkOrderPath,
} from '@affine/core/desktop/route-paths';
import {
  type Notification,
  NotificationListService,
} from '@affine/core/modules/notification';
import type { WorkOrderNotificationBodyType } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useNavigate } from 'react-router-dom';

import * as styles from './list.style.css';

export function WorkOrderNotificationItem({
  notification,
}: {
  notification: Notification;
}) {
  const t = useI18n();
  const list = useService(NotificationListService);
  const navigate = useNavigate();
  const body = notification.body as WorkOrderNotificationBodyType;
  const unavailable = body.status === 'unavailable';
  const destination =
    body.viewerRole === 'sender' && body.sourceProjectId && body.sourceSessionId
      ? getProjectConversationPath(body.sourceProjectId, body.sourceSessionId)
      : getWorkOrderPath(body.workOrderId);

  return (
    <div className={styles.itemContainer}>
      <Avatar
        size={22}
        name={body.createdByUser?.name}
        url={body.createdByUser?.avatarUrl}
      />
      <div className={styles.itemMain}>
        <strong>
          {body.title ||
            t['com.affine.localmind.workbench.v9.personalWorkOrder']()}
        </strong>
        <div>{t['com.affine.localmind.workbench.v9.workOrderNotice']()}</div>
        <div className={styles.itemDate}>{body.status}</div>
        <Button
          disabled={unavailable}
          onClick={() => {
            navigate(destination);
            list.readNotification(notification.id).catch(console.error);
          }}
        >
          {t['com.affine.localmind.workbench.v9.openWorkOrder']()}
        </Button>
      </div>
    </div>
  );
}
