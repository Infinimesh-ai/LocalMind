/** @vitest-environment happy-dom */

import { afterEach, describe, expect, test } from 'vitest';

import {
  captureOfficeSelection,
  resolveOfficeTextPosition,
  resolveOfficeTextRange,
  restoreOfficeSelection,
} from './docx-selection';

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

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

  test('maps a collapsed caret to an insertion position', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p data-office-block-id="paragraph:a" data-office-order="0"><span>Alpha</span></p>';
    const text = root.querySelector('span')?.firstChild;
    expect(text).toBeTruthy();

    const selection = {
      rangeCount: 1,
      isCollapsed: true,
      anchorNode: text,
      anchorOffset: 3,
      focusNode: text,
      focusOffset: 3,
    } as unknown as Selection;

    expect(resolveOfficeTextRange(root, selection)).toBeNull();
    expect(resolveOfficeTextPosition(root, selection)).toEqual({
      blockId: 'paragraph:a',
      offset: 3,
    });
  });
});

describe('Office selection bookmarks', () => {
  test('restores a reverse selection across remounted paragraphs and split Unicode runs', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p data-office-block-id="a" data-office-order="0">A😀BC</p><p data-office-block-id="b" data-office-order="1">Second</p>';
    document.body.append(root);
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(
      root.children[1].firstChild!,
      4,
      root.children[0].firstChild!,
      1
    );
    const bookmark = captureOfficeSelection(root, selection)!;
    root.innerHTML =
      '<p data-office-block-id="a" data-office-order="0"><span>A</span><span>😀</span><span>BC</span></p><p data-office-block-id="b" data-office-order="1"><span>Se</span><span>cond</span></p>';

    expect(restoreOfficeSelection(root, bookmark)).toBe(true);
    expect(captureOfficeSelection(root, selection)).toEqual(bookmark);
    expect(resolveOfficeTextRange(root, selection)).toEqual({
      type: 'text_range',
      start: { blockId: 'a', offset: 1 },
      end: { blockId: 'b', offset: 4 },
    });
  });

  test('restores a caret in an empty paragraph', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p data-office-block-id="a" data-office-order="0"><br /></p>';
    document.body.append(root);
    const position = { blockId: 'a', offset: 0 };
    expect(
      restoreOfficeSelection(root, { anchor: position, focus: position })
    ).toBe(true);
    expect(resolveOfficeTextPosition(root, window.getSelection())).toEqual(
      position
    );
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  test('does not redirect a bookmark to a missing block or shortened text', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<p data-office-block-id="a" data-office-order="0">New</p>';
    document.body.append(root);
    const anchor = { blockId: 'a', offset: 0 };
    expect(
      restoreOfficeSelection(root, {
        anchor,
        focus: { blockId: 'a', offset: 10 },
      })
    ).toBe(false);
    expect(
      restoreOfficeSelection(root, {
        anchor,
        focus: { blockId: 'removed', offset: 1 },
      })
    ).toBe(false);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });
});
