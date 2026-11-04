import { isDeepStrictEqual } from 'node:util';

import {
  Bound,
  getBoundFromPoints,
  inflateBound,
  rotatePoints,
  transformPointsToNewBound,
} from '@blocksuite/global/geometry';
import * as Y from 'yjs';

import type { NativeEditContext } from './document-database';
import { layoutNativeMindmap } from './document-mindmap';
import type { DocumentSurfaceCommand } from './document-surface-schema';

type Map = Y.Map<unknown>;
const kinds = new Set([
  'shape',
  'text',
  'brush',
  'highlighter',
  'connector',
  'group',
  'mindmap',
]);
const font = {
  color: '#000000',
  fontFamily: 'blocksuite:surface:Inter',
  fontSize: 16,
  fontStyle: 'normal',
  fontWeight: '400',
  textAlign: 'center',
};
const defaults: Record<string, Record<string, unknown>> = {
  shape: {
    ...font,
    fontSize: 20,
    xywh: '[0,0,100,100]',
    rotate: 0,
    fillColor: '#ffffff',
    filled: false,
    maxWidth: false,
    padding: [10, 20],
    radius: 0,
    roughness: 1.4,
    shadow: null,
    shapeStyle: 'General',
    shapeType: 'rect',
    strokeColor: '#000000',
    strokeStyle: 'solid',
    strokeWidth: 4,
    textHorizontalAlign: 'center',
    textVerticalAlign: 'center',
    textResizing: 1,
  },
  text: { ...font, xywh: '[0,0,16,16]', rotate: 0, hasMaxWidth: false },
  brush: {
    color: '#000000',
    lineWidth: 4,
    points: [],
    rotate: 0,
    xywh: '[0,0,0,0]',
  },
  highlighter: {
    color: '#ffff00',
    lineWidth: 20,
    points: [],
    rotate: 0,
    xywh: '[0,0,0,0]',
  },
  connector: {
    mode: 2,
    stroke: '#000000',
    strokeStyle: 'solid',
    strokeWidth: 4,
    roughness: 1.4,
    source: { position: [0, 0] },
    target: { position: [0, 0] },
    frontEndpointStyle: 'None',
    rearEndpointStyle: 'Arrow',
    labelDisplay: true,
    labelOffset: { distance: 0.5, anchor: 'center' },
    labelStyle: font,
    labelConstraints: { hasMaxWidth: true, maxWidth: 280 },
  },
  group: {},
  mindmap: { layoutType: 0, style: 1 },
};
export function surfaceElements(context: NativeEditContext, id: string) {
  const block = context.blockById(id);
  if (
    block.get('sys:flavour') !== 'affine:surface' ||
    block.get('sys:version') !== 5
  )
    context.invalid('unsupported_surface_schema', id);
  const boxed = block.get('prop:elements');
  const elements =
    boxed instanceof Y.Map &&
    boxed.get('type') === '$blocksuite:internal:native$'
      ? boxed.get('value')
      : boxed;
  if (!(elements instanceof Y.Map)) context.invalid('invalid_surface_storage');
  return elements as Y.Map<Map>;
}
function plain(value: unknown): unknown {
  return value instanceof Y.AbstractType ? value.toJSON() : value;
}
function mergePlain(previous: unknown, value: unknown): unknown {
  previous = plain(previous);
  if (
    previous &&
    value &&
    typeof previous === 'object' &&
    typeof value === 'object' &&
    !Array.isArray(previous) &&
    !Array.isArray(value)
  ) {
    const result: Record<string, unknown> = { ...previous };
    for (const [key, field] of Object.entries(value))
      result[key] = mergePlain(result[key], field);
    return result;
  }
  return value;
}
// Gfx @field stores plain JSON (unlike ordinary block props). A Y.Map used for
// e.g. Color or Connection would reach the editor as the wrong runtime type.
function setPlain(element: Map, key: string, value: unknown) {
  const merged = mergePlain(element.get(key), value);
  if (!isDeepStrictEqual(plain(element.get(key)), merged))
    element.set(key, merged);
}

