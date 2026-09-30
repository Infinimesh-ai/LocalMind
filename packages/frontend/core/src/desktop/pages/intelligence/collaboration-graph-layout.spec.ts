import { describe, expect, test } from 'vitest';

import { layoutRelations } from './collaboration-graph-layout';
import { projectRelations } from './collaboration-graph-model';
import type { WorkbenchCollaborationGraph } from './types';

function fixture(incoming: number[], outgoing: number[]) {
  const edges = [incoming, outgoing].flatMap((counts, side) =>
    counts.flatMap((count, person) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${side}-${person}-${index}`,
        kind: 'sent' as const,
        from: side === 0 ? 'self' : `user-${person}`,
        to: side === 0 ? `user-${person}` : 'self',
        label: `Order ${index}`,
        status: 'open',
        requirementTitles: [],
        requirementItems: [],
        ownConversationExists: true,
        sourceKind: 'project' as const,
        project: { id: 'project', name: 'Project' },
        ownNavigationKind: 'project_session' as const,
        ownSessionId: 'session',
        ownWorkOrderId: null,
        ownProjectId: 'project',
        ownWorkspaceId: null,
        ownDocId: null,
        expiresAt: null,
        updatedAt: '2026-09-28T00:00:00.000Z',
      }))
    )
  );
  const graph: WorkbenchCollaborationGraph = {
    nodes: [
      { id: 'self', label: 'Me', self: true, avatarUrl: null },
      ...Array.from(
        { length: Math.max(incoming.length, outgoing.length) },
        (_, i) => ({
          id: `user-${i}`,
          label: `User ${i}`,
          self: false,
          avatarUrl: null,
        })
      ),
    ],
    edges,
    truncated: false,
  };
  return projectRelations(graph, '');
}

describe('directional relationship layout', () => {
  test.each(['left', 'right'] as const)(
    'two people are vertically centred across all 25 orders on the %s',
    side => {
      const model = fixture(
        side === 'left' ? [25] : [],
        side === 'right' ? [25] : []
      );
      const layout = layoutRelations(
        model.groups,
        new Set(model.groups.map(group => group.key))
      );
      expect(layout.nodes).toHaveLength(1);
      expect(layout.nodes[0].y).toBe(layout.height / 2);
      expect(layout.self.y).toBe(layout.nodes[0].y);
      expect((layout.lines[0].y + layout.lines.at(-1)!.y) / 2).toBe(
        layout.self.y
      );
      expect(layout.lines).toHaveLength(25);
      expect(layout.nodes[0].x < layout.self.x).toBe(side === 'left');
    }
  );
  test('the same person has two distinct directional placements, centred despite unequal order counts', () => {
    const model = fixture([12], [2]);
    const layout = layoutRelations(
      model.groups,
      new Set(model.groups.map(group => group.key))
    );
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes.every(node => node.y === layout.self.y)).toBe(true);
    expect(layout.lines).toHaveLength(14);
    expect(layout.nodes.map(node => node.group.key)).toEqual([
      'left:user-0',
      'right:user-0',
    ]);
  });
  test('seven incoming and eight outgoing groups share one finite graph and centre each side independently', () => {
    const model = fixture(
      Array.from({ length: 7 }, () => 2),
      Array.from({ length: 8 }, () => 3)
    );
    const layout = layoutRelations(
      model.groups,
      new Set(model.groups.map(group => group.key))
    );
    expect(layout.nodes).toHaveLength(15);
    expect(layout.lines).toHaveLength(38);
    for (const side of ['left', 'right']) {
      const nodes = layout.nodes.filter(node => node.group.side === side);
      expect(
        (nodes[0].top + nodes.at(-1)!.top + nodes.at(-1)!.height) / 2
      ).toBe(layout.self.y);
      for (let i = 1; i < nodes.length; i++)
        expect(nodes[i].top).toBeGreaterThan(
          nodes[i - 1].top + nodes[i - 1].height
        );
      expect(
        nodes.every(node => node.x < layout.self.x === (side === 'left'))
      ).toBe(true);
    }
    expect(new Set(layout.lines.map(line => line.item.id)).size).toBe(38);
    expect(
      layout.lines.every(line => line.y > 0 && line.y < layout.height)
    ).toBe(true);
  });
  test('expanding one group preserves every other group and independent expansion state', () => {
    const model = fixture([4, 2], [3, 2]);
    const before = layoutRelations(model.groups, new Set());
    const after = layoutRelations(
      model.groups,
      new Set(['left:user-0', 'right:user-1'])
    );
    expect(before.lines).toHaveLength(4);
    expect(after.lines).toHaveLength(8);
    expect(after.nodes.map(node => node.group.key)).toEqual(
      before.nodes.map(node => node.group.key)
    );
    expect(
      after.nodes.filter(node => node.expanded).map(node => node.group.key)
    ).toEqual(['left:user-0', 'right:user-1']);
  });
  test('summary boxes remain horizontally centred on symmetric connector halves on both sides', () => {
    const model = fixture([3, 2], [2, 1]);
    const layout = layoutRelations(
      model.groups,
      new Set(model.groups.map(group => group.key))
    );
    for (const line of layout.lines) {
      expect(line.connector.x).toBe((line.node.x + layout.self.x) / 2);
      expect(line.rect.x + line.rect.width / 2).toBe(line.connector.x);
      expect(line.rect.y + line.rect.height / 2).toBe(line.y);
      expect(line.rect.x).toBeGreaterThan(
        Math.min(line.node.x, layout.self.x) + 24
      );
      expect(line.rect.x + line.rect.width).toBeLessThan(
        Math.max(line.node.x, layout.self.x) - 24
      );
    }
  });
});
