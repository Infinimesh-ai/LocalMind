import { AsyncLocalStorage } from 'node:async_hooks';

import type { DocRecord } from './storage';

/** Only entered inside an active database transaction. No Redis locks or
 * snapshot compaction are allowed after acquiring transaction content locks. */
export const workspaceDocTransaction = new AsyncLocalStorage<{
  writable: boolean;
  read: (workspaceId: string, docId: string) => Promise<DocRecord | null>;
}>();
