/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DocumentNavigation } from './document-navigation';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function setup(workspaceWidth = 1000) {
  const view = render(<DocumentNavigation open>Headings</DocumentNavigation>);
  const handle = screen.getByRole('separator', { name: 'Document navigation' });
  const panel = handle.parentElement!;
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(
    () => ({ width: Number.parseFloat(panel.style.width) }) as DOMRect
  );
  vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockReturnValue({
    width: workspaceWidth,
  } as DOMRect);
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  return { ...view, handle, panel };
}

describe('Document navigation width', () => {
  test('resizes in both directions and keeps room for the document', () => {
    const { handle, panel } = setup(600);
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 220 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 260 });
    expect(panel.style.width).toBe('260px');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800 });
    expect(panel.style.width).toBe('270px');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 50 });
    expect(panel.style.width).toBe('160px');
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(document.body.style.cursor).toBe('');
  });

  test('supports keyboard, remembers width, and resets on double click', () => {
    const { handle, panel, unmount } = setup();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(panel.style.width).toBe('236px');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(panel.style.width).toBe('360px');
    unmount();
    const next = setup();
    expect(next.panel.style.width).toBe('360px');
    fireEvent.doubleClick(next.handle);
    expect(next.panel.style.width).toBe('220px');
  });

  test('ignores secondary pointers and clears drag state on cancel and blur', () => {
    const { handle, panel } = setup();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 220 });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 80 });
    fireEvent.pointerCancel(handle, { pointerId: 2 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 260 });
    expect(panel.style.width).toBe('260px');
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(document.body.style.cursor).toBe('');
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
    expect(panel.style.width).toBe('260px');
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 260 });
    fireEvent.blur(window);
    expect(document.body.style.userSelect).toBe('');
    expect(handle.dataset.dragging).toBe('false');
  });

  test('closing during a drag restores cursor and retains the width', () => {
    const { handle, panel, rerender } = setup();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 220 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 280 });
    rerender(<DocumentNavigation open={false}>Headings</DocumentNavigation>);
    expect(document.body.style.cursor).toBe('');
    expect(screen.queryByRole('separator')).toBeNull();
    rerender(<DocumentNavigation open>Headings</DocumentNavigation>);
    expect(panel.style.width).toBe('280px');
  });

  test('invalid or unavailable storage does not break navigation', () => {
    localStorage.setItem('localmind.office.document-navigation-width', 'NaN');
    const { panel, unmount } = setup();
    expect(panel.style.width).toBe('220px');
    unmount();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    const next = setup();
    fireEvent.keyDown(next.handle, { key: 'ArrowLeft' });
    expect(next.panel.style.width).toBe('204px');
  });
});
