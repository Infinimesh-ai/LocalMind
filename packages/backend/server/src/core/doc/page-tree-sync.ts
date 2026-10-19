import { BadRequest } from '../../base';
import { snapshotParser } from './snapshot-parser';
import type { DocRecord } from './storage';

/** Storage reads and the worker result remain inside the caller's authorization
 * transaction. The worker cannot opt out of structural validation. */
export async function validatePageTreeSyncUpdate(input: {
  workspaceId: string;
  docId: string;
  updates: Uint8Array[];
  read: (id: string) => Promise<DocRecord | null>;
}) {
  const { workspaceId, docId, updates } = input;
  if (docId === `db$${workspaceId}$folders`)
    throw new BadRequest('page_tree_protocol_retired');
  const structural =
    docId === workspaceId || docId === `db$${workspaceId}$docProperties`;
  if (
    !structural &&
    (docId.startsWith(`db$${workspaceId}$`) || docId.startsWith('userdata$'))
  )
    return;
  if (!structural) {
    // Body updates only need current existence/lifecycle evidence. Reuse the
    // content-keyed root projection instead of decoding the same large CRDT
    // inside the write transaction for every document sync.
    const stored = await input.read(workspaceId);
    const root = await snapshotParser.decode(
      `${workspaceId}:${workspaceId}`,
      stored?.bin ?? null
    );
    const pages = root.pagesKind === 'array' ? root.maps.meta?.pages : null;
    const page = Array.isArray(pages)
      ? (pages as { id: string; trash?: boolean }[]).find(
          page => page?.id === docId
        )
      : undefined;
    if (!page || page.trash)
      throw new BadRequest('page_tree_resource_unavailable');
    return;
  }
  const ids = structural
    ? [
        workspaceId,
        `db$${workspaceId}$docProperties`,
        `db$${workspaceId}$folders`,
      ]
    : [workspaceId];
  const snapshots = Object.fromEntries(
    await Promise.all(
      ids.map(async id => [id, (await input.read(id))?.bin ?? null])
    )
  );
  try {
    await snapshotParser.validate({ workspaceId, docId, updates, snapshots });
  } catch (error) {
    throw new BadRequest(
      error instanceof Error ? error.message : 'Invalid document snapshot'
    );
  }
}
