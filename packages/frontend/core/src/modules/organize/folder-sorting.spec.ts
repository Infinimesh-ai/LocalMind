import { describe, expect, test } from 'vitest';

import { moveFolderChild, sortFolderChildren } from './folder-sorting';

describe('folder name order', () => {
  const children = ['9-23', '9-9', '10-2', '9-24'].map(name => ({
    id: name,
    name,
  }));
  test('compares date-like numeric names naturally in both directions', () => {
    expect(
      sortFolderChildren(children, 'name-desc', child => child.name).map(
        child => child.name
      )
    ).toEqual(['10-2', '9-24', '9-23', '9-9']);
    expect(
      sortFolderChildren(children, 'name-asc', child => child.name).map(
        child => child.name
      )
    ).toEqual(['9-9', '9-23', '9-24', '10-2']);
    expect(sortFolderChildren(children, 'manual', child => child.name)).toEqual(
      children
    );
    expect(children.map(child => child.name)).toEqual([
      '9-23',
      '9-9',
      '10-2',
      '9-24',
    ]);
  });
  test('handles complete years and uses stable IDs for equal numeric names', () => {
    const dates = ['2025-12-31', '2026-9-24', '2026-10-2'].map(id => ({ id }));
    expect(
      sortFolderChildren(dates, 'name-desc', child => child.id).map(
        child => child.id
      )
    ).toEqual(['2026-10-2', '2026-9-24', '2025-12-31']);
    const same = [
      { id: 'b', name: '09-24' },
      { id: 'a', name: '9-24' },
    ];
    for (const mode of ['name-asc', 'name-desc'] as const)
      expect(
        sortFolderChildren(same, mode, child => child.name).map(
          child => child.id
        )
      ).toEqual(['a', 'b']);
  });
  test('a drag preserves the other items in the displayed order', () => {
    expect(
      moveFolderChild(['10-2', '9-24', '9-23', '9-9'], '9-9', '9-24', 'before')
    ).toEqual(['10-2', '9-9', '9-24', '9-23']);
    expect(moveFolderChild(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(() => moveFolderChild(['a', 'b'], 'missing', 'a', 'before')).toThrow(
      /Folder changed/
    );
  });
});
