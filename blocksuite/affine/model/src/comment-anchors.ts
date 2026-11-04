import * as Y from 'yjs';

/** Anchors are persisted in native content; absence is a durable orphan state. */
export function collectNativeCommentIds(document: Y.Doc) {
  const ids = new Set<string>();
  const visit = (value: unknown, key = '') => {
    if (value instanceof Y.Text) {
      for (const run of value.toDelta())
        for (const name of Object.keys(run.attributes ?? {}))
          if (name.startsWith('comment-')) ids.add(name.slice(8));
    } else if (value instanceof Y.Map) {
      if (key === 'prop:comments') for (const id of value.keys()) ids.add(id);
      else for (const [key, child] of value) visit(child, key);
    } else if (value instanceof Y.Array) value.forEach(child => visit(child));
    else if (key === 'comments' && value && typeof value === 'object')
      Object.keys(value).forEach(id => ids.add(id));
  };
  visit(document.getMap('blocks'));
  return ids;
}

/** Includes flat table cells, database rich text, block and canvas anchors. */
export function updateNativeTextCommentState(
  document: Y.Doc,
  id: string,
  state: boolean | null
) {
  const marker = `comment-${id}`;
  const visit = (value: unknown) => {
    if (value instanceof Y.Text) {
      let offset = 0;
      for (const run of value.toDelta()) {
        const length = typeof run.insert === 'string' ? run.insert.length : 1;
        if (
          run.attributes &&
          marker in run.attributes &&
          run.attributes[marker] !== state
        )
          value.format(offset, length, { [marker]: state });
        offset += length;
      }
    } else if (value instanceof Y.Map) {
      for (const [key, child] of value) {
        if (
          key === 'prop:comments' &&
          child instanceof Y.Map &&
          child.has(id)
        ) {
          if (state === null) child.delete(id);
          else if (child.get(id) !== state) child.set(id, state);
        } else if (
          key === 'comments' &&
          child &&
          typeof child === 'object' &&
          !(child instanceof Y.AbstractType) &&
          Object.hasOwn(child, id)
        ) {
          const comments = { ...(child as Record<string, unknown>) };
          if (state === null) delete comments[id];
          else comments[id] = state;
          value.set(key, comments);
        } else visit(child);
      }
    } else if (value instanceof Y.Array) value.forEach(visit);
  };
  document.transact(() => visit(document.getMap('blocks')));
}

/** Navigation falls back to the owning block/element for nested rich text; it
 * never pretends a table-cell offset is a paragraph TextSelection offset. */
export function findNativeCommentTargets(document: Y.Doc, id: string) {
  const blockIds: string[] = [],
    elementIds: string[] = [];
  const hasAnchor = (value: unknown, key = ''): boolean => {
    if (value instanceof Y.Text)
      return value
        .toDelta()
        .some((run: { attributes?: Record<string, unknown> }) =>
          Object.hasOwn(run.attributes ?? {}, `comment-${id}`)
        );
    if (value instanceof Y.Map)
      return key === 'prop:comments'
        ? value.has(id)
        : [...value].some(([key, child]) => hasAnchor(child, key));
    if (value instanceof Y.Array)
      return value.toArray().some(child => hasAnchor(child));
    return (
      key === 'comments' &&
      !!value &&
      typeof value === 'object' &&
      Object.hasOwn(value, id)
    );
  };
  for (const [blockId, block] of document.getMap<Y.Map<unknown>>('blocks')) {
    if (block.get('sys:flavour') === 'affine:surface') {
      const stored = block.get('prop:elements');
      const elements =
        stored instanceof Y.Map &&
        stored.get('type') === '$blocksuite:internal:native$'
          ? stored.get('value')
          : stored;
      if (elements instanceof Y.Map)
        for (const [elementId, element] of elements)
          if (hasAnchor(element)) elementIds.push(elementId);
    }
    if (
      [...block].some(
        ([key, value]) => key !== 'prop:elements' && hasAnchor(value, key)
      )
    )
      blockIds.push(blockId);
  }
  return { blockIds, elementIds };
}
