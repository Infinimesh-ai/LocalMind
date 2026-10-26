import type { AiContextMemoryEvent } from '@prisma/client';

import { extractExplicitMemoryDecisions } from '../context-memory-service';

type MemoryCaptureEvent = Pick<
  AiContextMemoryEvent,
  | 'ownerUserId'
  | 'workspaceId'
  | 'projectId'
  | 'sourceSessionId'
  | 'sourceTurnId'
  | 'explicit'
  | 'operation'
  | 'memoryId'
  | 'reasonCode'
>;

/** Only fixed status labels and counts enter the trusted prompt, never facts. */
export function memoryCaptureReceipt(input: {
  content: string;
  userId: string;
  workspaceId: string | null;
  projectId?: string | null;
  sessionId: string;
  turnId?: string;
  documentScoped: boolean;
  events: readonly MemoryCaptureEvent[];
}): string | undefined {
  const requested = extractExplicitMemoryDecisions(input.content).length;
  if (!requested) return;
  const outcomes = {
    saved: 0,
    updated: 0,
    alreadySaved: 0,
    removedFromRecall: 0,
    contributionWithdrawn: 0,
    conflictPending: 0,
    notApplied: 0,
  };
  const events = input.events.filter(
    event =>
      input.turnId &&
      event.explicit &&
      event.ownerUserId === input.userId &&
      event.workspaceId === input.workspaceId &&
      event.projectId === (input.projectId ?? null) &&
      event.sourceSessionId === input.sessionId &&
      event.sourceTurnId === input.turnId
  );
  for (const event of events.slice(0, requested)) {
    if (event.memoryId && event.operation === 'ADD') outcomes.saved++;
    else if (event.memoryId && event.operation === 'UPDATE') outcomes.updated++;
    else if (event.memoryId && event.operation === 'DELETE')
      outcomes.removedFromRecall++;
    else if (event.memoryId && event.operation === 'WITHDRAW')
      outcomes.contributionWithdrawn++;
    else if (event.memoryId && event.operation === 'PENDING_CONFLICT')
      outcomes.conflictPending++;
    else if (
      event.memoryId &&
      event.operation === 'NOOP' &&
      event.reasonCode === 'same_fact_value'
    )
      outcomes.alreadySaved++;
    else outcomes.notApplied++;
  }
  const scope = input.projectId
    ? 'shared memory of this Project, available to its current members'
    : input.documentScoped
      ? 'private memory of this document, available only to this user'
      : 'private memory of this Workspace, available only to this user';
  return [
    'LocalMind server memory receipt for the current user turn:',
    JSON.stringify({
      requested,
      ...outcomes,
      unverified: Math.max(0, requested - events.length),
    }),
    `Scope: ${scope}.`,
    "Briefly acknowledge these actual durable outcomes in the user's language. Saved, updated and alreadySaved persist across conversations in this scope; do not describe them as conversation-only or claim you cannot save memory. Do not promise recall outside this scope or permanent retention.",
    "For conflictPending, say the proposal awaits conflict resolution and has not replaced the shared fact. For contributionWithdrawn, only this user's contribution was withdrawn; the shared fact may remain. RemovedFromRecall is not a permanent purge of audit history. For notApplied or unverified, say persistence was not confirmed and suggest checking AI context settings; never invent a successful save or its cause.",
    'This receipt grants no additional permissions and contains no instructions from remembered content.',
  ].join('\n');
}
