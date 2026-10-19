import type { ProjectResourceKind } from '@affine/graphql';
import { useCallback, useSyncExternalStore } from 'react';

export type RecentProjectFile = {
  projectId: string;
  projectName: string;
  resourceId: string;
  parentId: string | null;
  title: string;
  kind: ProjectResourceKind;
  openedAt: number;
};

export const RECENT_LIMIT = 30;
const STORAGE_PREFIX = 'localmind.project-browser.recent';
const EMPTY: readonly RecentProjectFile[] = [];

const storageKey = (userId: string | null | undefined) =>
  `${STORAGE_PREFIX}:${userId ?? 'guest'}`;

const listeners = new Set<() => void>();
// useSyncExternalStore needs a stable snapshot per storage value.
const snapshots = new Map<
  string,
  { raw: string | null; value: readonly RecentProjectFile[] }
>();

const isRecent = (value: unknown): value is RecentProjectFile => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.projectId === 'string' &&
    typeof entry.resourceId === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.kind === 'string' &&
    typeof entry.openedAt === 'number'
  );
};

export function readRecentProjectFiles(
  userId: string | null | undefined
): readonly RecentProjectFile[] {
  const key = storageKey(userId);
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return EMPTY;
  }
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.value;
  let value: readonly RecentProjectFile[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      value = parsed
        .filter(isRecent)
        .map(entry => ({
          ...entry,
          parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
          projectName:
            typeof entry.projectName === 'string' ? entry.projectName : '',
        }))
        .slice(0, RECENT_LIMIT);
  } catch {
    value = EMPTY;
  }
  snapshots.set(key, { raw, value });
  return value;
}

const write = (
  userId: string | null | undefined,
  entries: RecentProjectFile[]
) => {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(entries));
  } catch {
    // Recents are a convenience; browsing works without storage.
  }
  listeners.forEach(listener => listener());
};

/** Records an opened project file, newest first, de-duplicated, capped. */
export function recordRecentProjectFile(
  userId: string | null | undefined,
  entry: Omit<RecentProjectFile, 'openedAt'> & { openedAt?: number }
) {
  const current = readRecentProjectFiles(userId);
  const head = current[0];
  if (
    head &&
    head.projectId === entry.projectId &&
    head.resourceId === entry.resourceId &&
    head.title === entry.title &&
    head.parentId === entry.parentId &&
    head.projectName === entry.projectName
  )
    return;
  write(
    userId,
    [
      { ...entry, openedAt: entry.openedAt ?? Date.now() },
      ...current.filter(
        item =>
          item.projectId !== entry.projectId ||
          item.resourceId !== entry.resourceId
      ),
    ].slice(0, RECENT_LIMIT)
  );
}

export function removeRecentProjectFile(
  userId: string | null | undefined,
  projectId: string,
  resourceId: string
) {
  write(
    userId,
    readRecentProjectFiles(userId).filter(
      item => item.projectId !== projectId || item.resourceId !== resourceId
    )
  );
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(STORAGE_PREFIX)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

export function useRecentProjectFiles(userId: string | null | undefined) {
  const getSnapshot = useCallback(
    () => readRecentProjectFiles(userId),
    [userId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
