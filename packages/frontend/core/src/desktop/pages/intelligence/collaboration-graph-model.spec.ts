import { describe, expect, test } from 'vitest';

import {
  matchesOrderFilter,
  projectRelations,
  relationConnector,
  relationTone,
} from './collaboration-graph-model';
import type { WorkbenchCollaborationGraph } from './types';

const graph = {
  nodes: [
    { id: 'a', label: '我', self: true, avatarUrl: null },
    { id: 'b', label: '李明', self: false, avatarUrl: null },
    { id: 'c', label: '陈晨', self: false, avatarUrl: null },
  ],
  edges: [
    {
      id: 'one',
      kind: 'sent',
      from: 'b',
      to: 'a',
      status: 'open',
      label: '交付一',
      requirementTitles: ['摘要', '图表'],
      requirementItems: [
        { id: 'summary', title: '摘要', kind: 'text' },
        { id: 'chart', title: '图表', kind: 'text' },
      ],
      ownConversationExists: true,
      sourceKind: 'project',
      project: { id: 'p', name: '甲项目' },
      ownNavigationKind: 'work_order',
      ownSessionId: null,
      ownWorkOrderId: 'one',
      ownProjectId: null,
      ownWorkspaceId: null,
      ownDocId: null,
      expiresAt: null,
      updatedAt: '2026-09-24T00:00:00.000Z',
    },
    {
      id: 'two',
      kind: 'sent',
      from: 'a',
      to: 'b',
      status: 'delivered',
      label: '交付二',
      requirementTitles: ['材料'],
      requirementItems: [{ id: 'file', title: '材料', kind: 'text' }],
      ownConversationExists: true,
      sourceKind: 'project',
      project: { id: 'p', name: '甲项目' },
      ownNavigationKind: 'project_session',
      ownSessionId: 'source',
      ownWorkOrderId: null,
      ownProjectId: 'p',
      ownWorkspaceId: null,
      ownDocId: null,
      expiresAt: null,
      updatedAt: '2026-09-23T00:00:00.000Z',
    },
    {
      id: 'three',
      kind: 'draft',
      from: 'a',
      to: 'b',
      status: 'draft',
      label: '交付三',
      requirementTitles: ['草稿'],
      requirementItems: [{ id: 'draft-file', title: '草稿', kind: 'text' }],
      ownConversationExists: true,
      sourceKind: 'workspace',
      project: null,
      ownNavigationKind: 'workspace_session',
      ownSessionId: 'workspace-source',
      ownWorkOrderId: null,
      ownProjectId: null,
      ownWorkspaceId: 'w',
      ownDocId: 'd',
      expiresAt: '2026-09-24T00:30:00.000Z',
      updatedAt: '2026-09-22T00:00:00.000Z',
    },
  ],
  truncated: false,
} satisfies WorkbenchCollaborationGraph;

