/**
 * @vitest-environment happy-dom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { PaneResizeHandle } from './pane-resize-handle';

afterEach(cleanup);

const renderHandle = (direction: 1 | -1 = 1, getWidth?: () => number) => {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <div>
      <PaneResizeHandle
        label="调整宽度"
        testId="resize-handle"
        direction={direction}
        getWidth={getWidth}
        getBounds={() => ({ min: 200, max: 400 })}
        onChange={onChange}
        onReset={onReset}
      />
    </div>
  );
  const handle = screen.getByTestId('resize-handle');
  vi.spyOn(handle.parentElement!, 'getBoundingClientRect').mockReturnValue({
    width: 300,
  } as DOMRect);
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  return { handle, onChange, onReset };
};

describe('PaneResizeHandle', () => {
  test('drags in both directions and respects the width limits', () => {
    const { handle, onChange } = renderHandle(-1, () => 320);

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40 });
    expect(onChange).toHaveBeenLastCalledWith(380);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: -200 });
    expect(onChange).toHaveBeenLastCalledWith(400);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 });
    expect(onChange).toHaveBeenLastCalledWith(200);

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  test('supports keyboard resizing and resetting', () => {
    const { handle, onChange, onReset } = renderHandle();

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(316);

    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(260);

    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(200);

    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledOnce();
  });
});
