/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test, vi } from 'vitest';

import { DebugLogger } from '..';

describe('debug', () => {
  test('disabled', () => {
    const logger = new DebugLogger('test');
    logger.enabled = false;
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const fn = vi.fn();
      vi.spyOn(globalThis.console, level).mockImplementation(fn);
      expect(logger.enabled).toBe(false);
      expect(fn).not.toBeCalled();
      logger[level]('test');
      expect(fn, level).not.toBeCalled();
    }
  });

  test('log', () => {
    const logger = new DebugLogger('test');
    logger.enabled = true;
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      const fn = vi.fn();
      vi.spyOn(globalThis.console, level).mockImplementation(fn);
      expect(logger.enabled).toBe(true);
      expect(fn).not.toBeCalled();
      logger[level]('test');
      expect(fn, level).toBeCalled();
    }
  });

  test('forwards structured events to an optional sink', () => {
    const sink = vi.fn();
    DebugLogger.setSink(sink);
    const logger = new DebugLogger('sink-test');
    logger.enabled = false;
    logger.error('secret-safe message', { code: 'E_TEST' });
    expect(sink).toHaveBeenCalledWith({
      namespace: 'sink-test',
      level: 'error',
      message: 'secret-safe message',
      args: [{ code: 'E_TEST' }],
    });
    DebugLogger.setSink(undefined);
  });
});
