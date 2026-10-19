import { expect, test } from 'vitest';

import { calcColumns, calcLayout } from './utils';

test.each([0, 32, 160, 260])(
  'a %ipx viewport always retains one finite stretch column',
  totalWidth => {
    const { columns, width } = calcColumns(totalWidth, 'stretch', 220, 24, 20);
    expect(columns).toBe(1);
    expect(width).toBe(Math.max(0, totalWidth - 40));
    const { layout, height } = calcLayout(
      [{ id: 'all', height: 0, items: [{ id: 'file', height: 120 }] }],
      {
        totalWidth,
        columns,
        width,
        gapX: 24,
        gapY: 24,
        paddingX: 20,
        paddingY: 0,
        groupsGap: 0,
        groupHeaderGapWithItems: 0,
        collapsedGroups: [],
      }
    );
    expect(height).toBe(120);
    expect(layout.get('all:file')).toEqual({
      type: 'item',
      x: 20,
      y: 0,
      w: width,
      h: 120,
    });
  }
);

test.each(['stretch', 220] as const)(
  '%s columns use all available space at the exact breakpoint',
  itemWidth => {
    expect(calcColumns(504, itemWidth, 220, 24, 20)).toEqual({
      columns: 2,
      width: 220,
    });
    expect(calcColumns(160, itemWidth, 220, 24, 20).columns).toBe(1);
  }
);
