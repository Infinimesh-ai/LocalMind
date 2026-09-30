import { projectRelations, type Relation } from './collaboration-graph-model';
import type { WorkbenchCollaborationGraph } from './types';

export type Direction = 'all' | 'incoming' | 'outgoing';
export type OrbitPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  orders: Relation[];
  active: Relation[];
  history: Relation[];
  incoming: number;
  outgoing: number;
};
export const isEnded = (order: Pick<Relation, 'status'>) =>
  ['delivered', 'adopted', 'refused', 'cancelled'].includes(order.status);
export const orderDirection = (order: Pick<Relation, 'side'>) =>
  order.side === 'left' ? 'incoming' : 'outgoing';

export function buildOrbitModel(
  graph: WorkbenchCollaborationGraph,
  project = '',
  query = ''
) {
  const projected = projectRelations(graph, project);
  const q = query.trim().toLocaleLowerCase();
  const unique = new Map<string, Relation>();
  for (const order of projected.relations) {
    if (order.otherId === projected.selfId) continue;
    if (
      q &&
      ![order.otherName, order.label, order.project?.name ?? ''].some(value =>
        value.toLocaleLowerCase().includes(q)
      )
    )
      continue;
    unique.set(order.id, order);
  }
  const drafts = [...unique.values()].filter(order => order.kind === 'draft');
  const relations = [...unique.values()].filter(
    order => order.kind !== 'draft'
  );
  const byPerson = new Map<string, Relation[]>();
  for (const order of relations) {
    const list = byPerson.get(order.otherId) ?? [];
    list.push(order);
    byPerson.set(order.otherId, list);
  }
  const people: OrbitPerson[] = [...byPerson]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, orders]) => {
      const node = graph.nodes.find(item => item.id === id);
      const active = orders.filter(order => !isEnded(order));
      return {
        id,
        name: node?.label ?? orders[0].otherName,
        avatarUrl: node?.avatarUrl ?? null,
        orders,
        active,
        history: orders.filter(isEnded),
        incoming: active.filter(order => order.side === 'left').length,
        outgoing: active.filter(order => order.side === 'right').length,
      };
    });
  return {
    people,
    relations,
    drafts,
    self: graph.nodes.find(node => node.id === projected.selfId),
    activeCount: people.reduce((sum, person) => sum + person.active.length, 0),
    incoming: people.reduce((sum, person) => sum + person.incoming, 0),
    outgoing: people.reduce((sum, person) => sum + person.outgoing, 0),
  };
}

/** Grow the visible area with unfinished work, with readable and bounded extremes. */
export const personDiameter = (count: number) =>
  count <= 0 ? 40 : Math.min(112, Math.sqrt(44 ** 2 + (count - 1) * 700));

/** Keep existing identity slots while inserting newcomers into the largest gap. */
export function layoutOrbit(
  people: OrbitPerson[],
  previousSlots: ReadonlyMap<string, number> = new Map(),
  previousRadius = 380
) {
  const normalize = (angle: number) =>
    ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const slots = new Map(
    people.flatMap(person => {
      const angle = previousSlots.get(person.id);
      return angle === undefined ? [] : [[person.id, angle] as const];
    })
  );
  if (!slots.size) {
    people.forEach((person, index) =>
      slots.set(
        person.id,
        people.length === 1
          ? 0
          : -Math.PI * 0.68 + (index * Math.PI * 2) / people.length
      )
    );
  } else {
    for (const person of people) {
      if (slots.has(person.id)) continue;
      const angles = [...slots.values()].map(normalize).sort((a, b) => a - b);
      const gaps = angles.map((angle, index) => ({
        start: angle,
        size: (angles[index + 1] ?? angles[0] + Math.PI * 2) - angle,
      }));
      const largest = gaps.reduce((best, gap) =>
        gap.size > best.size ? gap : best
      );
      slots.set(person.id, normalize(largest.start + largest.size / 2));
    }
  }
  const radiusX = Math.max(380, previousRadius, people.length * 58);
  const radiusY = Math.max(280, radiusX * 0.72);
  const width = radiusX * 2 + 404;
  const height = radiusY * 2 + 434;
  const self = { x: width / 2, y: height / 2 - 16 };
  const nodes = people.map(person => {
    const angle = slots.get(person.id) ?? 0;
    return {
      person,
      x: self.x + Math.cos(angle) * radiusX,
      y: self.y + Math.sin(angle) * radiusY,
      diameter: personDiameter(person.active.length),
    };
  });
  return { width, height, self, radiusX, radiusY, nodes, slots };
}

export function ordersFor(
  person: OrbitPerson,
  direction: Direction,
  history = false
) {
  return (history ? person.history : person.active).filter(
    order => direction === 'all' || orderDirection(order) === direction
  );
}

