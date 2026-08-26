import { describe, expect, it } from 'vitest';

import { supportedClient } from './common';

describe('supported auth clients', () => {
  it.each([
    'web',
    'localmind',
    'localmind-canary',
    'localmind-beta',
    'localmind-internal',
    'affine',
    'affine-canary',
    'affine-beta',
    'affine-internal',
  ])('accepts %s', client => {
    expect(supportedClient.safeParse(client).success).toBe(true);
  });

  it('rejects unknown clients', () => {
    expect(supportedClient.safeParse('other-app').success).toBe(false);
  });
});
