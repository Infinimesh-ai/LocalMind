import { normalizeReportResponsibility } from './document';
import {
  type ReportChapter,
  type ReportDocument,
  ReportDocumentSchema,
  type ReportNode,
} from './schema';

export type ReportMergeConflict = {
  id: string;
  kind: 'content' | 'delete' | 'move' | 'order' | 'locked' | 'outside_scope';
  entityId: string;
};
export type ReportMergeScope = {
  chapterIds?: string[];
  nodeIds?: string[];
  resolutions?: Record<string, 'current' | 'candidate'>;
  evidence?: Pick<ReportDocument, 'coverage' | 'cutoffAt'>;
};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const metadata = ({ nodes: _nodes, ...chapter }: ReportChapter) => chapter;

/** A candidate is a complete baseline-shaped document, never an overwrite of the live draft. */
export function mergeReportCandidate(
  base: ReportDocument,
  current: ReportDocument,
  candidate: ReportDocument,
  scope: ReportMergeScope = {}
) {
  const details: ReportMergeConflict[] = [];
  const conflict = (kind: ReportMergeConflict['kind'], entityId: string) => {
    const id = `${kind}:${entityId}`;
    const resolution = scope.resolutions?.[id];
    // Scope and locks are constraints, not conflicts a caller may override.
    if (kind === 'locked' || kind === 'outside_scope' || !resolution)
      details.push({ id, kind, entityId });
    return (
      kind !== 'locked' &&
      kind !== 'outside_scope' &&
      resolution === 'candidate'
    );
  };
  const chapterAllowed = (id: string) =>
    !scope.nodeIds && (!scope.chapterIds || scope.chapterIds.includes(id));
  const nodeAllowed = (id: string, chapterId: string) =>
    (!scope.nodeIds || scope.nodeIds.includes(id)) &&
    (!scope.chapterIds || scope.chapterIds.includes(chapterId));
  const chapters = new Map(
    current.chapters.map(chapter => [
      chapter.id,
      { ...chapter, nodes: [] as ReportNode[] },
    ])
  );
  const baseChapters = new Map(
    base.chapters.map(chapter => [chapter.id, chapter])
  );
  const candidateChapters = new Map(
    candidate.chapters.map(chapter => [chapter.id, chapter])
  );
  const retainedDeletedChapters = new Set<string>();
  const acceptedDeletedChapters = new Set<string>();
  for (const id of new Set([
    ...baseChapters.keys(),
    ...candidateChapters.keys(),
  ])) {
    const old = baseChapters.get(id),
      next = candidateChapters.get(id),
      live = current.chapters.find(chapter => chapter.id === id);
    if (equal(old && metadata(old), next && metadata(next))) continue;
    if (!chapterAllowed(id)) {
      if (!next) retainedDeletedChapters.add(id);
      conflict('outside_scope', id);
      continue;
    }
    if (
      live?.locked ||
      old?.locked ||
      (!next &&
        (live?.nodes.some(node => node.locked) ||
          old?.nodes.some(node => node.locked)))
    ) {
      if (!next) retainedDeletedChapters.add(id);
      conflict('locked', id);
      continue;
    }
    if (!next) {
      if (equal(live, old) || conflict('delete', id)) {
        chapters.delete(id);
        acceptedDeletedChapters.add(id);
      } else retainedDeletedChapters.add(id);
    } else if (!old) {
      if (
        !live ||
        equal(metadata(live), metadata(next)) ||
        conflict('content', id)
      )
        chapters.set(id, { ...next, nodes: [] });
    } else if (live) {
      if (
        equal(metadata(live), metadata(old)) ||
        equal(metadata(live), metadata(next)) ||
        conflict('content', id)
      )
        chapters.set(id, { ...next, nodes: [] });
    } else conflict('delete', id);
  }
  const index = (doc: ReportDocument) =>
    new Map(
      doc.chapters.flatMap(chapter =>
        chapter.nodes.map(
          node => [node.id, { node, chapterId: chapter.id }] as const
        )
      )
    );
  const originals = index(base),
    liveNodes = index(current),
    nextNodes = index(candidate);
  const merged = new Map(
    [...liveNodes].filter(
      ([, value]) => !acceptedDeletedChapters.has(value.chapterId)
    )
  );
  for (const id of new Set([...originals.keys(), ...nextNodes.keys()])) {
    const old = originals.get(id),
      next = nextNodes.get(id),
      live = liveNodes.get(id);
    if (
      old &&
      !next &&
      (retainedDeletedChapters.has(old.chapterId) ||
        acceptedDeletedChapters.has(old.chapterId))
    )
      continue;
    if (equal(old, next)) continue;
    const chapterId = old?.chapterId ?? next?.chapterId;
    if (!chapterId) throw new Error('Missing merge chapter');
    if (
      !nodeAllowed(id, chapterId) ||
      (next && !nodeAllowed(id, next.chapterId))
    ) {
      conflict('outside_scope', id);
      continue;
    }
    const locked =
      old?.node.locked ||
      live?.node.locked ||
      [old?.chapterId, next?.chapterId, live?.chapterId].some(
        id =>
          id &&
          (baseChapters.get(id)?.locked ||
            current.chapters.find(chapter => chapter.id === id)?.locked)
      );
    if (locked) {
      conflict('locked', id);
      continue;
    }
    if (!next) {
      if (!live || equal(live, old) || conflict('delete', id))
        merged.delete(id);
      continue;
    }
    if (!old) {
      if (!live || equal(live, next) || conflict('content', id))
        merged.set(id, next);
      continue;
    }
    if (!live) {
      if (conflict('delete', id)) merged.set(id, next);
      continue;
    }
    let node = live.node,
      destination = live.chapterId;
    if (
      !equal(next.node, old.node) &&
      (equal(live.node, old.node) ||
        equal(live.node, next.node) ||
        conflict('content', id))
    )
      node = next.node;
    if (
      next.chapterId !== old.chapterId &&
      (live.chapterId === old.chapterId ||
        live.chapterId === next.chapterId ||
        conflict('move', id))
    )
      destination = next.chapterId;
    merged.set(id, { node, chapterId: destination });
  }
  // Preserve an independently edited child if its parent was concurrently deleted.
  for (const value of merged.values())
    if (!chapters.has(value.chapterId)) {
      const old = current.chapters.find(
        chapter => chapter.id === value.chapterId
      );
      if (old) {
        conflict('delete', old.id);
        chapters.set(old.id, { ...old, nodes: [] });
      }
    }
  const order = (
    old: string[],
    live: string[],
    next: string[],
    available: Set<string>,
    entity: string,
    canMove: (id: string) => boolean
  ) => {
    const common = old.filter(
      id => live.includes(id) && next.includes(id) && available.has(id)
    );
    const liveOrder = live.filter(id => common.includes(id)),
      nextOrder = next.filter(id => common.includes(id));
    const candidateMoved = !equal(nextOrder, common),
      liveMoved = !equal(liveOrder, common);
    let chosen = live;
    if (candidateMoved) {
      const forbidden = common.filter(
        (id, i) => nextOrder[i] !== id && !canMove(id)
      );
      if (forbidden.length) forbidden.forEach(id => conflict('locked', id));
      else if (
        !liveMoved ||
        equal(liveOrder, nextOrder) ||
        conflict('order', entity)
      )
        chosen = next;
    }
    const result = chosen.filter(id => available.has(id));
    // Insert new identities beside their nearest accepted predecessor, preserving order.
    for (const sequence of [next, live, [...available]])
      for (const [i, id] of sequence.entries())
        if (available.has(id) && !result.includes(id)) {
          const predecessor = sequence
            .slice(0, i)
            .reverse()
            .find(value => result.includes(value));
          result.splice(
            predecessor ? result.indexOf(predecessor) + 1 : 0,
            0,
            id
          );
        }
    return result;
  };
  const chapterOrder = order(
    base.chapters.map(c => c.id),
    current.chapters.map(c => c.id),
    candidate.chapters.map(c => c.id),
    new Set(chapters.keys()),
    'chapters',
    id => chapterAllowed(id) && !current.chapters.find(c => c.id === id)?.locked
  );
  const output = chapterOrder.map(id => {
    const chapter = chapters.get(id);
    if (!chapter) throw new Error('Missing merge chapter');
    const members = new Set(
      [...merged]
        .filter(([, value]) => value.chapterId === id)
        .map(([id]) => id)
    );
    const ordered = order(
      baseChapters.get(id)?.nodes.map(n => n.id) ?? [],
      current.chapters.find(c => c.id === id)?.nodes.map(n => n.id) ?? [],
      candidateChapters.get(id)?.nodes.map(n => n.id) ?? [],
      members,
      id,
      nodeId =>
        nodeAllowed(nodeId, id) &&
        !chapter.locked &&
        !liveNodes.get(nodeId)?.node.locked
    );
    return {
      ...chapter,
      nodes: ordered.map(id => {
        const value = merged.get(id);
        if (!value) throw new Error('Missing merge node');
        return value.node;
      }),
    };
  });
  const mergeImmutable = <T extends { id: string }>(
    existing: T[],
    additions: T[]
  ) => {
    const values = new Map(existing.map(value => [value.id, value]));
    for (const value of additions) {
      const previous = values.get(value.id);
      if (previous && !equal(previous, value))
        throw new Error(`Immutable report reference changed: ${value.id}`);
      values.set(value.id, value);
    }
    return [...values.values()];
  };
  const existingIds = new Set(
    output.flatMap(chapter => [
      chapter.id,
      ...chapter.nodes.map(node => node.id),
    ])
  );
  const issues = [
    ...current.issues,
    ...candidate.issues.filter(
      issue => !current.issues.some(item => item.id === issue.id)
    ),
  ].map(issue => ({
    ...issue,
    nodeIds: issue.nodeIds.filter(id => existingIds.has(id)),
  }));
  const document = normalizeReportResponsibility(
    {
      ...current,
      ...scope.evidence,
      chapters: output,
      sources: mergeImmutable(current.sources, candidate.sources),
      assets: mergeImmutable(current.assets, candidate.assets),
      issues,
    },
    current.creator
  );
  return {
    document: ReportDocumentSchema.parse(document),
    conflicts: [...new Set(details.map(item => item.id))],
    details,
  };
}
