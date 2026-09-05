import { describe, expect, it } from 'vitest';

import {
  getDeepLinkNavigationMode,
  getDeepLinkSchemes,
  isSupportedDeepLink,
  joinAppRoutePathname,
  parseAppRouteLocation,
} from '../../src/shared/deep-link';

describe('LocalMind deep links', () => {
  it.each([
    ['stable', false, 'localmind'],
    ['beta', false, 'localmind-beta'],
    ['canary', false, 'localmind-canary'],
    ['internal', false, 'localmind-internal'],
    ['canary', true, 'localmind-dev'],
  ] as const)(
    'uses only the LocalMind scheme for %s',
    (buildType, isDev, primary) => {
      expect(getDeepLinkSchemes(buildType, isDev)).toEqual({
        primary,
        supported: [primary],
      });
    }
  );

  it('accepts only the configured LocalMind scheme', () => {
    const { supported } = getDeepLinkSchemes('canary', false);

    expect(
      isSupportedDeepLink('localmind-canary://authentication', supported)
    ).toBe(true);
    expect(
      isSupportedDeepLink('affine-canary://authentication', supported)
    ).toBe(false);
    expect(isSupportedDeepLink('affine://authentication', supported)).toBe(
      false
    );
    expect(isSupportedDeepLink('not a URL', supported)).toBe(false);
  });

  it('routes global and workspace new-tab links through the new-tab path', () => {
    expect(
      getDeepLinkNavigationMode('localmind://app.local/intelligence?new-tab=1')
    ).toBe('new-tab');
    expect(
      getDeepLinkNavigationMode(
        'localmind://app.local/workspace/ws-1/doc-1?new-tab=1'
      )
    ).toBe('new-tab');
  });

  it('distinguishes authentication, hidden, and active-tab links', () => {
    expect(
      getDeepLinkNavigationMode('localmind://authentication?method=oauth')
    ).toBe('authentication');
    expect(
      getDeepLinkNavigationMode('localmind://app.local/intelligence?hidden=1')
    ).toBe('hidden-window');
    expect(
      getDeepLinkNavigationMode('localmind://app.local/intelligence')
    ).toBe('active-tab');
    expect(getDeepLinkNavigationMode('not a URL')).toBeNull();
  });

  it('parses global routes with a leading slash', () => {
    expect(
      parseAppRouteLocation(
        'localmind://app.local/intelligence?new-tab=1#in-progress'
      )
    ).toEqual({
      basename: '/',
      pathname: '/intelligence',
      search: '?new-tab=1',
      hash: '#in-progress',
    });
  });

  it('parses workspace routes without matching embedded workspace text', () => {
    expect(
      parseAppRouteLocation('localmind://app.local/workspace/ws-1/doc-1')
    ).toEqual({
      basename: '/workspace/ws-1',
      pathname: '/doc-1',
      search: '',
      hash: '',
    });
    expect(
      parseAppRouteLocation('localmind://app.local/prefix/workspace/ws-1/doc-1')
    ).toMatchObject({
      basename: '/',
      pathname: '/prefix/workspace/ws-1/doc-1',
    });
  });

  it('joins app route basenames with exactly one slash', () => {
    expect(joinAppRoutePathname('/', '/intelligence')).toBe('/intelligence');
    expect(joinAppRoutePathname('/workspace/ws-1', '/doc-1')).toBe(
      '/workspace/ws-1/doc-1'
    );
    expect(joinAppRoutePathname('/workspace/ws-1', '/')).toBe(
      '/workspace/ws-1'
    );
  });
});
