import { describe, expect, it } from 'vitest';

import {
  getDeepLinkSchemes,
  isSupportedDeepLink,
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
});
