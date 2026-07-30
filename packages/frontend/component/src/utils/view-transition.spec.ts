/**
 * @vitest-environment happy-dom
 */
import { afterEach, expect, test, vi } from 'vitest';

import { startSafeViewTransition } from './view-transition';

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  'startViewTransition'
);

const setStartViewTransition = (
  implementation: (cb: () => Promise<void> | void) => unknown
) => {
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: implementation,
  });
};

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      'startViewTransition',
      originalStartViewTransition
    );
  } else {
    Reflect.deleteProperty(document, 'startViewTransition');
  }
});

test('ignores an aborted view transition', async () => {
  const abortError = new DOMException('Transition was skipped', 'AbortError');
  const transition = {
    ready: Promise.reject(abortError),
    updateCallbackDone: Promise.resolve(),
    finished: Promise.resolve(),
    skipTransition: vi.fn(),
  };
  const callback = vi.fn();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});

  setStartViewTransition(cb => {
    void cb();
    return transition;
  });
  startSafeViewTransition(callback);

  await Promise.allSettled([
    transition.ready,
    transition.updateCallbackDone,
    transition.finished,
  ]);

  expect(callback).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();
});

test('reports the same transition failure only once', async () => {
  const failure = new Error('Update failed');
  const transition = {
    ready: Promise.reject(failure),
    updateCallbackDone: Promise.reject(failure),
    finished: Promise.reject(failure),
    skipTransition: vi.fn(),
  };
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});

  setStartViewTransition(() => transition);
  startSafeViewTransition(() => {}, { name: 'test' });

  await Promise.allSettled([
    transition.ready,
    transition.updateCallbackDone,
    transition.finished,
  ]);

  expect(error).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledWith('View transition[test] failed:', failure);
});
