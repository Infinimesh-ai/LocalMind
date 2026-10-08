import { EventEmitter } from 'node:events';

import { beforeEach, expect, test, vi } from 'vitest';

const app = new EventEmitter();
const warn = vi.fn();
const set = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  app.removeAllListeners();
  vi.doMock('electron', () => ({ app }));
  vi.doMock('../../src/main/logger', () => ({ logger: { warn } }));
  vi.doMock('../../src/main/shared-storage/storage', () => ({
    globalStateStorage: { set, get: vi.fn() },
  }));
});

test('marks quit before callbacks and runs cleanup once despite nested and repeated quit', async () => {
  const { beforeAppQuit, isAppQuitting } =
    await import('../../src/main/cleanup');
  const cleanup = vi.fn(() => {
    expect(isAppQuitting()).toBe(true);
    app.emit('before-quit');
  });
  beforeAppQuit(cleanup);

  expect(isAppQuitting()).toBe(false);
  app.emit('before-quit');
  app.emit('before-quit');

  expect(cleanup).toHaveBeenCalledOnce();
  expect(set).toHaveBeenCalledTimes(2);
});

test('continues releasing other resources if a cleanup callback fails', async () => {
  const { beforeAppQuit } = await import('../../src/main/cleanup');
  const error = new Error('cleanup failed');
  const remainingCleanup = vi.fn();
  beforeAppQuit(() => {
    throw error;
  });
  beforeAppQuit(remainingCleanup);

  app.emit('before-quit');

  expect(warn).toHaveBeenCalledWith('cleanup error on quit', error);
  expect(remainingCleanup).toHaveBeenCalledOnce();
});
