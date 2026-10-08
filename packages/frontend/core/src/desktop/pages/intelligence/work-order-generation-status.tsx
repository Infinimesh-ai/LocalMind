import { useI18n } from '@affine/i18n';

import type { WorkOrder } from './work-order-panel';
import * as styles from './workbench-conversation.css';

export function WorkOrderGenerationStatus({
  order,
}: {
  order: Pick<
    WorkOrder,
    'viewerRole' | 'status' | 'deliveryDraft' | 'requirements'
  >;
}) {
  const t = useI18n();
  if (
    order.viewerRole !== 'recipient' ||
    !['open', 'waiting_sender', 'validating'].includes(order.status)
  )
    return null;
  const pending =
    order.deliveryDraft?.checks.filter(
      check => !check.ready && check.generation
    ) ?? [];
  if (!pending.length) return null;
  return (
    <section
      className={styles.deliveryCard}
      aria-label={t['com.affine.localmind.workbench.v9.fileGenerationStatus']()}
    >
      {pending.map(check => {
        const generation = check.generation;
        if (!generation) return null;
        const running = ['queued', 'running'].includes(generation.status);
        const key = running
          ? 'fileGenerationPending'
          : generation.failureCode === 'mime_mismatch'
            ? 'fileGenerationFormatMismatch'
            : 'fileGenerationFailed';
        const requirement = order.requirements.find(
          item => item.id === check.requirementId
        );
        return (
          <div
            key={check.requirementId}
            className={styles.deliveryCardHeader}
            role={running ? 'status' : 'alert'}
          >
            <strong>{requirement?.title}</strong>
            <span>{t[`com.affine.localmind.workbench.v9.${key}`]()}</span>
            {!running ? (
              <span>
                {t[
                  'com.affine.localmind.workbench.v9.fileGenerationRecovery'
                ]()}
              </span>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
