export type PageTreeDropPlacement = 'before' | 'after' | 'inside';

export type PageTreeDropTarget = {
  nodeId: string | null;
  placement: PageTreeDropPlacement;
};

export function pageTreeDropTarget(
  y: number,
  rows: readonly {
    nodeId: string;
    container: boolean;
    top: number;
    bottom: number;
  }[]
): PageTreeDropTarget | null {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last || y < first.top - 2 || y > last.bottom) return null;
  for (const [index, row] of rows.entries()) {
    const edge = Math.min(6, (row.bottom - row.top) / 4);
    // Both sides of a visible gap share the following row's parent and anchor,
    // including the boundary between a subtree's last child and a root sibling.
    if (y < row.top + edge) return { nodeId: row.nodeId, placement: 'before' };
    if (y <= row.bottom - edge)
      return row.container ? { nodeId: row.nodeId, placement: 'inside' } : null;
    if (y <= row.bottom) {
      const next = rows[index + 1];
      return next
        ? { nodeId: next.nodeId, placement: 'before' }
        : { nodeId: row.nodeId, placement: 'after' };
    }
  }
  return null;
}

export function pageTreeReorderIsNoop(
  visible: readonly string[],
  source: string,
  target: string,
  placement: 'before' | 'after'
) {
  if (source === target) return true;
  const sourceIndex = visible.indexOf(source);
  const targetIndex = visible.indexOf(target);
  return (
    sourceIndex >= 0 &&
    targetIndex >= 0 &&
    sourceIndex === targetIndex + (placement === 'before' ? -1 : 1)
  );
}

/** Remove the source before resolving the insertion anchor, including no-op drops. */
export function pageTreeReorder(
  visible: readonly string[],
  source: string,
  target: string,
  placement: 'before' | 'after'
) {
  if (source === target) return null;
  const order = visible.filter(id => id !== source);
  const index = order.indexOf(target);
  if (index < 0) throw new Error('Reorder target changed; refresh');
  order.splice(index + (placement === 'after' ? 1 : 0), 0, source);
  return order;
}

export function samePageTreeOrder(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
