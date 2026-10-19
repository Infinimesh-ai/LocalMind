import {
  type ReportDocument,
  type ReportNode,
  ReportNodeSchema,
} from '@localmind/office/report';

export function newReportNode(type: ReportNode['type']): ReportNode {
  const base = {
    id: crypto.randomUUID(),
    type,
    sourceIds: [],
    claimKind: 'manual',
    locked: false,
  };
  switch (type) {
    case 'heading':
      return ReportNodeSchema.parse({ ...base, text: '', level: '2' });
    case 'paragraph':
      return ReportNodeSchema.parse({ ...base, text: '' });
    case 'list':
      return ReportNodeSchema.parse({ ...base, items: [''], ordered: false });
    case 'table':
      return ReportNodeSchema.parse({ ...base, columns: [''], rows: [['']] });
    case 'metric':
      return ReportNodeSchema.parse({
        ...base,
        label: '',
        value: null,
        unit: '',
        formula: '',
      });
    case 'timeline':
      return ReportNodeSchema.parse({
        ...base,
        entries: [{ date: '', title: '', detail: '', status: 'unknown' }],
      });
    case 'image':
      return ReportNodeSchema.parse({
        ...base,
        assetId: 'unselected',
        alt: '',
        caption: '',
      });
    case 'chart':
      return ReportNodeSchema.parse({
        ...base,
        chartType: 'bar',
        title: '',
        labels: [''],
        series: [{ label: '', values: [null] }],
        unit: '',
        methodology: '',
      });
    case 'callout':
      return ReportNodeSchema.parse({ ...base, text: '', tone: 'info' });
    case 'pageBreak':
      return ReportNodeSchema.parse(base);
  }
}

export function moveItem<T>(
  items: readonly T[],
  index: number,
  direction: -1 | 1
): T[] {
  if (index + direction < 0 || index + direction >= items.length)
    return [...items];
  const result = [...items];
  [result[index], result[index + direction]] = [
    result[index + direction],
    result[index],
  ];
  return result;
}

export class ReportEditHistory {
  private readonly past: ReportDocument[] = [];
  private future: ReportDocument[] = [];
  private document: ReportDocument;
  constructor(document: ReportDocument) {
    this.document = document;
  }
  get current() {
    return this.document;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  change(document: ReportDocument) {
    this.past.push(this.document);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    this.document = document;
    return this.document;
  }
  undo() {
    const previous = this.past.pop();
    if (previous) {
      this.future.push(this.document);
      this.document = previous;
    }
    return this.document;
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.document);
      this.document = next;
    }
    return this.document;
  }
}

export function compareReportDocuments(
  before: ReportDocument,
  after: ReportDocument
) {
  const left = new Map(
    before.chapters.flatMap(chapter =>
      chapter.nodes.map(node => [node.id, node] as const)
    )
  );
  const right = new Map(
    after.chapters.flatMap(chapter =>
      chapter.nodes.map(node => [node.id, node] as const)
    )
  );
  return [...new Set([...left.keys(), ...right.keys()])].flatMap(id => {
    const old = left.get(id);
    const next = right.get(id);
    if (JSON.stringify(old) === JSON.stringify(next)) return [];
    return [
      {
        id,
        kind: old ? (next ? 'changed' : 'removed') : 'added',
        before: old,
        after: next,
      },
    ];
  });
}

/** Reconnect reconciliation preserves independent edits and asks about every overlap. */
export function mergeLocalReportDocument(
  base: ReportDocument,
  current: ReportDocument,
  local: ReportDocument,
  choices: Record<string, 'current' | 'local'> = {}
): { document: ReportDocument; conflicts: string[] } {
  const conflicts: string[] = [];
  const equal = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  const choose = (path: string, live: unknown, draft: unknown) => {
    if (!choices[path]) conflicts.push(path);
    return choices[path] === 'local' ? draft : live;
  };
  const merge = (
    old: unknown,
    live: unknown,
    draft: unknown,
    path: string
  ): unknown => {
    if (equal(old, draft) || equal(live, draft)) return live;
    if (equal(old, live)) return draft;
    if (record(old) && record(live) && record(draft)) {
      return Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(old),
            ...Object.keys(live),
            ...Object.keys(draft),
          ]),
        ]
          .map(key => [
            key,
            merge(
              old[key],
              live[key],
              draft[key],
              path ? `${path}.${key}` : key
            ),
          ])
          .filter(([, value]) => value !== undefined)
      );
    }
    if (
      Array.isArray(old) &&
      Array.isArray(live) &&
      Array.isArray(draft) &&
      [...old, ...live, ...draft].every(
        item => record(item) && typeof item.id === 'string'
      )
    ) {
      const index = (items: unknown[]) =>
        new Map(
          items.map(item => {
            const value = item as Record<string, unknown>;
            return [String(value.id), item] as const;
          })
        );
      const oldMap = index(old),
        liveMap = index(live),
        draftMap = index(draft);
      const merged = new Map(
        [
          ...new Set([...oldMap.keys(), ...liveMap.keys(), ...draftMap.keys()]),
        ].map(id => [
          id,
          merge(
            oldMap.get(id),
            liveMap.get(id),
            draftMap.get(id),
            `${path}[${id}]`
          ),
        ])
      );
      const oldOrder = [...oldMap.keys()],
        liveOrder = [...liveMap.keys()],
        draftOrder = [...draftMap.keys()];
      // Additions and removals are merged by identity; only shared-item reordering conflicts.
      const common = new Set(
        oldOrder.filter(id => liveMap.has(id) && draftMap.has(id))
      );
      const orderChanged = (order: string[]) =>
        !equal(
          oldOrder.filter(id => common.has(id)),
          order.filter(id => common.has(id))
        );
      const order =
        orderChanged(draftOrder) &&
        orderChanged(liveOrder) &&
        !equal(
          liveOrder.filter(id => common.has(id)),
          draftOrder.filter(id => common.has(id))
        )
          ? (choose(`${path}.$order`, liveOrder, draftOrder) as string[])
          : orderChanged(draftOrder)
            ? draftOrder
            : liveOrder;
      return [...new Set([...order, ...liveOrder, ...draftOrder])]
        .map(id => merged.get(id))
        .filter(value => value !== undefined);
    }
    return choose(path, live, draft);
  };
  return {
    document: merge(base, current, local, '') as ReportDocument,
    conflicts,
  };
}
