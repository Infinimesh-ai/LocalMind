import {
  DECK_SOURCE_LIMIT,
  type DeckSourceRef,
  DeckSourceRefSchema,
} from '@localmind/office/report-deck';
import { nanoid } from 'nanoid';

import { getNewReportDeckPath } from '../../desktop/route-paths';

const KEY_PREFIX = 'report-deck:handoff:';

/**
 * Entry points (document multi-select, project rows) hand their selection to
 * the configuration page through sessionStorage, so long selections never end
 * up in the URL. Returns the configuration page path to navigate to.
 */
export function stashDeckSources(sources: DeckSourceRef[]): string {
  const id = nanoid(10);
  try {
    sessionStorage.setItem(
      `${KEY_PREFIX}${id}`,
      JSON.stringify(sources.slice(0, DECK_SOURCE_LIMIT))
    );
  } catch {
    return getNewReportDeckPath();
  }
  return getNewReportDeckPath(id);
}

/** Reads a handoff once; later reads (e.g. after reload) return the same value. */
export function readDeckSources(id: string | null): DeckSourceRef[] {
  if (!id) return [];
  try {
    const raw = sessionStorage.getItem(`${KEY_PREFIX}${id}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(item => {
      const result = DeckSourceRefSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}
