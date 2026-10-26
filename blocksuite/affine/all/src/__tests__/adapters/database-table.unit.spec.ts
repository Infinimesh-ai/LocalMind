import type { ColumnDataType } from '@blocksuite/affine-model';
import type { BlockSnapshot } from '@blocksuite/store';
import { describe, expect, test } from 'vitest';

import { processTable } from '../../../../blocks/database/src/adapters/utils';

const title = {
  '$blocksuite:internal:text$': true,
  delta: [{ insert: 'QA-任务一' }],
};
const child: BlockSnapshot = {
  type: 'block',
  id: 'row',
  flavour: 'affine:paragraph',
  props: { text: title },
  children: [],
};
const amount: ColumnDataType = {
  id: 'amount',
  type: 'number',
  name: '金额',
  data: { decimal: 0 },
};
const titleColumn: ColumnDataType = {
  id: 'title',
  type: 'title',
  name: '任务',
  data: {},
};
const cells = { row: { amount: { columnId: 'amount', value: 60 } } };

describe('database export column alignment', () => {
  test('includes the implicit title header without shifting property values', () => {
    const table = processTable([amount], [child], cells);
    expect(table.headers.map(column => column.name)).toEqual(['Title', '金额']);
    expect(table.rows[0].cells.map(cell => cell.value)).toEqual([title, '60']);
  });

  test('uses the explicit title name and position without duplicating it', () => {
    const table = processTable([amount, titleColumn], [child], cells);
    expect(table.headers.map(column => column.name)).toEqual(['金额', '任务']);
    expect(table.rows[0].cells.map(cell => cell.value)).toEqual(['60', title]);
  });
});
