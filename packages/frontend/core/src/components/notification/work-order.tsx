import { Avatar, Button, notify } from '@affine/component';
import {
  getProjectConversationPath,
  getWorkOrderPath,
} from '@affine/core/desktop/route-paths';
import {
  type Notification,
  NotificationListService,
} from '@affine/core/modules/notification';
import { UserFriendlyError } from '@affine/error';
import type { WorkOrderNotificationBodyType } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { ArrowRightSmallIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useNavigate } from 'react-router-dom';

import { NotificationItemActions } from './cleanup-actions';
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
  const statusLabels: Record<string, string> = {
    draft: t['com.affine.localmind.workbench.v9.graphStatusDraft'](),
    open: t['com.affine.localmind.workbench.v9.workOrderStatusOpen'](),
    waiting_sender:
      t['com.affine.localmind.workbench.v9.graphStatusWaitingSender'](),
    validating: t['com.affine.localmind.workbench.v9.graphStatusValidating'](),
    delivered:
      t['com.affine.localmind.workbench.v9.workOrderStatusDelivered'](),
    adopted: t['com.affine.localmind.workbench.v9.graphStatusAdopted'](),
    refused: t['com.affine.localmind.workbench.v9.workOrderStatusRefused'](),
    cancelled:
      t['com.affine.localmind.workbench.v9.workOrderStatusCancelled'](),
    unavailable: t['com.affine.localmind.accessNotification.unavailable'](),
  };
  const destination =
    body.viewerRole === 'sender' && body.sourceProjectId && body.sourceSessionId
      ? getProjectConversationPath(
          body.sourceProjectId,
          body.sourceSessionId,
          body.workOrderId
        )
      : getWorkOrderPath(body.workOrderId);

  return (
    <div className={styles.itemContainer} data-interactive="false">
      <Avatar
        size={22}
        name={body.createdByUser?.name}
        url={body.createdByUser?.avatarUrl}
      />
      <div className={styles.itemMain}>
        <strong
          className={styles.workOrderTitle}
          title={body.title || undefined}
        >
          {body.title ||
            t['com.affine.localmind.workbench.v9.personalWorkOrder']()}
        </strong>
        <div className={styles.workOrderSummary}>
          <span>
            {t['com.affine.localmind.workbench.v9.workOrderNotice']()}
          </span>
          {statusLabels[body.status] && (
            <span>{statusLabels[body.status]}</span>
          )}
        </div>
        <div className={styles.workOrderFooter}>
          <Button
            variant="custom"
            className={styles.workOrderLink}
            suffix={<ArrowRightSmallIcon />}
            disabled={unavailable}
            onClick={() => {
              navigate(destination);
              list
                .readNotification(notification.id)
                .catch(error => notify.error(UserFriendlyError.fromAny(error)));
            }}
          >
            {t['com.affine.localmind.workbench.v9.openWorkOrder']()}
          </Button>
          <NotificationItemActions notification={notification} />
        </div>
      </div>
    </div>
  );
}
