import type { useI18n } from '@affine/i18n';

import { orbitStatusLabel } from './collaboration-orbit-labels';

type Translator = ReturnType<typeof useI18n>;

const ATTENTION_LABELS = {
  work_order_delivery_required:
    'com.affine.localmind.workbench.fusion.deliveryRequired',
  work_order_delivery_ready:
    'com.affine.localmind.workbench.fusion.deliveryReady',
  work_order_question: 'com.affine.localmind.workbench.fusion.questionReceived',
  work_order_answered: 'com.affine.localmind.workbench.fusion.answerReceived',
  work_order_refused: 'com.affine.localmind.workbench.fusion.orderRefused',
  work_order_cancelled: 'com.affine.localmind.workbench.fusion.orderCancelled',
  run_waiting_for_approval:
    'com.affine.localmind.workbench.fusion.approvalRequired',
} as const;

export function attentionLabel(reason: string, t: Translator) {
  const key = ATTENTION_LABELS[reason as keyof typeof ATTENTION_LABELS];
  return key
    ? t[key]()
    : t['com.affine.localmind.workbench.fusion.needsAttention']();
}

export function workOrderStatusLabel(
  status: string,
  t: Translator,
  recipient = true
) {
  if (
    ![
      'draft',
      'open',
      'waiting_sender',
      'validating',
      'delivered',
      'adopted',
      'refused',
      'cancelled',
    ].includes(status)
  )
    return t['com.affine.localmind.workbench.fusion.unknownStatus']();
  return orbitStatusLabel(status, recipient ? 'right' : 'left', t);
}

export function workOrderRelationLabel(kind: string, t: Translator) {
  switch (kind) {
    case 'original':
      return t['com.affine.localmind.workbench.fusion.originalOrder']();
    case 'supplement':
      return t['com.affine.localmind.workbench.fusion.supplementOrder']();
    case 'replacement':
      return t['com.affine.localmind.workbench.fusion.replacementOrder']();
    default:
      return t['com.affine.localmind.workbench.fusion.unknownStatus']();
  }
}

export function workOrderExchangeLabel(kind: string, t: Translator) {
  switch (kind) {
    case 'question':
      return t['com.affine.localmind.workbench.v9.exchange.question']();
    case 'answer':
      return t['com.affine.localmind.workbench.v9.exchange.answer']();
    case 'refusal':
      return t['com.affine.localmind.workbench.v9.exchange.refusal']();
    case 'cancellation':
      return t['com.affine.localmind.workbench.v9.exchange.cancellation']();
    default:
      return t['com.affine.localmind.workbench.v9.exchange.recorded']();
  }
}

export function memoryKindLabel(kind: string, t: Translator) {
  switch (kind) {
    case 'rule':
      return t['com.affine.localmind.aiContext.kind.rule']();
    case 'auto_memory':
      return t['com.affine.localmind.aiContext.kind.autoMemory']();
    case 'project_summary':
      return t['com.affine.localmind.aiContext.kind.projectSummary']();
    default:
      return t['com.affine.localmind.workbench.fusion.unknownType']();
  }
}

export function memoryStatusLabel(status: string, t: Translator) {
  switch (status) {
    case 'active':
      return t['com.affine.localmind.workbench.fusion.memoryActive']();
    case 'disabled':
      return t['com.affine.localmind.workbench.fusion.memoryInactive']();
    case 'superseded':
      return t['com.affine.localmind.workbench.fusion.memorySuperseded']();
    case 'deleted':
      return t['com.affine.localmind.workbench.fusion.memoryDeleted']();
    case 'pending_conflict':
      return t['com.affine.localmind.workbench.fusion.memoryConflict']();
    default:
      return t['com.affine.localmind.workbench.fusion.unknownStatus']();
  }
}

export function memoryEventLabel(
  operation: string,
  undone: boolean,
  t: Translator
) {
  if (undone || operation === 'UNDO')
    return t['com.affine.localmind.workbench.fusion.contributionUndone']();
  switch (operation) {
    case 'ADD':
      return t['com.affine.localmind.workbench.fusion.eventAdded']();
    case 'UPDATE':
      return t['com.affine.localmind.workbench.fusion.eventUpdated']();
    case 'DELETE':
      return t['com.affine.localmind.workbench.fusion.eventDeleted']();
    case 'WITHDRAW':
      return t['com.affine.localmind.workbench.fusion.eventWithdrawn']();
    case 'PENDING_CONFLICT':
      return t['com.affine.localmind.workbench.fusion.memoryConflict']();
    case 'NOOP':
      return t['com.affine.localmind.workbench.fusion.eventNoChange']();
    default:
      return t['com.affine.localmind.workbench.fusion.contributionRecorded']();
  }
}
