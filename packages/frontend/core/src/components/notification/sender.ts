import { useCurrentPublicIdentity } from '@affine/core/modules/cloud/views/public-user';

type Sender = { id: string; name?: string | null; avatarUrl?: string | null };

const NO_SENDER = {};

/**
 * Notification sender with the current public name/avatar. The body keeps the
 * profile resolved when the list was fetched; `null` means an inactive member.
 */
export function useNotificationSender<T extends Sender>(
  sender: T | null | undefined
): T | null {
  const current = useCurrentPublicIdentity(
    sender?.id,
    sender ?? (NO_SENDER as T)
  );
  return sender ? current : null;
}
