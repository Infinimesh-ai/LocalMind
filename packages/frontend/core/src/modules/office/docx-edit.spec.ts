import { describe, expect, test } from 'vitest';

import { diffTextReplacement } from './docx-edit';

describe('diffTextReplacement', () => {
  test('finds a minimal replacement range', () => {
    expect(
      diffTextReplacement('Hello LocalMind', 'Hello native Office')
    ).toEqual({
      start: 6,
      end: 15,
      text: 'native Office',
    });
  });

  test('supports insertion and deletion', () => {
    expect(diffTextReplacement('LocalMind', 'Local native Mind')).toEqual({
      start: 5,
      end: 5,
      text: ' native ',
    });
    expect(diffTextReplacement('Local native Mind', 'LocalMind')).toEqual({
      start: 5,
      end: 13,
      text: '',
    });
  });

  test('never splits a surrogate pair', () => {
    expect(diffTextReplacement('A😀B', 'A😃B')).toEqual({
      start: 1,
      end: 3,
      text: '😃',
    });
  });

  test('returns null for unchanged text', () => {
    expect(diffTextReplacement('same', 'same')).toBeNull();
  });
});
