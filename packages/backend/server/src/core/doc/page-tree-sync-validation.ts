import * as Y from 'yjs';

class BadRequest extends Error {}

type DocRecord = { bin: Uint8Array };

/** Called inside the existing persistence/authorization boundary. The incoming
 * CRDT origin is untrusted and cannot opt out of any structural checks. */
export async function validatePageTreeSyncSnapshots(input: {
  workspaceId: string;
  docId: string;
  updates: Uint8Array[];
  read: (id: string) => Promise<DocRecord | null>;
}) {
  const { workspaceId, docId } = input;
  if (docId === `db$${workspaceId}$folders`)
    throw new BadRequest('page_tree_protocol_retired');
  if (docId !== workspaceId && docId !== `db$${workspaceId}$docProperties`) {
    if (docId.startsWith(`db$${workspaceId}$`) || docId.startsWith('userdata$'))
      return;
    const root = new Y.Doc();
    try {
      const stored = await input.read(workspaceId);
      if (stored) Y.applyUpdate(root, stored.bin);
      const pages = root.getMap('meta').get('pages');
      const page =
        pages instanceof Y.Array || Array.isArray(pages)
          ? (
              (pages instanceof Y.Array ? pages.toJSON() : pages) as {
                id: string;
                trash?: boolean;
              }[]
            ).find(page => page.id === docId)
          : undefined;
      if (!page || page.trash)
        throw new BadRequest('page_tree_resource_unavailable');
    } finally {
      root.destroy();
    }
    return;
  }
  const stored = await input.read(docId);
  const before = new Y.Doc({ gc: false }),
    after = new Y.Doc({ gc: false });
  const extra: Y.Doc[] = [];
  try {
    // Materialize the shared map before applying updates so Item.parent has
    // the same identity when checking even a losing map-key conflict.
    if (docId === workspaceId) {
      before.getMap('meta');
      after.getMap('meta');
    }
    if (stored) {
      Y.applyUpdate(before, stored.bin);
      Y.applyUpdate(after, stored.bin);
    }
    const known = Y.decodeStateVector(Y.encodeStateVector(before));
    for (const update of input.updates) Y.applyUpdate(after, update);
    if (after.store.pendingStructs || after.store.pendingDs)
      throw new BadRequest('page_tree_incomplete_sync');
    if (docId === workspaceId && stored) {
      // A stale client can replace the old scalar pages value after migration.
      // Even a losing Y.Map conflict must be rejected: silently accepting it
      // would acknowledge metadata that never became visible.
      for (const update of input.updates) {
        for (const struct of Y.decodeUpdate(update).structs) {
          if (!(struct instanceof Y.Item)) continue;
          if (struct.id.clock < (known.get(struct.id.client) ?? 0)) continue;
          const item = Y.getItem(after.store, struct.id);
          if (
            item.parent === after.getMap('meta') &&
            item.parentSub === 'pages'
          )
            throw new BadRequest('page_tree_protocol_retired');
        }
      }
    }
    const load = async (id: string) => {
      const record = await input.read(id),
        doc = new Y.Doc();
      extra.push(doc);
      if (record) Y.applyUpdate(doc, record.bin);
      return doc;
    };
    if (docId === workspaceId) {
      const lifecycle = (doc: Y.Doc) => {
        const pages = doc.getMap('meta').get('pages');
        if (!(pages instanceof Y.Array) && !Array.isArray(pages))
          throw new BadRequest('Invalid Workspace pages');
        return (
          (pages instanceof Y.Array ? pages.toJSON() : pages) as {
            id: string;
            trash?: boolean;
            $localmindTrashClaims?: string[];
          }[]
        )
          .map(page => [
            page.id,
            !!page.trash,
            page.$localmindTrashClaims ?? [],
          ])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      };
      if (
        JSON.stringify(lifecycle(before)) !== JSON.stringify(lifecycle(after))
      )
        throw new BadRequest('page_tree_protocol_retired');
    }
    const root = docId === workspaceId ? before : await load(workspaceId);
    const props =
      docId === workspaceId
        ? await load(`db$${workspaceId}$docProperties`)
        : before;
    const mode = (resourceId: string, rootDoc: Y.Doc, propertyDoc: Y.Doc) => {
      const row = propertyDoc.getMap(resourceId);
      const current =
        row.get('$$DELETED') === true ? undefined : row.get('primaryMode');
      const legacy = rootDoc
        .getMap('affine:workspace-properties')
        .get('pageProperties');
      const old = legacy instanceof Y.Map ? legacy.get(resourceId) : undefined;
      const oldValue = (old instanceof Y.Map ? old.toJSON() : old) as
        | { system?: { primaryMode?: { value?: string } } }
        | undefined;
      return (current ?? oldValue?.system?.primaryMode?.value) === 'edgeless'
        ? 'edgeless'
        : 'page';
    };
    const tree = await load(`db$${workspaceId}$folders`);
    const rows = [...tree.share.keys()]
      .map(id => tree.getMap(id).toJSON())
      .filter(row => row.$pageTreeRetired !== true);
    for (const row of rows) {
      if (row.type !== 'doc' || typeof row.data !== 'string') continue;
      const previous = mode(row.data, root, props);
      const next = mode(
        row.data,
        docId === workspaceId ? after : root,
        docId === workspaceId ? props : after
      );
      if (
        previous === 'page' &&
        next === 'edgeless' &&
        rows.some(child => child.parentId === row.id)
      )
        throw new BadRequest('page_tree_container_has_descendants');
    }
  } finally {
    before.destroy();
    after.destroy();
    for (const doc of extra) doc.destroy();
  }
}
