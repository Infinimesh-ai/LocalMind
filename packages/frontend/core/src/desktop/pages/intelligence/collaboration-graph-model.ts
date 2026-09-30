import type { WorkbenchCollaborationGraph } from './types';

export type Relation = WorkbenchCollaborationGraph['edges'][number] & {
  senderName: string;
  recipientName: string;
  otherId: string;
  otherName: string;
  side: 'left' | 'right';
  deliveryFrom: string;
  deliveryTo: string;
};

export type OrderSummary = {
  id: string;
  title: string;
  relation: Relation;
};

export type RelationGroup = {
  key: string;
  userId: string;
  name: string;
  side: Relation['side'];
  relations: Relation[];
  items: OrderSummary[];
};

export const relationGroupKey = (
  relation: Pick<Relation, 'side' | 'otherId'>
) => `${relation.side}:${relation.otherId}`;

export const GRAPH_HEIGHT = 440;

export type OrderFilter = 'all' | 'mine' | 'theirs' | 'ended';

export function matchesOrderFilter(relation: Relation, filter: OrderFilter) {
  const ended = ['delivered', 'adopted', 'refused', 'cancelled'].includes(
    relation.status
  );
  if (filter === 'all') return true;
  if (filter === 'ended') return ended;
  if (ended || relation.status === 'draft') return false;
  return relation.side === (filter === 'mine' ? 'right' : 'left');
}

export function projectRelations(
  graph: WorkbenchCollaborationGraph,
  projectFilter: string
) {
  const names = new Map(graph.nodes.map(node => [node.id, node.label]));
  const selfId = graph.nodes.find(node => node.self)?.id ?? '';
  const relations: Relation[] = graph.edges
    .filter(edge => {
      if (!selfId || (edge.from !== selfId && edge.to !== selfId)) return false;
      if (projectFilter === 'work_order') return edge.sourceKind !== 'project';
      return !projectFilter || edge.project?.id === projectFilter;
    })
    .map(edge => {
      const otherId = edge.from === selfId ? edge.to : edge.from;
      return {
        ...edge,
        senderName: names.get(edge.from) ?? '',
        recipientName: names.get(edge.to) ?? '',
        otherId,
        otherName: names.get(otherId) ?? '',
        side: edge.from === selfId ? 'left' : 'right',
        deliveryFrom: edge.to,
        deliveryTo: edge.from,
      };
    });
  const byDirection = new Map<string, RelationGroup>();
  for (const relation of relations) {
    const key = relationGroupKey(relation);
    const group = byDirection.get(key) ?? {
      key,
      userId: relation.otherId,
      name: relation.otherName,
      side: relation.side,
      relations: [],
      items: [],
    };
    group.relations.push(relation);
    group.items.push({ id: relation.id, title: relation.label, relation });
    byDirection.set(key, group);
  }
  // A person may occupy both sides; neither status refreshes nor project order move them.
  const groups = [...byDirection.values()].sort(
    (a, b) =>
      a.side.localeCompare(b.side) ||
      a.name.localeCompare(b.name) ||
      a.userId.localeCompare(b.userId)
  );
  return {
    relations,
    groups,
    selfId,
    selfName: names.get(selfId) ?? '',
    personCount: new Set(groups.map(group => group.userId)).size,
  };
}

export function relationTone(status: string, side: Relation['side']) {
  if (status === 'draft' || status === 'refused' || status === 'cancelled')
    return 'muted';
  if (status === 'delivered' || status === 'adopted') return 'complete';
  return side === 'left' ? 'incoming' : 'outgoing';
}

/** The label and the two equal-width connector halves share one layout. */
export function relationConnector(
  left: { x: number; y: number },
  right: { x: number; y: number },
  labelWidth: number,
  labelY = (left.y + right.y) / 2
) {
  const x = (left.x + right.x) / 2;
  const start = x - labelWidth / 2;
  const end = x + labelWidth / 2;
  const controlLeft = (left.x + start) / 2;
  const controlRight = (end + right.x) / 2;
  return {
    x,
    y: labelY,
    left: `M${left.x} ${left.y} C${controlLeft} ${left.y}, ${controlLeft} ${labelY}, ${start} ${labelY}`,
    right: `M${end} ${labelY} C${controlRight} ${labelY}, ${controlRight} ${right.y}, ${right.x} ${right.y}`,
  };
}