describe('relationship graph projection', () => {
  test('separates a person by delivery direction while each order keeps one identity across projects', () => {
    const model = projectRelations(graph, '');
    expect(model.selfId).toBe('a');
    expect(model.personCount).toBe(1);
    expect(
      model.groups.map(group => [
        group.key,
        group.userId,
        group.side,
        group.items.length,
      ])
    ).toEqual([
      ['left:b', 'b', 'left', 2],
      ['right:b', 'b', 'right', 1],
    ]);
    expect(
      model.relations.map(relation => [
        relation.deliveryFrom,
        relation.deliveryTo,
      ])
    ).toEqual([
      ['a', 'b'],
      ['b', 'a'],
      ['b', 'a'],
    ]);
    const items = model.groups.flatMap(group => group.items);
    expect(new Set(items.map(item => item.id)).size).toBe(3);
    expect(items.map(item => item.title).sort()).toEqual(
      ['交付一', '交付二', '交付三'].sort()
    );
    expect(
      model.groups[0].items.every(
        item => item.relation.deliveryTo === model.selfId
      )
    ).toBe(true);
    expect(
      model.groups[1].items.every(
        item => item.relation.deliveryFrom === model.selfId
      )
    ).toBe(true);
  });

  test('keeps project filtering, separates different users with the same name, and ignores unrelated edges', () => {
    expect(
      projectRelations(graph, 'work_order').relations.map(
        relation => relation.id
      )
    ).toEqual(['three']);
    expect(
      projectRelations(graph, 'p').relations.map(relation => relation.id)
    ).toEqual(['one', 'two']);
    const extra = { ...graph.edges[0], id: 'other', to: 'c', from: 'a' };
    const model = projectRelations(
      {
        ...graph,
        nodes: graph.nodes.map(node => ({ ...node, label: '同名' })),
        edges: [
          ...graph.edges,
          extra,
          { ...extra, id: 'unrelated', from: 'b' },
        ],
      },
      ''
    );
    expect(model.groups).toHaveLength(3);
    expect(model.personCount).toBe(2);
    expect(model.relations.some(relation => relation.id === 'unrelated')).toBe(
      false
    );
  });

  test('keeps person order stable during status refreshes', () => {
    const value = {
      ...graph,
      edges: [
        ...graph.edges,
        { ...graph.edges[0], id: 'four', from: 'a', to: 'c' },
      ],
    };
    expect(projectRelations(value, '').groups.map(group => group.key)).toEqual(
      projectRelations(
        { ...value, edges: [...value.edges].reverse() },
        ''
      ).groups.map(group => group.key)
    );
  });

  test('centers label and gives both ends symmetric horizontal connections', () => {
    const line = relationConnector({ x: 80, y: 100 }, { x: 400, y: 300 }, 160);
    expect([line.x, line.y]).toEqual([240, 200]);
    expect(line.left).toBe('M80 100 C120 100, 120 200, 160 200');
    expect(line.right).toBe('M320 200 C360 200, 360 300, 400 300');
    const expanded = relationConnector(
      { x: 80, y: 220 },
      { x: 400, y: 220 },
      160,
      80
    );
    expect(expanded.left).toBe('M80 220 C120 220, 120 80, 160 80');
    expect(expanded.right).toBe('M320 80 C360 80, 360 220, 400 220');
  });

  test('status tones do not treat refusal or cancellation as delivered', () => {
    expect(relationTone('refused', 'left')).toBe('muted');
    expect(relationTone('cancelled', 'right')).toBe('muted');
    expect(relationTone('validating', 'left')).toBe('incoming');
    expect(relationTone('adopted', 'right')).toBe('complete');
  });
});

test('delivery filters cover both directions, ended states and unconfirmed drafts', () => {
  const relations = projectRelations(graph, '').relations;
  expect(
    relations.filter(value => matchesOrderFilter(value, 'all'))
  ).toHaveLength(3);
  expect(
    relations
      .filter(value => matchesOrderFilter(value, 'mine'))
      .map(value => value.id)
  ).toEqual(['one']);
  expect(
    relations
      .filter(value => matchesOrderFilter(value, 'ended'))
      .map(value => value.id)
  ).toEqual(['two']);
  expect(
    relations.filter(value => matchesOrderFilter(value, 'theirs'))
  ).toHaveLength(0);
  expect(
    matchesOrderFilter({ ...relations[1], status: 'validating' }, 'theirs')
  ).toBe(true);
  expect(
    matchesOrderFilter({ ...relations[0], status: 'cancelled' }, 'ended')
  ).toBe(true);
});

test('adding requirements never splits a work order into extra graph summaries', () => {
  const before = projectRelations(graph, '').groups.flatMap(
    group => group.items
  );
  const after = projectRelations(
    {
      ...graph,
      edges: graph.edges.map(edge => ({
        ...edge,
        requirementItems: [
          ...edge.requirementItems,
          { id: 'extra', kind: 'file', title: '补充文件' },
        ],
      })),
    },
    ''
  ).groups.flatMap(group => group.items);
  expect(after.map(item => ({ id: item.id, title: item.title }))).toEqual(
    before.map(item => ({ id: item.id, title: item.title }))
  );
});
