/** @vitest-environment happy-dom */

import { describe, expect, test } from 'vitest';

import { resolveOfficeTextRange } from './docx-selection';

describe('resolveOfficeTextRange', () => {
  test('maps a forward DOM selection to stable paragraph offsets', () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<p data-office-block-id="paragraph:a" data-office-order="0"><span>Alpha</span></p>',
      '<p data-office-block-id="paragraph:b" data-office-order="1"><span>Beta</span></p>',
    ].join('');
    document.body.append(root);
    const first = root.querySelector('span')?.firstChild;
    const second = root.querySelectorAll('span')[1]?.firstChild;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    const result = resolveOfficeTextRange(root, {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: first,
      anchorOffset: 1,
      focusNode: second,
      focusOffset: 2,
    } as unknown as Selection);

    expect(result).toEqual({
      type: 'text_range',
      start: { blockId: 'paragraph:a', offset: 1 },
      end: { blockId: 'paragraph:b', offset: 2 },
    });
  });

  test('normalizes a reverse selection', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p data-office-block-id="paragraph:a" data-office-order="0"><span>Alpha</span></p>';
    const text = root.querySelector('span')?.firstChild;
    expect(text).toBeTruthy();

    const result = resolveOfficeTextRange(root, {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: text,
      anchorOffset: 5,
      focusNode: text,
      focusOffset: 2,
    } as unknown as Selection);

    expect(result).toEqual({
      type: 'text_range',
      start: { blockId: 'paragraph:a', offset: 2 },
      end: { blockId: 'paragraph:a', offset: 5 },
    });
  });

  test('rejects collapsed and out-of-root selections', () => {
    const root = document.createElement('div');
    const outside = document.createTextNode('outside');
    expect(
      resolveOfficeTextRange(root, {
        rangeCount: 1,
        isCollapsed: false,
        anchorNode: outside,
        anchorOffset: 0,
        focusNode: outside,
        focusOffset: 2,
      } as unknown as Selection)
    ).toBeNull();
  });
});
