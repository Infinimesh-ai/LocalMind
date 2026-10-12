import { describe, expect, test } from 'vitest';

import { sortFolderChildren } from '../../modules/organize/folder-sorting';
import {
  pageTreeDropPlacement,
  pageTreeReorder,
  samePageTreeOrder,
} from './page-tree-drag';

describe('page tree row drops', () => {
  const row = { top: 100, bottom: 130, height: 30 };
  test.each([
    [102, true, 'before'],
    [115, true, 'inside'],
    [128, true, 'after'],
    [115, false, null],
    [160, true, null],
  ] as const)(
    'pointer %s on container %s resolves to %s',
    (y, container, expected) => {
      expect(pageTreeDropPlacement(y, row, container)).toBe(expected);
    }
  );
  test.each(['name-asc', 'name-desc'] as const)(
    'preserves the other siblings when leaving %s',
    mode => {
      const visible = sortFolderChildren(
        ['B', 'A', 'C'].map(id => ({ id })),
        mode,
        node => node.id
      ).map(node => node.id);
      expect(pageTreeReorder(visible, 'C', 'B', 'before')).toEqual(
        mode === 'name-asc' ? ['A', 'C', 'B'] : ['C', 'B', 'A']
      );
    }
  );
  test('resolves anchors after removing the source, including already adjacent drops', () => {
    const order = pageTreeReorder(['A', 'B', 'C'], 'B', 'A', 'after');
    expect(order).toEqual(['A', 'B', 'C']);
    expect(samePageTreeOrder(order!, ['A', 'B', 'C'])).toBe(true);
    expect(pageTreeReorder(['A', 'B', 'C'], 'B', 'B', 'before')).toBeNull();
  });
  test('inserts a resource from another parent into the complete visible level', () => {
    expect(pageTreeReorder(['A', 'B', 'C'], 'X', 'B', 'after')).toEqual([
      'A',
      'B',
      'X',
      'C',
    ]);
    expect(() => pageTreeReorder(['A'], 'X', 'missing', 'before')).toThrow();
  });
});
