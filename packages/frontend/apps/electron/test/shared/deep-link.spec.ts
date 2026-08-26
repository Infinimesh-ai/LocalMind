import { describe, expect, it } from 'vitest';

import {
  getDeepLinkSchemes,
  isSupportedDeepLink,
} from '../../src/shared/deep-link';

describe('LocalMind deep links', () => {
  it.each([
    ['stable', false, 'localmind', 'affine'],
    ['beta', false, 'localmind-beta', 'affine-beta'],
    ['canary', false, 'localmind-canary', 'affine-canary'],
    ['internal', false, 'localmind-internal', 'affine-internal'],
    ['canary', true, 'localmind-dev', 'affine-dev'],
  ] as const)(
    'uses LocalMind for %s and keeps its AFFiNE compatibility scheme',
    (buildType, isDev, primary, legacy) => {
      expect(getDeepLinkSchemes(buildType, isDev)).toEqual({
        primary,
        legacy,
        supported: [primary, legacy],
      });
    }
  );

  it('accepts only the configured LocalMind and legacy schemes', () => {
    const { supported } = getDeepLinkSchemes('canary', false);

    expect(
      isSupportedDeepLink('localmind-canary://authentication', supported)
    ).toBe(true);
    expect(
      isSupportedDeepLink('affine-canary://authentication', supported)
    ).toBe(true);
    expect(isSupportedDeepLink('affine://authentication', supported)).toBe(
      false
    );
    expect(isSupportedDeepLink('not a URL', supported)).toBe(false);
  });
});
