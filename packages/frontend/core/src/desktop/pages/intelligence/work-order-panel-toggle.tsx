import { useI18n } from '@affine/i18n';
import { InboxIcon, SendIcon } from '@blocksuite/icons/rc';

import * as styles from './workbench-conversation.css';

/** Title-card entry for the work order card; replaces the collapsed side rail. */
export function WorkOrderPanelToggle({
  direction,
  expanded,
  attention,
  onToggle,
}: {
  /** Sent from this conversation, or received as a personal work order. */
  direction: 'sent' | 'received';
  expanded: boolean;
  attention: boolean;
  onToggle: () => void;
}) {
  const t = useI18n();
  return (
    <button
      type="button"
      className={styles.orderToggle}
      aria-expanded={expanded}
      aria-controls="work-order-details"
      data-attention={attention}
      title={t[
        expanded
          ? 'com.affine.localmind.workbench.v9.collapseWorkOrderPanel'
          : 'com.affine.localmind.workbench.v9.expandWorkOrderPanel'
      ]()}
      onClick={onToggle}
    >
      {direction === 'sent' ? <SendIcon /> : <InboxIcon />}
      <span>{t['com.affine.localmind.workbench.orders.toggle']()}</span>
    </button>
  );
}
