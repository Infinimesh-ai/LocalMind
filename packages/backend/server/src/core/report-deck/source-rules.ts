import type {
  DeckSourceReason,
  DeckSourceRef,
} from '@localmind/office/report-deck';

/**
 * Pure source-list rules shared by preflight and generation. They never touch
 * storage so they can be unit tested and stay identical in both paths.
 */

export type DeckSourceStatus = 'included' | 'excluded' | 'truncated';

/** Same resource selected twice (even as doc vs file) is one resource. */
export function deckResourceKey(
  scopeKind: string,
  scopeId: string,
  resourceId: string
) {
  return `${scopeKind}:${scopeId}:resource:${resourceId}`;
}

export function deckSourceKey(ref: DeckSourceRef) {
  if (ref.kind === 'project_all') return `project:${ref.scopeId}:all`;
  if (ref.kind === 'folder')
    return `${ref.scopeKind}:${ref.scopeId}:folder:${ref.resourceId}`;
  return deckResourceKey(ref.scopeKind, ref.scopeId, ref.resourceId ?? '');
}

export type PlannedDeckSource = {
  index: number;
  ref: DeckSourceRef;
  /** Set when the source must not be read at all. */
  skip: DeckSourceReason | null;
};

/**
 * Order-preserving dedupe:
 * - exact duplicates keep their first occurrence;
 * - selecting a whole project merges every other source of that project into it;
 * - sources beyond `maxSources` are over budget.
 */
export function planDeckSources(
  refs: readonly DeckSourceRef[],
  maxSources: number
): PlannedDeckSource[] {
  const wholeProjects = new Set(
    refs
      .slice(0, maxSources)
      .filter(ref => ref.kind === 'project_all')
      .map(ref => ref.scopeId)
  );
  const seen = new Set<string>();
  return refs.map((ref, index) => {
    if (index >= maxSources)
      return { index, ref, skip: 'over_budget' as const };
    const key = deckSourceKey(ref);
    if (seen.has(key)) return { index, ref, skip: 'duplicate' as const };
    seen.add(key);
    if (
      ref.kind !== 'project_all' &&
      ref.scopeKind === 'project' &&
      wholeProjects.has(ref.scopeId)
    )
      return { index, ref, skip: 'duplicate' as const };
    return { index, ref, skip: null };
  });
}

export type DeckBudgetDecision = {
  status: DeckSourceStatus;
  reason: DeckSourceReason | null;
  /** Characters that may be supplied to the model from this source. */
  keep: number;
};

/**
 * Allocate the total character budget in selection order. A source that only
 * partly fits is truncated; once the budget is spent later sources are excluded.
 */
export function allocateDeckBudget(
  chars: readonly number[],
  maxChars: number
): DeckBudgetDecision[] {
  let used = 0;
  return chars.map(length => {
    if (length <= 0) return { status: 'excluded', reason: 'empty', keep: 0 };
    const remaining = maxChars - used;
    if (remaining <= 0)
      return { status: 'excluded', reason: 'over_budget', keep: 0 };
    if (length > remaining) {
      used = maxChars;
      return { status: 'truncated', reason: null, keep: remaining };
    }
    used += length;
    return { status: 'included', reason: null, keep: length };
  });
}

/** Rough time estimate shown in preflight: one model call per 48k chars plus composition. */
export function estimateDeckMinutes(totalChars: number) {
  const calls = Math.ceil(totalChars / 48000) + 2;
  return Math.max(1, Math.ceil((calls * 25) / 60));
}

/** Cut a source's documents to `keep` characters, preserving order. */
export function truncateDocuments<T extends { text: string }>(
  documents: readonly T[],
  keep: number
): T[] {
  const result: T[] = [];
  let remaining = keep;
  for (const document of documents) {
    if (remaining <= 0) break;
    const text = document.text.slice(0, remaining);
    if (!text.trim()) continue;
    result.push({ ...document, text });
    remaining -= text.length;
  }
  return result;
}
