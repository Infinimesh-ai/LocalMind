// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { REPORT_RUNTIME_SCRIPT } from './runtime';

let dispose: (() => void)[];
let intersectionCallbacks: IntersectionObserverCallback[];
beforeEach(() => {
  dispose = [];
  intersectionCallbacks = [];
  document.documentElement.dataset.mode = 'present';
  delete document.documentElement.dataset.rdFailed;
  delete document.documentElement.dataset.static;
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  // Already-intersecting steps do not receive a new observer entry on mode change.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const Observer = MutationObserver;
  vi.stubGlobal(
    'MutationObserver',
    class extends Observer {
      constructor(callback: MutationCallback) {
        super(callback);
        dispose.push(() => this.disconnect());
      }
    }
  );
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        original(type, listener, options);
        dispose.push(() => target.removeEventListener(type, listener, options));
      }
    );
  }
  document.body.innerHTML = `<main id="deck-stage" data-content-root="rd-custom-v4">
    <section data-slide><h2 data-rd-step="1" data-rd-reveal="fade">Evidence</h2>
    <div data-rd-step="2"><svg><rect data-rd-reveal="grow"></rect></svg></div>
    <input aria-label="Notes"></section></main>`;
  new Function(REPORT_RUNTIME_SCRIPT)();
});
afterEach(() => {
  dispose.forEach(fn => fn());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mode(value: 'read' | 'present') {
  document.documentElement.dataset.mode = value;
  await new Promise(resolve => setTimeout(resolve, 10));
}

it('returning to reading reveals previously hidden step content without another intersection event', async () => {
  expect(document.querySelectorAll('[data-rd-in]')).toHaveLength(0);
  await mode('read');
  expect(
    document.querySelectorAll('[data-rd-step][data-rd-shown]')
  ).toHaveLength(2);
  expect(
    document.querySelectorAll('[data-rd-reveal][data-rd-in]')
  ).toHaveLength(2);
  expect(document.documentElement.dataset.rdFailed).toBeUndefined();
});

it('re-entering presentation resets steps and arrows advance them before chapter navigation', async () => {
  await mode('read');
  await mode('present');
  expect(
    document.querySelectorAll('[data-rd-step][data-rd-shown]')
  ).toHaveLength(1);
  const back = new KeyboardEvent('keydown', {
    key: 'ArrowLeft',
    bubbles: true,
    cancelable: true,
  });
  document.querySelector('section')!.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(false);
  expect(document.querySelector('h2[data-rd-shown]')).toBe(
    document.querySelector('h2')
  );
  const press = () => {
    const key = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    document.querySelector('section')!.dispatchEvent(key);
    return key.defaultPrevented;
  };
  expect(press()).toBe(true);
  expect(
    document.querySelectorAll('[data-rd-step][data-rd-shown]')
  ).toHaveLength(2);
  expect(press()).toBe(false);
});

it('preserves the first forward step when the chapter title is already visible', async () => {
  delete document.querySelector('h2')!.dataset.rdStep;
  await mode('read');
  await mode('present');
  expect(
    document.querySelectorAll('[data-rd-step][data-rd-shown]')
  ).toHaveLength(0);
});

it('restores the title reveal after a chapter leaves and re-enters view', async () => {
  const section = document.querySelector('section')!;
  const rect = section.getBoundingClientRect();
  const notify = (isIntersecting: boolean) =>
    intersectionCallbacks[1](
      [
        {
          target: section,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          time: 0,
          boundingClientRect: rect,
          intersectionRect: rect,
          rootBounds: null,
        },
      ],
      {} as IntersectionObserver
    );
  notify(true);
  notify(false);
  notify(true);
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(document.querySelector('h2[data-rd-in]')).toBe(
    document.querySelector('h2')
  );
});

it('reading and input navigation do not consume chapter keys as presentation steps', async () => {
  const input = new KeyboardEvent('keydown', {
    key: 'ArrowRight',
    bubbles: true,
    cancelable: true,
  });
  document.querySelector('input')!.dispatchEvent(input);
  expect(input.defaultPrevented).toBe(false);
  expect(
    document.querySelectorAll('[data-rd-step][data-rd-shown]')
  ).toHaveLength(1);
  await mode('read');
  const read = new KeyboardEvent('keydown', {
    key: 'ArrowRight',
    bubbles: true,
    cancelable: true,
  });
  document.querySelector('section')!.dispatchEvent(read);
  expect(read.defaultPrevented).toBe(false);
});
