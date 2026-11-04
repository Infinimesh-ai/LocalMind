import diff from 'fast-diff';
import * as Y from 'yjs';

/** Reconcile ordered values while retaining every unchanged CRDT array item. */
export function reconcileNativeArray<T, Existing>(
  current: Y.Array<Existing>,
  desired: readonly T[],
  identity: (value: unknown) => string,
  create: (value: T, previous: Existing | undefined) => Existing,
  update: (current: Existing, desired: T) => void
) {
  const previous = current.toArray();
  const keys = new Map<string, string>();
  const token = (value: unknown) => {
    const key = identity(value);
    let result = keys.get(key);
    if (!result) {
      // One UTF-16 unit per identity; exclude surrogate code units.
      if (keys.size >= 50000)
        throw new Error('Native array exceeds identity budget');
      result = String.fromCharCode(keys.size + 1);
      keys.set(key, result);
    }
    return result;
  };
  const before = previous.map(token).join('');
  const after = desired.map(token).join('');
  const byIdentity = new Map(previous.map(value => [identity(value), value]));
  // Clone moved objects before deleting their original Yjs item. Deleting an
  // integrated container clears its contents; cloning afterwards loses data.
  const changes = diff(before, after);
  let targetIndex = 0;
  const prepared = changes.map(([kind, tokens]) => {
    const values =
      kind === diff.INSERT
        ? desired
            .slice(targetIndex, targetIndex + tokens.length)
            .map(value => create(value, byIdentity.get(identity(value))))
        : [];
    if (kind !== diff.DELETE) targetIndex += tokens.length;
    return { kind, length: tokens.length, values };
  });
  let index = 0;
  for (const change of prepared) {
    if (change.kind === diff.DELETE) current.delete(index, change.length);
    else {
      if (change.kind === diff.INSERT) current.insert(index, change.values);
      for (let offset = 0; offset < change.length; offset++)
        update(current.get(index + offset), desired[index + offset]);
      index += change.length;
    }
  }
}