/** Maintain native canvas relationships before removing their target identities. */
export function detachDeletedGraphics(
  context: NativeEditContext,
  deleted: ReadonlySet<string>,
  policy: 'reject' | 'detach'
) {
  const all = new Map<string, { map: Map; prefix: string }>();
  for (const [id, block] of context.blocks) {
    all.set(id, { map: block, prefix: 'prop:' });
    if (
      block.get('sys:flavour') === 'affine:surface' &&
      block.get('sys:version') === 5
    )
      for (const [elementId, element] of surfaceElements(context, id))
        all.set(elementId, { map: element, prefix: '' });
  }
  for (const [id, { map, prefix }] of all) {
    if (deleted.has(id)) continue;
    const children = map.get(prefix ? 'prop:childElementIds' : 'children');
    if (children instanceof Y.Map)
      for (const child of deleted)
        if (children.has(child)) {
          if (policy === 'reject')
            context.invalid('graphic_has_container_dependencies', child);
          if (map.get('type') === 'mindmap')
            context.invalid('update_mindmap_members_before_delete', child);
          children.delete(child);
        }
    if (prefix && deleted.has(String(map.get('prop:reference'))))
      context.invalid('graphic_has_surface_reference', id);
    if (prefix || map.get('type') !== 'connector') continue;
    for (const field of ['source', 'target']) {
      const value = plain(map.get(field));
      if (
        !value ||
        typeof value !== 'object' ||
        !('id' in value) ||
        !deleted.has(String(value.id))
      )
        continue;
      if (policy === 'reject')
        context.invalid('graphic_has_connector_dependencies', String(value.id));
      const target = all.get(String(value.id));
      if (!target)
        context.invalid('connector_target_not_found', String(value.id));
      const bound = Bound.deserialize(
        String(target.map.get(`${target.prefix}xywh`))
      );
      const relative =
        'position' in value && Array.isArray(value.position)
          ? value.position
          : [0.5, 0.5];
      const point = bound.getRelativePoint([
        Number(relative[0]),
        Number(relative[1]),
      ]);
      const position = rotatePoints(
        [point],
        bound.center,
        Number(target.map.get(`${target.prefix}rotate`) ?? 0)
      )[0];
      const next = { ...value, position };
      delete (next as { id?: string }).id;
      map.set(field, next);
    }
  }
}