export const ORDERS_PER_COLUMN = 5;

export function layoutOrderCards(
  self: { x: number; y: number },
  node: { x: number; y: number; diameter: number },
  orders: Relation[]
) {
  if (!orders.length) return null;
  const side = node.x < self.x ? 'left' : 'right';
  const width = 276,
    height = 40;
  const angleStep = (13 * Math.PI) / 180;
  const columnCount = Math.ceil(orders.length / ORDERS_PER_COLUMN);
  const orbitExtent =
    orderRingRadius(node.diameter, orders.length) * 1.08 +
    ORDER_DOT_DIAMETER / 2;
  // Leave room for the denser orbit as well as the avatar caption and controls.
  const innerClearance = Math.max(100, node.diameter / 2 + 48, orbitExtent + 8);
  const cards = orders.map((order, index) => {
    const column = Math.floor(index / ORDERS_PER_COLUMN);
    const count = Math.min(
      ORDERS_PER_COLUMN,
      orders.length - column * ORDERS_PER_COLUMN
    );
    const halfArc = ((count - 1) * angleStep) / 2;
    const radius = (width / 2 + innerClearance) / Math.cos(halfArc);
    const angle = (index % ORDERS_PER_COLUMN) * angleStep - halfArc;
    const offsetX = radius * Math.cos(angle);
    return {
      order,
      column,
      x:
        node.x +
        (side === 'right' ? 1 : -1) * (offsetX + column * (width + 56)) -
        width / 2,
      y: node.y + radius * Math.sin(angle) - height / 2,
      width,
      height,
    };
  });
  const left = Math.min(
    node.x - Math.max(90, orbitExtent),
    ...cards.map(card => card.x)
  );
  const top = Math.min(
    node.y - Math.max(node.diameter / 2 + 16, orbitExtent),
    ...cards.map(card => card.y)
  );
  const right = Math.max(
    node.x + Math.max(90, orbitExtent),
    ...cards.map(card => card.x + card.width)
  );
  const bottom = Math.max(
    node.y + Math.max(node.diameter / 2 + 140, orbitExtent),
    ...cards.map(card => card.y + card.height)
  );
  return {
    side,
    columnCount,
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    cards,
  };
}

export type OrderCardLayout = NonNullable<ReturnType<typeof layoutOrderCards>>;

/** Geometric hover corridor: it does not intercept clicks or canvas gestures. */
export function isWithinOrderExpansion(
  layout: OrderCardLayout,
  node: { x: number; y: number; diameter: number },
  point: { x: number; y: number }
) {
  const outward = layout.side === 'right' ? 1 : -1;
  const x = (point.x - node.x) * outward;
  const y = point.y - node.y;
  if (
    Math.abs(point.x - node.x) <= 90 &&
    y >= -node.diameter / 2 - 12 &&
    y <= node.diameter / 2 + 150
  )
    return true;
  const near = Math.min(
    ...layout.cards.map(card =>
      outward > 0 ? card.x - node.x : node.x - card.x - card.width
    )
  );
  const far = Math.max(
    ...layout.cards.map(card =>
      outward > 0 ? card.x + card.width - node.x : node.x - card.x
    )
  );
  const top = Math.min(...layout.cards.map(card => card.y - node.y)) - 14;
  const bottom =
    Math.max(...layout.cards.map(card => card.y + card.height - node.y)) + 14;
  if (x < 0 || x > far + 14) return false;
  const progress = Math.min(1, x / near);
  return y >= -20 + (top + 20) * progress && y <= 20 + (bottom - 20) * progress;
}

export const ORDER_DOT_DIAMETER = 32;

/** Use the fixed compact radius for groups and avatar clearance for single balls. */
export function orderRingRadius(avatarDiameter: number, count: number) {
  return count > 1 ? 50 : avatarDiameter / 2 + ORDER_DOT_DIAMETER / 2 + 8;
}

export function deliveryPath(
  self: { x: number; y: number },
  node: { x: number; y: number; diameter: number },
  incoming: boolean,
  both: boolean
) {
  const dx = node.x - self.x;
  const dy = node.y - self.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length,
    uy = dy / length;
  const offset = both ? (incoming ? -13 : 13) : 0;
  const a = { x: self.x + ux * 66, y: self.y + uy * 66 };
  const b = {
    x: node.x - ux * (node.diameter / 2 + 12),
    y: node.y - uy * (node.diameter / 2 + 12),
  };
  const c = {
    x: (a.x + b.x) / 2 - uy * offset,
    y: (a.y + b.y) / 2 + ux * offset,
  };
  const start = incoming ? b : a,
    end = incoming ? a : b;
  return `M ${start.x} ${start.y} Q ${c.x} ${c.y} ${end.x} ${end.y}`;
}
