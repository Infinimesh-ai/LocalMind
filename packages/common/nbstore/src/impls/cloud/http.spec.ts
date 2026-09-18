import { afterEach, describe, expect, test, vi } from 'vitest';

import { HttpConnection } from './http';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HttpConnection', () => {
  test('reports the bounded timeout phase without exposing the request URL', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        });
      })
    );
    const connection = new HttpConnection('https://localmind.example');
    const request = connection.fetch('/api/workspaces/private?id=secret', {
      timeout: 25,
    });
    const assertion = expect(request).rejects.toMatchObject({
      message: 'Network error: timeout after 25ms',
      data: {
        durationMs: 25,
        operation: 'GET',
        phase: 'http-request',
        routeTemplate: '/api/…',
        timeout: true,
      },
    });

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });

  test('forwards caller cancellation instead of relabeling it as a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true }
          );
        });
      })
    );
    const controller = new AbortController();
    const connection = new HttpConnection('https://localmind.example');
    const request = connection.fetch('/api/workspaces', {
      signal: controller.signal,
    });

    controller.abort(new Error('superseded'));

    await expect(request).rejects.toMatchObject({
      message: 'Network error: superseded',
    });
  });
});
