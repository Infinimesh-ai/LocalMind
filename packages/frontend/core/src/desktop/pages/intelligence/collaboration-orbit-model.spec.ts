import { describe, expect, test } from 'vitest';

import {
  buildOrbitModel,
  layoutOrbit,
  layoutOrderCards,
  orderDirection,
  ordersFor,
  personDiameter,
} from './collaboration-orbit-model';
import type { WorkbenchCollaborationGraph } from './types';

type Edge = WorkbenchCollaborationGraph['edges'][number];

const edge = (id: string, overrides: Partial<Edge> = {}): Edge => ({
  id,
  kind: 'sent',
  from: 'self',
  to: 'peer',
  status: 'open',
  label: `工单 ${id}`,
  requirementTitles: ['交付说明'],
  requirementItems: [{ id: `item-${id}`, title: '交付说明', kind: 'text' }],
  ownConversationExists: true,
  sourceKind: 'project',
  updatedAt: '2026-09-29T00:00:00.000Z',
  expiresAt: null,
  project: { id: 'project-one', name: '甲项目' },
  ownNavigationKind: 'project_session',
  ownSessionId: 'session',
  ownWorkOrderId: null,
  ownProjectId: 'project-one',
  ownWorkspaceId: null,
  ownDocId: null,
  ...overrides,
});

const graph = (edges: Edge[]): WorkbenchCollaborationGraph => ({
  nodes: [
    { id: 'self', label: '我', self: true, avatarUrl: null },
    { id: 'peer', label: '李明', self: false, avatarUrl: '/api/avatars/peer' },
    { id: 'other', label: '陈晨', self: false, avatarUrl: null },
  ],
  edges,
  truncated: false,
});

describe('collaboration orbit projection', () => {
  test.each([0, 1, 2, 5, 6, 12])(
    '%i active orders determine one avatar and complete capsule set',
    count => {
      const model = buildOrbitModel(
        graph(Array.from({ length: count }, (_, index) => edge(String(index))))
      );
      expect(model.self?.id).toBe('self');
      expect(model.people).toHaveLength(count ? 1 : 0);
      expect(model.activeCount).toBe(count);
      if (!count) return;
      expect(model.people[0].avatarUrl).toBe('/api/avatars/peer');
      expect(model.people[0].active).toHaveLength(count);
      expect(personDiameter(count)).toBe(
        Math.min(112, Math.sqrt(44 ** 2 + (count - 1) * 700))
      );
      const cards = layoutOrderCards(
        { x: 500, y: 500 },
        { x: 880, y: 500, diameter: personDiameter(count) },
        model.people[0].active
      );
      expect(cards?.cards).toHaveLength(count);
      expect(cards?.columnCount).toBe(Math.ceil(count / 5));
      expect(new Set(cards?.cards.map(card => card.order.id)).size).toBe(count);
    }
  );

  test('cross project and opposite direction orders share one person and keep delivery semantics', () => {
    const model = buildOrbitModel(
      graph([
        edge('incoming', { from: 'self', to: 'peer' }),
        edge('outgoing', {
          from: 'peer',
          to: 'self',
          project: { id: 'project-two', name: '乙项目' },
        }),
        edge('incoming', { from: 'self', to: 'peer' }),
      ])
    );
    expect(model.people).toHaveLength(1);
    expect(model.people[0].active).toHaveLength(2);
    expect(model.incoming).toBe(1);
    expect(model.outgoing).toBe(1);
    expect(orderDirection(model.people[0].active[0])).toBe('incoming');
    expect(ordersFor(model.people[0], 'outgoing')).toHaveLength(1);
    expect(
      buildOrbitModel(graph([edge('outgoing', { from: 'peer', to: 'self' })]))
        .people[0].active[0].deliveryFrom
    ).toBe('self');
  });

  test('history and owner drafts do not inflate active count or avatar size', () => {
    const model = buildOrbitModel(
      graph([
        edge('open'),
        edge('history', { status: 'adopted' }),
        edge('refused', { status: 'refused' }),
        edge('draft:one', {
          kind: 'draft',
          status: 'draft',
          expiresAt: '2026-09-30T00:00:00.000Z',
        }),
      ])
    );
    expect(model.activeCount).toBe(1);
    expect(model.people[0].active).toHaveLength(1);
    expect(model.people[0].history).toHaveLength(2);
    expect(model.drafts).toHaveLength(1);
    expect(ordersFor(model.people[0], 'all', true)).toHaveLength(2);
    expect(personDiameter(model.people[0].active.length)).toBe(44);
    expect(
      buildOrbitModel(
        graph([edge('draft:only', { kind: 'draft', status: 'draft' })])
      ).people
    ).toHaveLength(0);
  });

  test('project and text search use the same filtered orders for people and counts', () => {
    const model = buildOrbitModel(
      graph([
        edge('a'),
        edge('b', {
          to: 'other',
          label: '预算确认',
          project: { id: 'project-two', name: '乙项目' },
        }),
      ]),
      'project-two',
      '预算'
    );
    expect(model.people.map(person => person.id)).toEqual(['other']);
    expect(model.activeCount).toBe(1);
    expect(model.people[0].avatarUrl).toBeNull();
  });

  test('refresh inserts a collaborator without moving an existing identity slot', () => {
    const first = layoutOrbit(buildOrbitModel(graph([edge('one')])).people);
    const next = layoutOrbit(
      buildOrbitModel(graph([edge('one'), edge('two', { to: 'other' })]))
        .people,
      first.slots,
      first.radiusX
    );
    expect(next.nodes.find(item => item.person.id === 'peer')?.x).toBe(
      first.nodes.find(item => item.person.id === 'peer')?.x
    );
    expect(next.nodes.find(item => item.person.id === 'peer')?.y).toBe(
      first.nodes.find(item => item.person.id === 'peer')?.y
    );
    expect(next.nodes.find(item => item.person.id === 'other')).toBeTruthy();
  });
});
