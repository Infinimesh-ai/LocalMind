import { applyDecorators, SetMetadata } from '@nestjs/common';
import {
  SkipThrottle as RawSkipThrottle,
  Throttle as RawThrottle,
} from '@nestjs/throttler';

import { ThrottlerType } from './config';

export type Throttlers = 'default' | 'strict' | 'authenticated';
export const THROTTLER_PROTECTED = 'affine_throttler:protected';
export const THROTTLER_BUCKET = 'affine_throttler:bucket';

/**
 * Choose what throttler to use
 *
 * If a Controller or Query do not protected behind a Throttler,
 * it will never be rate limited.
 *
 * - default: 120 calls within 60 seconds
 * - strict: 20 calls within 60 seconds
 * - authenticated: no rate limit for authenticated users, apply [default] throttler for unauthenticated users
 *
 * @example
 *
 * \@Throttle()
 * \@Throttle('strict')
 *
 * // the config call be override by the second parameter,
 * // and the call count will be calculated separately
 * \@Throttle('default', { limit: 10, ttl: 10_000 })
 *
 * // An explicit bucket stays separate even when its limits match the defaults.
 * \@Throttle('default', { bucket: 'workspace-tree-read' })
 *
 */
export function Throttle(
  type: ThrottlerType | 'authenticated' = 'default',
  override: { limit?: number; ttl?: number; bucket?: string } = {}
): MethodDecorator & ClassDecorator {
  const { bucket, ...options } = override;
  return applyDecorators(
    SetMetadata(THROTTLER_PROTECTED, type),
    SetMetadata(THROTTLER_BUCKET, bucket ?? null),
    RawThrottle({
      [type]: options,
    })
  );
}

export function SkipThrottle(
  skip: Partial<Record<ThrottlerType, boolean>> = {
    default: true,
    strict: true,
  }
): MethodDecorator & ClassDecorator {
  return RawSkipThrottle(skip);
}
