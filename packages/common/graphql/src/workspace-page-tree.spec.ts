import { describe, expect, it } from 'vitest';

import {
  movePageTreeNode,
  pageTreeAncestors,
  type PageTreeNode,
  pageTreeSiblingOrder,
  pageTreeSubtree,
  validatePageTree,
} from './workspace-page-tree';

function page(
  nodeId: string,
  parentNodeId: string | null = null
): PageTreeNode {
  return {
    nodeId,
    parentNodeId,
    order: 'a0',
    resource: {
      kind: 'doc',
      resourceId: `doc-${nodeId}`,
      primaryMode: 'page',
      trashed: false,
    },
  };
}
function fixture() {
  return [
    page('a'),
    page('b', 'a'),
    page('c', 'b'),
    {
      ...page('file', 'b'),
      resource: { kind: 'file' as const, resourceId: 'native', trashed: false },
    },
    page('d'),
  ];
}
describe('Workspace page ownership graph', () => {
  it('moves only the subtree root and retains resource identities', () => {
    const before = fixture();
    const after = movePageTreeNode(before, 'b', 'd', 'a1');
    expect(after[1].parentNodeId).toBe('d');
    expect(after[2]).toBe(before[2]);
    expect(after[3]).toBe(before[3]);
    expect(before[1].parentNodeId).toBe('a');
    expect(pageTreeSubtree(after, 'b').map(node => node.nodeId)).toEqual([
      'b',
      'c',
      'file',
    ]);
    expect(
      pageTreeAncestors(validatePageTree(after), 'c').map(node => node.nodeId)
    ).toEqual(['d', 'b']);
  });
  it.each(['b', 'c', 'file'])(
    'rejects moving a container into itself, descendants or leaves (%s)',
    parent => {
      expect(() => movePageTreeNode(fixture(), 'b', parent, 'a1')).toThrow();
    }
  );
  it('rejects missing parents instead of inventing a root location', () => {
    expect(() =>
      movePageTreeNode(fixture(), 'b', 'hidden-parent', 'a1')
    ).toThrow('invalid_parent');
  });
  it('requires one explicit position for every inventory resource', () => {
    const nodes = fixture();
    expect(() =>
      validatePageTree(
        nodes.slice(1),
        nodes.map(node => node.resource)
      )
    ).toThrow('missing_resource');
    expect(() =>
      validatePageTree([...nodes, { ...nodes[1], nodeId: 'alias' }])
    ).toThrow('duplicate_resource');
    expect(() =>
      validatePageTree(
        nodes,
        nodes.slice(1).map(node => node.resource)
      )
    ).toThrow('missing_resource');
  });
  it('allows distinct resource kinds sharing an ID without merging them', () => {
    const nodes = fixture();
    nodes[3].resource.resourceId = nodes[1].resource.resourceId;
    expect(validatePageTree(nodes).size).toBe(5);
  });
  it('rejects persistent page to whiteboard conversion with descendants, including recycled ones', () => {
    const nodes = fixture();
    nodes[1].resource.primaryMode = 'edgeless';
    nodes[2].resource.trashed = true;
    nodes[3].resource.trashed = true;
    expect(() => validatePageTree(nodes)).toThrow('invalid_parent');
  });
  it('keeps recycled ownership and rejects active children in a recycled parent', () => {
    const nodes = fixture();
    nodes[1].resource.trashed = true;
    expect(() => validatePageTree(nodes)).toThrow('parent_trashed');
    nodes[2].resource.trashed = true;
    nodes[3].resource.trashed = true;
    expect(validatePageTree(nodes).size).toBe(5);
    expect(() => movePageTreeNode(nodes, 'b', null, 'a1')).toThrow(
      'invalid_node'
    );
  });
  it('enforces the 64-layer boundary for the whole moved subtree', () => {
    const nodes = Array.from({ length: 64 }, (_, i) =>
      page(String(i), i ? String(i - 1) : null)
    );
    expect(validatePageTree(nodes).size).toBe(64);
    expect(() => validatePageTree([...nodes, page('65', '63')])).toThrow(
      'depth_exceeded'
    );
    expect(() =>
      movePageTreeNode([...nodes, page('root')], '0', 'root', 'a1')
    ).toThrow('depth_exceeded');
  });
  it('rejects cross-node resource type and lifecycle spoofing', () => {
    const nodes = fixture(),
      inventory = structuredClone(nodes.map(node => node.resource));
    nodes[1].resource.primaryMode = 'edgeless';
    expect(() => validatePageTree(nodes, inventory)).toThrow('invalid_node');
    nodes[1].resource.primaryMode = 'page';
    nodes[1].resource.trashed = true;
    expect(() => validatePageTree(nodes, inventory)).toThrow('invalid_node');
  });
  it('validates wide trees without a partial-success cap', () => {
    const nodes = [
      page('parent'),
      ...Array.from({ length: 15000 }, (_, i) => page(String(i), 'parent')),
    ];
    expect(validatePageTree(nodes).size).toBe(15001);
    expect(pageTreeSubtree(nodes, 'parent')).toHaveLength(15001);
  });
});

it('complete manual sibling order cannot omit hidden siblings or include foreign and recycled nodes', () => {
  const nodes = [
    page('a'),
    page('b'),
    page('child', 'a'),
    {
      ...page('trash'),
      resource: { ...page('trash').resource, trashed: true },
    },
  ];
  expect(pageTreeSiblingOrder(nodes, null, ['b', 'a'])).toEqual(['a', 'b']);
  for (const order of [['a'], ['a', 'a'], ['a', 'child'], ['a', 'b', 'trash']])
    expect(() => pageTreeSiblingOrder(nodes, null, order)).toThrow();
});

it('folder metadata is typed and paired, and stable node IDs survive container conversion', () => {
  const folder: PageTreeNode = {
    ...page('stable'),
    resource: { kind: 'folder', resourceId: 'folder', trashed: false },
    folder: {
      title: 'Folder',
      metadataVersion: 1,
      createdAt: null,
      createdBy: null,
      updatedAt: null,
      updatedBy: null,
    },
  };
  const child = page('child', 'stable');
  expect(validatePageTree([folder, child]).size).toBe(2);
  expect(
    validatePageTree([
      { ...folder, folder: undefined, resource: page('converted').resource },
      child,
    ]).size
  ).toBe(2);
  expect(() =>
    validatePageTree([
      {
        ...folder,
        folder: { ...folder.folder!, createdAt: new Date().toISOString() },
      },
    ])
  ).toThrow('invalid_node');
  expect(() =>
    validatePageTree([
      { ...folder, resource: { ...folder.resource, primaryMode: 'page' } },
    ])
  ).toThrow('invalid_node');
});
