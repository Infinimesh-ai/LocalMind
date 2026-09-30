import type { useI18n } from '@affine/i18n';

import type { Relation } from './collaboration-graph-model';

type Translator = ReturnType<typeof useI18n>;

export function orbitStatusLabel(
  status: string,
  side: Relation['side'],
  t: Translator
) {
  switch (status) {
    case 'draft':
      return t['com.affine.localmind.workbench.v9.graphStatusDraft']();
    case 'open':
      return t[
        side === 'left'
          ? 'com.affine.localmind.workbench.v9.graphStatusWaiting'
          : 'com.affine.localmind.workbench.v9.graphStatusMyDelivery'
      ]();
    case 'waiting_sender':
      return t['com.affine.localmind.workbench.v9.graphStatusWaitingSender']();
    case 'validating':
      return t['com.affine.localmind.workbench.v9.graphStatusValidating']();
    case 'delivered':
      return t['com.affine.localmind.workbench.v9.workOrderStatusDelivered']();
    case 'adopted':
      return t['com.affine.localmind.workbench.v9.graphStatusAdopted']();
    case 'refused':
      return t['com.affine.localmind.workbench.v9.workOrderStatusRefused']();
    case 'cancelled':
      return t['com.affine.localmind.workbench.v9.workOrderStatusCancelled']();
    default:
      return status;
  }
}
