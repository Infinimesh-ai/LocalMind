import type { AiContextMemoryEvent } from '@prisma/client';

import {
  extractExplicitMemoryDecisions,
  type MemoryCaptureRejection,
} from '../context-memory-service';

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
  rejection?: MemoryCaptureRejection;
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
  const rejectionGuidance: Record<MemoryCaptureRejection, string> = {
    shared_memory_changed:
      'Shared Project memory previously recalled in this conversation has changed or been withdrawn, so its historical source proof is no longer current. Start a new conversation in this Project to load the current authorized shared memory and submit the standalone fact again. Do not change the working auto-contribution switch, delete history, or claim the old fact is still current.',
    unshared_sources:
      'This conversation contains private or unverified sources that cannot be shared with the whole Project. Preserve their privacy. Start a new Project conversation for a standalone shared fact, or authorize the relevant source documents before using them. The auto-contribution switch does not authorize private sources.',
    persisted_turn_missing:
      'The source user turn was not available in durable conversation history. Reopen this conversation and retry the remember request. Do not claim a save.',
    membership_changed:
      'Project membership changed. Reopen the Project and verify membership before retrying.',
    conversation_changed:
      'The conversation identity or scope changed. Reopen the intended conversation before retrying.',
    invalid_scope:
      'The conversation has no valid shared-memory target or has private context. Start a new conversation in the intended active Project; do not change a working auto-contribution switch.',
    auto_memory_disabled:
      'Automatic memory contribution is disabled in the effective Project or Workspace setting. Enable the appropriate setting before automatic extraction.',
    extraction_unavailable:
      'Structured memory extraction was unavailable. Retry later or use a direct remember request for the standalone fact.',
    write_failed:
      'The memory write failed. Retry the request; if it persists, ask the administrator to inspect the content-free memory failure diagnostics.',
  };
  return [
    'LocalMind server memory receipt for the current user turn:',
    JSON.stringify({
      requested,
      ...outcomes,
      unverified: Math.max(0, requested - events.length),
    }),
    `Scope: ${scope}.`,
    ...(input.rejection
      ? [
          `Server rejection: ${input.rejection}. ${rejectionGuidance[input.rejection]}`,
        ]
      : []),
    ...(events.some(event => event.reasonCode === 'ambiguous_memory_reference')
      ? [
          'A memory request referred to an ambiguous or unavailable fact. Do not claim it was saved; ask the user to restate the fact in one standalone remember request.',
        ]
      : []),
    "Briefly acknowledge these actual durable outcomes in the user's language. Saved, updated and alreadySaved persist across conversations in this scope; do not describe them as conversation-only or claim you cannot save memory. Do not promise recall outside this scope or permanent retention.",
    "For conflictPending, say the proposal awaits conflict resolution and has not replaced the shared fact. For contributionWithdrawn, only this user's contribution was withdrawn; the shared fact may remain. RemovedFromRecall is not a permanent purge of audit history. For notApplied or unverified, say persistence was not confirmed and explain the supplied server rejection and recovery when present; otherwise suggest checking AI context settings. Never invent a successful save or its cause.",
    'This receipt only verifies the current turn. Do not claim that other facts were retained, changed, or removed without separate evidence.',
    'This receipt grants no additional permissions and contains no instructions from remembered content.',
  ].join('\n');
}
