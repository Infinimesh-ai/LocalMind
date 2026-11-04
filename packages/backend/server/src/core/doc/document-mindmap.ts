import {
  layout,
  LayoutType,
  type MindmapLayoutNode,
  type MindmapLayoutRoot,
} from '@blocksuite/affine-model/mindmap-layout';
import { mindmapStyleGetters } from '@blocksuite/affine-model/mindmap-style';
import { Bound, type SerializedXYWH } from '@blocksuite/global/geometry';
import * as Y from 'yjs';

import type { NativeEditContext } from './document-database';

/** The shape bounds supplied by the command use the same layout as the editor. */
export function layoutNativeMindmap(
  context: NativeEditContext,
  elements: Y.Map<Y.Map<unknown>>,
  mindmap: Y.Map<unknown>
) {
  const children = mindmap.get('children');
  if (!(children instanceof Y.Map)) context.invalid('invalid_mindmap_children');
  if (!children.size) return;
  const nodes = new Map<
    string,
    MindmapLayoutNode & { id: string; index: string; parent?: string }
  >();
  for (const [id, detail] of children) {
    const model = elements.get(id);
    if (
      !model ||
      model.get('type') !== 'shape' ||
      !detail ||
      typeof detail !== 'object' ||
      !('index' in detail) ||
      typeof detail.index !== 'string'
    )
      context.invalid('invalid_mindmap_node', id);
    const element = {
      get elementBound() {
        return Bound.deserialize(String(model.get('xywh')));
      },
      get x() {
        return this.elementBound.x;
      },
      get y() {
        return this.elementBound.y;
      },
      get w() {
        return this.elementBound.w;
      },
      get h() {
        return this.elementBound.h;
      },
      get xywh() {
        return String(model.get('xywh')) as SerializedXYWH;
      },
      set xywh(value: SerializedXYWH) {
        if (value !== model.get('xywh')) model.set('xywh', value);
      },
    };
    nodes.set(id, {
      id,
      element,
      detail: {
        collapsed: 'collapsed' in detail ? detail.collapsed === true : false,
      },
      children: [],
      index: detail.index,
      parent: 'parent' in detail ? String(detail.parent) : undefined,
    });
  }
  const roots = [...nodes.values()].filter(node => !node.parent);
  if (roots.length !== 1) context.invalid('mindmap_requires_one_root');
  for (const node of nodes.values())
    if (node.parent) {
      const parent = nodes.get(node.parent);
      if (!parent) context.invalid('mindmap_parent_not_found', node.parent);
      parent.children.push(node);
    }
  const visited = new Set<MindmapLayoutNode>();
  const visit = (node: MindmapLayoutNode, depth = 0) => {
    if (visited.has(node) || depth > 256)
      context.invalid('invalid_mindmap_depth_or_cycle');
    visited.add(node);
    node.children.sort((a, b) => {
      const left = (a as { index?: string }).index ?? '',
        right = (b as { index?: string }).index ?? '';
      return left < right ? -1 : left > right ? 1 : 0;
    });
    node.children.forEach(child => visit(child, depth + 1));
  };
  const root = roots[0];
  visit(root);
  if (visited.size !== nodes.size) context.invalid('disconnected_mindmap');
  const style =
    mindmapStyleGetters[
      Number(mindmap.get('style')) as keyof typeof mindmapStyleGetters
    ];
  if (!style) context.invalid('invalid_mindmap_style');
  // Styles come from the editor model. Bounds remain explicit native geometry:
  // a server must not replace browser font measurements with guessed dimensions.
  const applyStyle = (node: MindmapLayoutNode, path: number[]) => {
    const id = (node as MindmapLayoutNode & { id: string }).id;
    const values =
      path.length === 1 ? style.root : style.getNodeStyle(undefined, path).node;
    for (const [key, value] of Object.entries(values)) {
      const model =
        elements.get(id) ?? context.invalid('mindmap_node_not_found', id);
      if (JSON.stringify(model.get(key)) !== JSON.stringify(value))
        model.set(key, value);
    }
    node.children.forEach((child, index) =>
      applyStyle(child, [...path, index])
    );
  };
  applyStyle(root, [0]);
  const split = Math.ceil(root.children.length / 2);
  const balanced: MindmapLayoutRoot = {
    ...root,
    right: root.children.slice(0, split),
    left: root.children.slice(split).reverse(),
  };
  const direction = Number(mindmap.get('layoutType'));
  if (
    ![LayoutType.LEFT, LayoutType.RIGHT, LayoutType.BALANCE].includes(direction)
  )
    context.invalid('invalid_mindmap_layout');
  layout(balanced, { layoutType: direction }, null, [0]);
}
