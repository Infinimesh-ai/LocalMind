import { UserFriendlyError } from '@affine/error';

/** Access failures need a new login/permission change, not network retries. */
export function deckAccessFailure(error: unknown) {
  if (!error) return undefined;
  const { status } = UserFriendlyError.fromAny(error);
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  return undefined;
}
