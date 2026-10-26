import { UserFriendlyError } from '@affine/error';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ProjectUploadQueue } from './upload-queue';

describe('ProjectUploadQueue', () => {
  afterEach(() => vi.useRealTimers());

  const throttled = () =>
    new UserFriendlyError({
      status: 429,
      name: 'TOO_MANY_REQUEST',
      code: 'too_many_requests',
      type: 'too_many_request',
      message: 'Too many requests',
      retryAfterMs: 5000,
    });

  test('pauses all queued files on rate limiting and retries with the same identity', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn()
      .mockRejectedValueOnce(throttled())
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const onThrottled = vi.fn();
    const queue = new ProjectUploadQueue(execute, onError, 1, onThrottled);
    const first = { requestKey: 'a' };
    queue.enqueue([first, { requestKey: 'b' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onThrottled).toHaveBeenCalledWith(first, 5000);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4999);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls.filter(([job]) => job === first)).toHaveLength(2);
    queue.dispose();
  });

  test('stops retrying a persistent rate limit and cancels a waiting retry on disposal', async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockRejectedValue(throttled());
    const onError = vi.fn();
    const queue = new ProjectUploadQueue(execute, onError, 1);
    queue.enqueue([{ requestKey: 'a' }]);
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(6);
    expect(onError).toHaveBeenCalledTimes(1);
    queue.enqueue([{ requestKey: 'b' }]);
    await vi.advanceTimersByTimeAsync(0);
    queue.dispose();
    await vi.runAllTimersAsync();
    expect(execute).toHaveBeenCalledTimes(7);
  });

  test('bounds overlapping drops and deduplicates an active retry', async () => {
    const finish: (() => void)[] = [];
    const execute = vi.fn(
      () => new Promise<void>(resolve => finish.push(resolve))
    );
    const queue = new ProjectUploadQueue(execute, vi.fn());
    queue.enqueue(['a', 'b', 'c', 'd'].map(requestKey => ({ requestKey })));
    queue.enqueue(['a', 'e'].map(requestKey => ({ requestKey })));
    expect(execute).toHaveBeenCalledTimes(3);
    finish[0]();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    finish[1]();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(5));
    queue.dispose();
    finish.forEach(resolve => resolve());
  });

  test('unmount aborts active uploads and never starts queued files', async () => {
    const finish: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    const execute = vi.fn((_job, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<void>(resolve => finish.push(resolve));
    });
    const queue = new ProjectUploadQueue(execute, vi.fn());
    queue.enqueue(['a', 'b', 'c', 'd'].map(requestKey => ({ requestKey })));
    queue.dispose();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    finish.forEach(resolve => resolve());
    await Promise.resolve();
    await Promise.resolve();
    queue.enqueue([{ requestKey: 'e' }]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  test('a failed file releases its slot and can retry with the same request key', async () => {
    const error = new Error('upload failed');
    const execute = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const queue = new ProjectUploadQueue(execute, onError, 1);
    queue.enqueue([{ requestKey: 'a' }, { requestKey: 'b' }]);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(onError).toHaveBeenCalledWith({ requestKey: 'a' }, error);
    queue.enqueue([{ requestKey: 'a' }]);
    expect(execute).toHaveBeenCalledTimes(3);
    queue.dispose();
  });
});
