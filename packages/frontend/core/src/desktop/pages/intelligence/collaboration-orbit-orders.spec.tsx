/** @vitest-environment happy-dom */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => String(key) }),
}));

import type { Relation } from './collaboration-graph-model';
import type { OrderCardLayout } from './collaboration-orbit-model';
import {
  ORDER_ENTER_MS,
  ORDER_EXIT_MS,
  ORDER_LAUNCH_GAP_MS,
} from './collaboration-orbit-motion';
import { CollaborationOrbitOrders } from './collaboration-orbit-orders';

const node = { x: 500, y: 400, diameter: 74 };
const layout: OrderCardLayout = {
  side: 'right',
  columnCount: 1,
  rect: { x: 600, y: 360, width: 276, height: 90 },
  cards: [
    {
      order: {
        id: 'one',
        label: '第一张',
        side: 'left',
        otherName: '李明',
        status: 'open',
      } as Relation,
      column: 0,
      x: 600,
      y: 360,
      width: 276,
      height: 40,
    },
    {
      order: {
        id: 'two',
        label: '第二张',
        side: 'left',
        otherName: '李明',
        status: 'open',
      } as Relation,
      column: 0,
      x: 600,
      y: 410,
      width: 276,
      height: 40,
    },
  ],
};

describe('collaboration orbit capsule lifecycle', () => {
  const animate = vi.fn();
  const cancelled: Array<ReturnType<typeof vi.fn>> = [];
  const finishers: Array<() => void> = [];
  beforeEach(() => {
    animate.mockReset().mockImplementation(() => {
      const cancel = vi.fn();
      cancelled.push(cancel);
      const finished = new Promise<void>(resolve => finishers.push(resolve));
      return { cancel, finished };
    });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
  });
  afterEach(() => {
    cleanup();
    cancelled.length = 0;
    finishers.length = 0;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  });

  test('orders land independently, pinning does not replay, and late callbacks stay cancelled', async () => {
    const props = {
      layout,
      node,
      closing: false,
      openId: null as string | null,
      detailPinned: false,
      onReady: vi.fn(),
      onClosed: vi.fn(),
      onOpen: vi.fn(),
      onPreview: vi.fn(),
      onPreviewLeave: vi.fn(),
      reveal: vi.fn(),
    };
    const view = render(<CollaborationOrbitOrders {...props} />);
    const entranceOptions = animate.mock.calls
      .map(call => call[1] as KeyframeAnimationOptions)
      .filter(options => options.duration === ORDER_ENTER_MS);
    expect(entranceOptions.map(options => options.delay)).toEqual([
      0,
      0,
      ORDER_LAUNCH_GAP_MS,
      ORDER_LAUNCH_GAP_MS,
    ]);
    await act(async () => {
      finishers.slice(0, 2).forEach(finish => finish());
    });
    expect(
      view.container
        .querySelector('[data-order-id="one"]')
        ?.hasAttribute('disabled')
    ).toBe(false);
    expect(
      view.container
        .querySelector('[data-order-id="two"]')
        ?.hasAttribute('disabled')
    ).toBe(true);
    const initialCount = animate.mock.calls.length;
    view.rerender(
      <CollaborationOrbitOrders {...props} openId="one" detailPinned />
    );
    expect(animate).toHaveBeenCalledTimes(initialCount);
    view.rerender(<CollaborationOrbitOrders {...props} closing />);
    expect(
      animate.mock.calls.some(
        call => (call[1] as KeyframeAnimationOptions).duration === ORDER_EXIT_MS
      )
    ).toBe(true);
    expect(cancelled.some(cancel => cancel.mock.calls.length > 0)).toBe(true);
    view.unmount();
    await act(async () => {
      finishers.forEach(finish => finish());
    });
    expect(props.onReady).not.toHaveBeenCalled();
    expect(props.onClosed).not.toHaveBeenCalled();
  });
});
