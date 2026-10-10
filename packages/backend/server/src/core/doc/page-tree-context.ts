import { AsyncLocalStorage } from 'node:async_hooks';

/** Internal-only authority; never derived from client update origins or flags. */
export const pageTreeWriteContext = new AsyncLocalStorage<string>();

export const pageTreeNativeCreatedContext = new AsyncLocalStorage<
  (resource: { kind: 'file' | 'office'; resourceId: string }) => Promise<void>
>();