export function applySurfaceCommand(
  context: NativeEditContext,
  command: DocumentSurfaceCommand
) {
  const invalid: NativeEditContext['invalid'] = context.invalid;
  const { resolve } = context;
  const elements = surfaceElements(context, command.surfaceId);
  const get = (id: string) => {
    const element = elements.get(resolve(id));
    if (!(element instanceof Y.Map) || !kinds.has(String(element.get('type'))))
      invalid('unsupported_surface_element', id);
    return element;
  };
  const graphic = (id: string) => {
    const element = elements.get(id);
    if (element) return { map: element, prefix: '' };
    const block = context.blocks.get(id);
    const flavour = String(block?.get('sys:flavour'));
    if (
      !block ||
      !(
        flavour.startsWith('affine:embed-') ||
        [
          'affine:note',
          'affine:image',
          'affine:attachment',
          'affine:bookmark',
          'affine:latex',
          'affine:frame',
          'affine:edgeless-text',
        ].includes(flavour)
      )
    )
      invalid('graphic_not_found', id);
    return { map: block, prefix: 'prop:' };
  };
  const checkConnection = (value: unknown, selfId: string) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      value.id === undefined
    )
      return value;
    const id = resolve(String(value.id));
    if (id === selfId) invalid('connector_cannot_target_itself');
    const target = graphic(id);
    if (
      !target.prefix &&
      ['connector', 'group', 'mindmap'].includes(String(target.map.get('type')))
    )
      invalid('unsupported_connection_target', id);
    return { ...value, id };
  };
  const apply = (element: Map, properties: Record<string, unknown>) => {
    const kind = String(element.get('type'));
    const stroke = kind === 'brush' || kind === 'highlighter';
    const id = String(element.get('id'));
    const next = { ...properties };
    if (kind === 'connector')
      for (const field of ['source', 'target']) {
        if (field in next) next[field] = checkConnection(next[field], id);
      }
    if (stroke && ('xywh' in next || 'lineWidth' in next)) {
      const points = plain(element.get('points'));
      if (!Array.isArray(points)) invalid('invalid_stroke_points');
      const previous = Bound.deserialize(String(element.get('xywh')));
      const oldWidth = Number(element.get('lineWidth'));
      const width = 'lineWidth' in next ? Number(next.lineWidth) : oldWidth;
      const bound =
        'xywh' in next
          ? Bound.deserialize(String(next.xywh))
          : previous.w && previous.h
            ? inflateBound(previous, width - oldWidth)
            : previous;
      if (
        points.length &&
        (previous.w !== bound.w || previous.h !== bound.h || oldWidth !== width)
      ) {
        const transformed = transformPointsToNewBound(
          points.map(point => ({ x: Number(point[0]), y: Number(point[1]) })),
          previous,
          oldWidth / 2,
          bound,
          width / 2
        );
        next.points = transformed.points.map((point, i) => [
          point.x,
          point.y,
          ...(points[i][2] === undefined ? [] : [points[i][2]]),
        ]);
        next.xywh = transformed.bound.serialize();
      }
    }
    for (const [key, value] of Object.entries(next)) {
      if (
        (key === 'source' || key === 'target') &&
        !isDeepStrictEqual(element.get(key), value)
      )
        element.set(key, value);
      else setPlain(element, key, value);
    }
  };
  switch (command.type) {
    case 'mindmap.layout': {
      const element = get(command.elementId);
      if (element.get('type') !== 'mindmap') invalid('expected_mindmap');
      layoutNativeMindmap(context, elements, element);
      break;
    }
    case 'frame.members.set': {
      const frameId = resolve(command.frameId),
        frame = context.blockById(frameId);
      if (
        frame.get('sys:flavour') !== 'affine:frame' ||
        frame.get('sys:version') !== 1
      )
        invalid('expected_frame', frameId);
      const ids = command.members.map(resolve),
        desired = new Set(ids);
      if (desired.size !== ids.length || desired.has(frameId))
        invalid('invalid_frame_members');
      const childrenOf = (id: string): string[] => {
        const target = graphic(id),
          children = target.map.get(
            target.prefix ? 'prop:childElementIds' : 'children'
          );
        return children instanceof Y.Map ? [...children.keys()] : [];
      };
      for (const id of ids) {
        graphic(id);
        const visiting = new Set<string>();
        const visit = (id: string) => {
          if (id === frameId || visiting.has(id)) invalid('cyclic_frame');
          visiting.add(id);
          childrenOf(id).forEach(visit);
          visiting.delete(id);
        };
        visit(id);
        for (const block of context.blocks.values()) {
          const members = block.get('prop:childElementIds');
          if (block !== frame && members instanceof Y.Map && members.has(id))
            invalid('graphic_already_framed', id);
        }
        for (const element of elements.values()) {
          const members = element.get('children');
          if (members instanceof Y.Map && members.has(id))
            invalid('graphic_already_grouped', id);
        }
      }
      let children = frame.get('prop:childElementIds');
      if (children === undefined && !ids.length) break;
      if (children === undefined) {
        children = new Y.Map();
        frame.set('prop:childElementIds', children);
      }
      if (!(children instanceof Y.Map)) invalid('invalid_frame_storage');
      for (const id of children.keys())
        if (!desired.has(id)) children.delete(id);
      for (const id of ids)
        if (children.get(id) !== true) children.set(id, true);
      break;
    }
    case 'element.create': {
      const id = context.allocate(command.clientRef);
      if (elements.has(id)) invalid('identity_collision', id);
      const element = new Y.Map<unknown>();
      elements.set(id, element);
      element.set('id', id);
      element.set('type', command.element.kind);
      element.set('index', 'a0');
      element.set('lockedBySelf', false);
      element.set(
        'seed',
        [...id].reduce(
          (seed, char) => (seed * 31 + char.charCodeAt(0)) & 0x7fffffff,
          1
        )
      );
      for (const [key, value] of Object.entries(defaults[command.element.kind]))
        element.set(key, structuredClone(value));
      if (['group', 'mindmap'].includes(command.element.kind))
        element.set('children', new Y.Map());
      if (command.element.kind === 'group') element.set('title', new Y.Text());
      if (['shape', 'text', 'connector'].includes(command.element.kind))
        element.set('text', new Y.Text());
      apply(element, command.element.properties);
      if (element.get('type') === 'mindmap')
        layoutNativeMindmap(context, elements, element);
      break;
    }
    case 'element.update': {
      const element = get(command.elementId);
      if (element.get('type') !== command.element.kind)
        invalid('element_type_mismatch');
      apply(element, command.element.properties);
      if (element.get('type') === 'mindmap')
        layoutNativeMindmap(context, elements, element);
      break;
    }
    case 'element.stroke.set_points': {
      const element = get(command.elementId);
      if (!['brush', 'highlighter'].includes(String(element.get('type'))))
        invalid('expected_stroke_element');
      const bound = inflateBound(
        getBoundFromPoints(command.points.map(([x, y]) => [x, y])),
        Number(element.get('lineWidth'))
      );
      setPlain(
        element,
        'points',
        command.points.map(([x, y, pressure]) => [
          x - bound.x,
          y - bound.y,
          ...(pressure === undefined ? [] : [pressure]),
        ])
      );
      setPlain(element, 'xywh', bound.serialize());
      break;
    }
    case 'element.members.set': {
      const id = resolve(command.elementId),
        element = get(id);
      const kind = element.get('type');
      if (kind !== 'group' && kind !== 'mindmap') invalid('expected_group');
      const children = element.get('children');
      if (!(children instanceof Y.Map)) invalid('invalid_group_storage');
      const members = command.members.map(member => ({
        ...member,
        id: resolve(member.id),
        parent: member.parent ? resolve(member.parent) : undefined,
      }));
      const ids = new Set(members.map(member => member.id));
      if (ids.size !== members.length || ids.has(id))
        invalid('invalid_group_members');
      for (const member of members) {
        const target = graphic(member.id);
        if (
          kind === 'mindmap' &&
          (target.prefix || target.map.get('type') !== 'shape' || !member.index)
        )
          invalid('mindmap_requires_indexed_shapes');
        for (const candidate of elements.values()) {
          const childIds = candidate.get('children');
          if (
            candidate !== element &&
            childIds instanceof Y.Map &&
            childIds.has(member.id)
          )
            invalid('graphic_already_grouped', member.id);
        }
        for (const block of context.blocks.values()) {
          const childIds = block.get('prop:childElementIds');
          if (childIds instanceof Y.Map && childIds.has(member.id))
            invalid('graphic_already_framed', member.id);
        }
        const visited = new Set<string>();
        const visit = (childId: string) => {
          if (childId === id || visited.has(childId)) invalid('cyclic_group');
          visited.add(childId);
          const children = elements.get(childId)?.get('children');
          if (children instanceof Y.Map)
            for (const nested of children.keys()) visit(nested);
        };
        visit(member.id);
      }
      if (kind === 'mindmap' && members.length) {
        if (members.filter(member => !member.parent).length !== 1)
          invalid('mindmap_requires_one_root');
        const byId = new Map(members.map(member => [member.id, member]));
        for (const member of members) {
          let node = member;
          const seen = new Set<string>();
          while (node.parent) {
            if (seen.has(node.id)) invalid('cyclic_mindmap');
            seen.add(node.id);
            node =
              byId.get(node.parent) ??
              invalid('mindmap_parent_not_found', node.parent);
          }
        }
      }
      for (const child of children.keys())
        if (!ids.has(child)) children.delete(child);
      for (const member of members) {
        if (kind === 'group') {
          if (children.get(member.id) !== true) children.set(member.id, true);
        } else {
          if (!member.index) invalid('mindmap_requires_indexed_shapes');
          const detail = {
            index: member.index,
            ...(member.parent ? { parent: member.parent } : {}),
            ...(member.collapsed !== undefined
              ? { collapsed: member.collapsed }
              : {}),
          };
          const previous = plain(children.get(member.id));
          const merged = {
            ...(previous && typeof previous === 'object' ? previous : {}),
            ...detail,
          };
          if (!member.parent) delete (merged as { parent?: string }).parent;
          if (!isDeepStrictEqual(previous, merged))
            children.set(member.id, merged);
        }
      }
      if (kind === 'mindmap') layoutNativeMindmap(context, elements, element);
      break;
    }
    case 'element.delete': {
      const id = resolve(command.elementId);
      get(id);
      const deleted = new Set<string>();
      const visit = (id: string) => {
        if (deleted.has(id)) invalid('cyclic_group');
        deleted.add(id);
        const children = elements.get(id)?.get('children');
        if (command.includeChildren && children instanceof Y.Map)
          for (const child of children.keys()) {
            if (!elements.has(child))
              invalid('group_contains_block_use_block_delete', child);
            visit(child);
          }
      };
      visit(id);
      detachDeletedGraphics(context, deleted, command.references);
      for (const deletedId of deleted) elements.delete(deletedId);
      break;
    }
  }
}
