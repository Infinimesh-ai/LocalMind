import { describe, expect, test } from 'vitest';

import { prioritizeDevProxies, rewriteDevProxyOrigin } from './bundle-shared';

test('proxies API requests before waiting on compilation while retaining guards and error handling', () => {
  const names = [
    'check-host-header',
    'set-headers',
    '@rspack/dev-middleware',
    'http-proxy-middleware',
    'http-proxy-middleware-error-handler',
    '@rspack/dev-middleware',
    'history-api-fallback',
  ];
  expect(
    prioritizeDevProxies(names.map(name => ({ name }))).map(item => item.name)
  ).toEqual([
    'check-host-header',
    'set-headers',
    'http-proxy-middleware',
    'http-proxy-middleware-error-handler',
    '@rspack/dev-middleware',
    '@rspack/dev-middleware',
    'history-api-fallback',
  ]);
});

describe('local development proxy origin', () => {
  test('represents the local frontend with the local API target origin', () => {
    expect(
      rewriteDevProxyOrigin(
        'http://localhost:8081',
        'localhost:8081',
        'http://localhost:3011'
      )
    ).toBe('http://localhost:3011');
  });
  test('preserves foreign origins and mismatched hosts for server rejection', () => {
    expect(
      rewriteDevProxyOrigin(
        'https://example.com',
        'localhost:8081',
        'http://localhost:3011'
      )
    ).toBe('https://example.com');
    expect(
      rewriteDevProxyOrigin(
        'http://localhost:8099',
        'localhost:8081',
        'http://localhost:3011'
      )
    ).toBe('http://localhost:8099');
  });
  test('does not rewrite origins for a remote backend', () => {
    expect(
      rewriteDevProxyOrigin(
        'http://localhost:8081',
        'localhost:8081',
        'https://localmind.example'
      )
    ).toBe('http://localhost:8081');
  });
  test('preserves absent and malformed origins', () => {
    expect(
      rewriteDevProxyOrigin(
        undefined,
        'localhost:8081',
        'http://localhost:3011'
      )
    ).toBeUndefined();
    expect(
      rewriteDevProxyOrigin('null', 'localhost:8081', 'http://localhost:3011')
    ).toBe('null');
  });
});
