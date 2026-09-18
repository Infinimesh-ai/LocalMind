import { UserFriendlyError } from '@affine/error';
import { gqlFetcherFactory } from '@affine/graphql';

import { DummyConnection } from '../../connection';

export class HttpConnection extends DummyConnection {
  readonly fetch = async (
    input: string,
    init?: RequestInit & { timeout?: number }
  ) => {
    const externalSignal = init?.signal;
    if (externalSignal?.aborted) {
      throw externalSignal.reason;
    }

    const abortController = new AbortController();
    const onExternalAbort = () => {
      abortController.abort(externalSignal?.reason);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    const timeout = init?.timeout ?? 15000;
    const startedAt = Date.now();
    const requestUrl = new URL(input, this.serverBaseUrl);
    const routeSegments = requestUrl.pathname.split('/').filter(Boolean);
    const [routeRoot] = routeSegments;
    const routeTemplate =
      routeSegments.length > 1 ? `/${routeRoot}/…` : requestUrl.pathname;
    let timedOut = false;
    const timeoutId =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            abortController.abort(
              new Error(`request timeout after ${timeout}ms`)
            );
          }, timeout)
        : undefined;

    let res: Response;
    try {
      res = await globalThis.fetch(requestUrl, {
        ...init,
        signal: abortController.signal,
        headers: {
          ...this.requestHeaders,
          ...init?.headers,
          'x-affine-version': BUILD_CONFIG.appVersion,
        },
      });
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new UserFriendlyError({
        status: 504,
        code: 'NETWORK_ERROR',
        type: 'NETWORK_ERROR',
        name: 'NETWORK_ERROR',
        message: timedOut
          ? `Network error: timeout after ${timeout}ms`
          : `Network error: ${cause.message}`,
        data: {
          phase: 'http-request',
          durationMs: Date.now() - startedAt,
          operation: (init?.method ?? 'GET').toUpperCase(),
          routeTemplate,
          timeout: timedOut,
        },
        stacktrace: cause.stack,
      });
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
    if (!res.ok && res.status !== 404) {
      if (res.status === 413) {
        throw new UserFriendlyError({
          status: 413,
          code: 'CONTENT_TOO_LARGE',
          type: 'CONTENT_TOO_LARGE',
          name: 'CONTENT_TOO_LARGE',
          message: 'Content too large',
        });
      } else if (
        res.headers.get('Content-Type')?.startsWith('application/json')
      ) {
        throw UserFriendlyError.fromAny(await res.json());
      } else {
        throw UserFriendlyError.fromAny(await res.text());
      }
    }
    return res;
  };

  readonly fetchArrayBuffer = async (input: string, init?: RequestInit) => {
    const res = await this.fetch(input, init);
    if (res.status === 404) {
      // 404
      return null;
    }
    try {
      return await res.arrayBuffer();
    } catch (err) {
      throw new Error('fetch download error: ' + err);
    }
  };

  readonly gql = gqlFetcherFactory(
    new URL('/graphql', this.serverBaseUrl).href,
    this.fetch
  );

  constructor(
    private readonly serverBaseUrl: string,
    private readonly requestHeaders?: Record<string, string>
  ) {
    super();
  }
}
