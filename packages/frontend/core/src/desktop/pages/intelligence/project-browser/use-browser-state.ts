import { ProjectResourceKind } from '@affine/graphql';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProjectFile } from '../project-files-data';

export const BROWSER_VIEW_MODES = [
  'icons',
  'list',
  'columns',
  'gallery',
] as const;
export type BrowserViewMode = (typeof BROWSER_VIEW_MODES)[number];
export const BROWSER_SORT_KEYS = [
  'manual',
  'name',
  'kind',
  'modified',
] as const;
export type BrowserSortKey = (typeof BROWSER_SORT_KEYS)[number];
export type BrowserSort = { key: BrowserSortKey; direction: 'asc' | 'desc' };
export type SearchScope = 'all' | 'project';
export type BrowserLocation = {
  projectId: string | null;
  folderId: string | null;
};
/** Select `resourceId` once the browser shows `folderId` of `projectId`. */
export type BrowserReveal = {
  projectId: string;
  folderId: string | null;
  resourceId: string;
};

export const BROWSER_PREFS_KEY = 'localmind.project-browser.prefs';
const DEFAULT_PREFS = {
  viewMode: 'icons' as BrowserViewMode,
  sort: { key: 'manual', direction: 'asc' } as BrowserSort,
};
const HISTORY_LIMIT = 100;

export function readBrowserPrefs(): typeof DEFAULT_PREFS {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(BROWSER_PREFS_KEY) ?? '{}'
    ) as Record<string, unknown>;
    const sort = (saved.sort ?? {}) as Record<string, unknown>;
    return {
      viewMode: BROWSER_VIEW_MODES.includes(saved.viewMode as BrowserViewMode)
        ? (saved.viewMode as BrowserViewMode)
        : DEFAULT_PREFS.viewMode,
      sort: {
        key: BROWSER_SORT_KEYS.includes(sort.key as BrowserSortKey)
          ? (sort.key as BrowserSortKey)
          : DEFAULT_PREFS.sort.key,
        direction: sort.direction === 'desc' ? 'desc' : 'asc',
      },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writeBrowserPrefs(prefs: typeof DEFAULT_PREFS) {
  try {
    window.localStorage.setItem(BROWSER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences fall back to defaults when storage is unavailable.
  }
}

const KIND_ORDER: Record<string, number> = {
  [ProjectResourceKind.folder]: 0,
  [ProjectResourceKind.page]: 1,
  [ProjectResourceKind.edgeless]: 2,
  [ProjectResourceKind.document]: 3,
  [ProjectResourceKind.workbook]: 4,
  [ProjectResourceKind.presentation]: 5,
  [ProjectResourceKind.pdf]: 6,
  [ProjectResourceKind.file]: 7,
};
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/**
 * Client-side sort over the loaded folder page. "manual" keeps the server's
 * sort-key order (the order Move up/down edits); other keys list folders first.
 */
export function sortProjectFiles<
  T extends Pick<ProjectFile, 'kind' | 'title' | 'updatedAt'>,
>(items: readonly T[], sort: BrowserSort): T[] {
  if (sort.key === 'manual') return [...items];
  const factor = sort.direction === 'desc' ? -1 : 1;
  const time = (value: unknown) => {
    const parsed = Date.parse(String(value ?? ''));
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return [...items].sort((a, b) => {
    const folderA = a.kind === ProjectResourceKind.folder ? 0 : 1;
    const folderB = b.kind === ProjectResourceKind.folder ? 0 : 1;
    if (folderA !== folderB) return folderA - folderB;
    let result = 0;
    if (sort.key === 'kind')
      result = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
    else if (sort.key === 'modified')
      result = time(a.updatedAt) - time(b.updatedAt);
    if (result === 0) result = collator.compare(a.title, b.title);
    return result * factor;
  });
}

const sameLocation = (a: BrowserLocation, b: BrowserLocation) =>
  a.projectId === b.projectId && a.folderId === b.folderId;

/**
 * State shared by the documents sidebar and the project browser. `location`
 * comes from the URL; `undefined` means it is still resolving and must not be
 * recorded in the browser history.
 */
export function useProjectBrowserState({
  location,
  onNavigate,
}: {
  location:
    | { projectId: string | null; folderId: string | null | undefined }
    | undefined;
  onNavigate: (location: BrowserLocation) => void;
}) {
  const [prefs, setPrefs] = useState(readBrowserPrefs);
  useEffect(() => writeBrowserPrefs(prefs), [prefs]);
  const setViewMode = useCallback(
    (viewMode: BrowserViewMode) =>
      setPrefs(current => ({ ...current, viewMode })),
    []
  );
  const setSort = useCallback(
    (sort: BrowserSort) => setPrefs(current => ({ ...current, sort })),
    []
  );
  const [trash, setTrash] = useState(false);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [reveal, setReveal] = useState<BrowserReveal | null>(null);
  const [history, setHistory] = useState<{
    entries: BrowserLocation[];
    index: number;
  }>({ entries: [], index: -1 });
  const pendingIndex = useRef<number | null>(null);
  const previousProject = useRef<string | null | undefined>(undefined);

  const projectId = location?.projectId;
  const folderId = location?.folderId;
  useEffect(() => {
    if (projectId === undefined || folderId === undefined) return;
    const next = { projectId, folderId };
    const pending = pendingIndex.current;
    pendingIndex.current = null;
    setHistory(current => {
      const at = current.entries[current.index];
      if (at && sameLocation(at, next)) return current;
      const target = pending === null ? undefined : current.entries[pending];
      if (pending !== null && target && sameLocation(target, next))
        return { ...current, index: pending };
      const entries = [
        ...current.entries.slice(0, current.index + 1),
        next,
      ].slice(-HISTORY_LIMIT);
      return { entries, index: entries.length - 1 };
    });
    // Switching between two projects leaves the previous project's trash.
    if (
      previousProject.current &&
      projectId &&
      previousProject.current !== projectId
    )
      setTrash(false);
    if (projectId !== undefined) previousProject.current = projectId;
  }, [projectId, folderId]);

  const go = (index: number) => {
    const target = history.entries[index];
    if (!target) return;
    pendingIndex.current = index;
    onNavigate(target);
  };

  return {
    viewMode: prefs.viewMode,
    setViewMode,
    sort: prefs.sort,
    setSort,
    trash,
    setTrash,
    search,
    setSearch,
    scope,
    setScope,
    reveal,
    setReveal,
    navigate: onNavigate,
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
    goBack: () => go(history.index - 1),
    goForward: () => go(history.index + 1),
  };
}

export type ProjectBrowserState = ReturnType<typeof useProjectBrowserState>;
