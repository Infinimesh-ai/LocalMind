import { UserFriendlyError } from '@affine/error';

export function nativeFileError(caught: unknown) {
  const error = UserFriendlyError.fromAny(caught);
  const conflict = error.status === 409;
  const rejected = [400, 401, 403, 404, 413, 422].includes(error.status);
  const reason =
    error.status === 400 && error.message === 'The file must contain valid JSON'
      ? 'invalidJson'
      : conflict
        ? 'conflict'
        : error.status === 400 || error.status === 413 || error.status === 422
          ? 'invalidContent'
          : error.status === 401 || error.status === 403
            ? 'permission'
            : error.status === 404
              ? 'unavailable'
              : error.isNetworkError() || caught instanceof TypeError
                ? 'network'
                : 'failed';
  return {
    messageKey: `com.affine.localmind.native-files.error.${reason}` as const,
    conflict,
    // An ambiguous failure must retain the exact request for an idempotent retry.
    rejected,
  };
}
