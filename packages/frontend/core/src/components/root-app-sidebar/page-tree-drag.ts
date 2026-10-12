export type PageTreeDropPlacement = 'before' | 'after' | 'inside';

export function pageTreeDropPlacement(
  y: number,
  row: { top: number; bottom: number; height: number },
  container: boolean
): PageTreeDropPlacement | null {
  if (!row.height || y < row.top || y > row.bottom) return null;
  if (y - row.top < row.height / 4) return 'before';
  if (row.bottom - y < row.height / 4) return 'after';
  return container ? 'inside' : null;
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
