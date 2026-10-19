import { Button, notify } from '@affine/component';
import { useLegacyProjectReportsEnabled } from '@affine/core/components/report-deck-entry';
import {
  getProjectPath,
  getProjectReportPath,
  getReportDecksPath,
} from '@affine/core/desktop/route-paths';
import {
  type Notification,
  NotificationListService,
} from '@affine/core/modules/notification';
import { useReportText } from '@affine/core/modules/project-reports/i18n';
import { UserFriendlyError } from '@affine/error';
import { useService } from '@toeverything/infra';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { NotificationItemActions } from './cleanup-actions';
import * as styles from './list.style.css';

const schema = z.object({
  projectId: z.string(),
  reportId: z.string().nullish(),
  scheduleId: z.string().nullish(),
  status: z.string(),
  title: z.string(),
  url: z.string().optional(),
});
export function ProjectReportNotificationItem({
  notification,
}: {
  notification: Notification;
}) {
  const t = useReportText();
  const list = useService(NotificationListService);
  const navigate = useNavigate();
  const legacyReports = useLegacyProjectReportsEnabled();
  const parsed = schema.safeParse(notification.body);
  if (!parsed.success) return null;
  const body = parsed.data;
  // Legacy share links keep working; studio links go to the report decks
  // home while the legacy studio is switched off.
  const destination = body.url?.startsWith('/share/reports/')
    ? body.url
    : !legacyReports
      ? getReportDecksPath()
      : body.reportId
        ? getProjectReportPath(body.projectId, body.reportId)
        : `${getProjectPath(body.projectId)}/report-schedules`;
  return (
    <div className={styles.itemContainer} data-interactive="false">
      <div className={styles.itemMain}>
        <strong className={styles.workOrderTitle}>
          {body.status === 'unavailable' ? t('reportUnavailable') : body.title}
        </strong>
        <div className={styles.workOrderSummary}>
          {t('reports')} · {t(body.status)}
        </div>
        <div className={styles.workOrderFooter}>
          {body.status !== 'unavailable' && (
            <Button
              variant="custom"
              className={styles.workOrderLink}
              onClick={() => {
                navigate(destination);
                void list
                  .readNotification(notification.id)
                  .catch(error =>
                    notify.error(UserFriendlyError.fromAny(error))
                  );
              }}
            >
              {t('open')}
            </Button>
          )}
          <NotificationItemActions notification={notification} />
        </div>
      </div>
    </div>
  );
}
