import { parentPort } from 'node:worker_threads';

import * as Y from 'yjs';

import { validatePageTreeSyncSnapshots } from './page-tree-sync-validation';
import type { SnapshotResult, SnapshotTask } from './snapshot-worker-types';

// Workspace roots contain subdocument references. Y.Map.toJSON() retains those
// Y.Doc instances, whose functions cannot cross a worker boundary. Metadata
// readers need only their identity, never a live nested CRDT or its contents.
function snapshotValue(value: unknown): unknown {
  if (value instanceof Y.Doc) return { guid: value.guid };
  if (Array.isArray(value)) return value.map(snapshotValue);
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, snapshotValue(item)])
    );
  return value;
}

async function handleTask(task: SnapshotTask) {
  try {
    let value: SnapshotResult = null;
    if (task.kind === 'decode') {
      const doc = new Y.Doc();
      try {
        if (task.bin) Y.applyUpdate(doc, task.bin);
        const keys = [...doc.share.keys()];
        const pages = doc.getMap('meta').get('pages');
        const legacy = doc
          .getMap('affine:workspace-properties')
          .get('pageProperties');
        value = {
          maps: Object.fromEntries(
            keys.map(key => [
              key,
              snapshotValue(doc.getMap(key).toJSON()) as Record<
                string,
                unknown
              >,
            ])
          ),
          pagesKind:
            pages === undefined
              ? 'absent'
              : pages instanceof Y.Array
                ? 'array'
                : Array.isArray(pages)
                  ? 'legacy-array'
                  : 'invalid',
          legacyPagePropertiesIsMap: legacy instanceof Y.Map,
        };
      } finally {
        doc.destroy();
      }
    } else if (task.kind !== 'validate') {
      // Load the existing native readers only for content jobs. Their CPU work
      // must not block GraphQL, websocket callbacks, or transaction deadlines.
      const readers = await import('../utils/blocksuite');
      if (task.kind === 'docIds')
        value = readers.readAllDocIdsFromWorkspaceSnapshot(
          task.bin,
          task.includeTrash
        );
      else if (task.kind === 'workspaceContent')
        value = readers.parseWorkspaceDoc(task.bin);
      else
        value = readers.parsePageDoc(task.bin, {
          maxSummaryLength: task.maxSummaryLength,
        });
    } else {
      await validatePageTreeSyncSnapshots({
        ...task,
        read: async id => {
          const bin = Object.hasOwn(task.snapshots, id)
            ? task.snapshots[id]
            : null;
          return bin ? { bin } : null;
        },
      });
    }
    parentPort?.postMessage({ value });
  } catch (error) {
    parentPort?.postMessage({
      error:
        error instanceof Error ? error.message : 'Invalid document snapshot',
    });
  }
}

parentPort?.on('message', (task: SnapshotTask) => {
  handleTask(task).catch(() => {
    parentPort?.postMessage({ error: 'Invalid document snapshot' });
  });
});
