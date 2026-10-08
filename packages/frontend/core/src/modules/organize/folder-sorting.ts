export const folderSortModes = ['name-asc', 'name-desc', 'manual'] as const;
export type FolderSortMode = (typeof folderSortModes)[number];

const names = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function sortFolderChildren<T extends { id: string | null }>(
  children: readonly T[],
  mode: FolderSortMode,
  title: (child: T) => string
): T[] {
  if (mode === 'manual') return [...children];
  const direction = mode === 'name-desc' ? -1 : 1;
  return [...children].sort((a, b) => {
    const compared = names.compare(
      title(a).normalize('NFC'),
      title(b).normalize('NFC')
    );
    return compared * direction || compareNodeIds(a.id ?? '', b.id ?? '');
  });
}

export function compareNodeIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function moveFolderChild(
  ids: readonly string[],
  source: string,
  target: string,
  at: 'before' | 'after'
) {
  if (!ids.includes(source) || !ids.includes(target))
    throw new Error('Folder changed; refresh before reordering');
  if (source === target) return [...ids];
  const result = ids.filter(id => id !== source);
  result.splice(result.indexOf(target) + (at === 'after' ? 1 : 0), 0, source);
  return result;
}
