import { describe, expect, test } from 'vitest';

import { sortFolderChildren } from '../../modules/organize/folder-sorting';
import {
  pageTreeDropTarget,
  pageTreeReorder,
  pageTreeReorderIsNoop,
  samePageTreeOrder,
} from './page-tree-drag';

describe('page tree row drops', () => {
  const row = { nodeId: 'row', top: 100, bottom: 130 };
  test.each([
    [102, true, 'before'],
    [115, true, 'inside'],
    [106, true, 'inside'],
    [124, true, 'inside'],
    [128, true, 'after'],
    [115, false, null],
    [160, true, null],
  ] as const)(
    'pointer %s on container %s resolves to %s',
    (y, container, expected) => {
      expect(pageTreeDropTarget(y, [{ ...row, container }])).toEqual(
        expected ? { nodeId: 'row', placement: expected } : null
      );
    }
  );
  test('the reserved gap above a row belongs to its before slot', () => {
    expect(pageTreeDropTarget(99, [{ ...row, container: true }])).toEqual({
      nodeId: 'row',
      placement: 'before',
    });
  });
  test('the last child and next root row share one canonical gap across every pixel', () => {
    const rows = [
      { nodeId: 'folder', container: true, top: 312, bottom: 346 },
      { nodeId: 'child', container: true, top: 348, bottom: 382 },
      { nodeId: 'untitled', container: true, top: 390, bottom: 424 },
    ];
    for (let y = 377; y < 396; y++) {
      expect(pageTreeDropTarget(y, rows)).toEqual({
        nodeId: 'untitled',
        placement: 'before',
      });
    }
    expect(pageTreeDropTarget(365, rows)).toEqual({
      nodeId: 'child',
      placement: 'inside',
    });
    expect(pageTreeDropTarget(330, rows)).toEqual({
      nodeId: 'folder',
      placement: 'inside',
    });
    expect(pageTreeDropTarget(425, rows)).toBeNull();
  });
  test('self and already adjacent drops are no-ops, including a sorted projection', () => {
    const visible = ['C', 'B', 'A'];
    expect(pageTreeReorderIsNoop(visible, 'B', 'B', 'after')).toBe(true);
    expect(pageTreeReorderIsNoop(visible, 'B', 'C', 'after')).toBe(true);
    expect(pageTreeReorderIsNoop(visible, 'B', 'A', 'before')).toBe(true);
    expect(pageTreeReorderIsNoop(visible, 'A', 'C', 'after')).toBe(false);
    expect(pageTreeReorderIsNoop(visible, 'X', 'C', 'before')).toBe(false);
    expect(pageTreeReorderIsNoop(visible, 'C', 'missing', 'after')).toBe(false);
  });
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
