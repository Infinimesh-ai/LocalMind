import { z } from 'zod';

export const supportedClient = z.enum([
  'web',
  'localmind',
  'localmind-canary',
  'localmind-beta',
  'localmind-internal',
  'affine',
  'affine-canary',
  'affine-beta',
  'affine-internal',
  ...(BUILD_CONFIG.debug ? ['localmind-dev', 'affine-dev'] : []),
]);
