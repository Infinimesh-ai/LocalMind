import {
  type OfficeCommand,
  type OfficePresentationSetShapeGeometryCommand,
  type OfficePresentationSetShapeTextCommand,
  parseOfficeCommand,
} from '../command';
import {
  buildPreservedXml,
  type OrderedXmlNode,
  parsePreservedXml,
} from '../docx/xml';
import { type OoxmlOpcPackage, OoxmlPackageError } from '../ooxml';
import { openPptxPackage } from './package';
import {
  type PptxSemanticState,
  type PptxShape,
  readPptxSemanticState,
} from './semantic';
import {
  applyPptxStructuralCommand,
  type PptxStructuralCommand,
} from './structural-edit';

const EMU_PER_POINT = 12_700;

type PptxCommand =
  | OfficePresentationSetShapeTextCommand
  | OfficePresentationSetShapeGeometryCommand;

export type PptxCommandResult = {
  packageBytes: Uint8Array;
  state: PptxSemanticState;
  summary: Record<string, unknown> & { operation: string };
};

function elementKey(node: OrderedXmlNode) {
  return Object.keys(node).find(
    key => key !== ':@' && key !== '#text' && !key.startsWith('?')
  );
}

function localName(name: string) {
  const colon = name.lastIndexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

function prefixOf(name: string) {
  const colon = name.indexOf(':');
  return colon === -1 ? '' : name.slice(0, colon);
}

function qualify(prefix: string, name: string) {
  return prefix ? `${prefix}:${name}` : name;
}

function attributes(node: OrderedXmlNode) {
  const value = node[':@'];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

function attribute(node: OrderedXmlNode, name: string) {
  return Object.entries(attributes(node)).find(
    ([key]) => localName(key) === name
  )?.[1];
}

function setAttribute(node: OrderedXmlNode, name: string, value?: string) {
  const attrs = { ...attributes(node) };
  const existing = Object.keys(attrs).find(key => localName(key) === name);
  if (value === undefined) {
    if (existing) delete attrs[existing];
  } else {
    attrs[existing ?? name] = value;
  }
  if (Object.keys(attrs).length) node[':@'] = attrs;
  else delete node[':@'];
}

function children(node: OrderedXmlNode) {
  const key = elementKey(node);
  const value = key ? node[key] : undefined;
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

function createElement(
  prefix: string,
  name: string,
  content: OrderedXmlNode[] = [],
  attrs?: Record<string, string>
): OrderedXmlNode {
  return {
    [qualify(prefix, name)]: content,
    ...(attrs && Object.keys(attrs).length ? { ':@': attrs } : {}),
  };
}

function findChild(nodes: OrderedXmlNode[], name: string) {
  return nodes.find(node => {
    const key = elementKey(node);
    return key ? localName(key) === name : false;
  });
}

function findDescendant(
  nodes: OrderedXmlNode[],
  name: string
): OrderedXmlNode | undefined {
  for (const node of nodes) {
    const key = elementKey(node);
    if (key && localName(key) === name) return node;
    const found = findDescendant(children(node), name);
    if (found) return found;
  }
  return undefined;
}

function findShape(
  nodes: OrderedXmlNode[],
  shapeId: string
): OrderedXmlNode | undefined {
  for (const node of nodes) {
    const key = elementKey(node);
    const name = key ? localName(key) : '';
    if (['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].includes(name)) {
      const nonVisual = findDescendant(children(node), 'cNvPr');
      if (nonVisual && attribute(nonVisual, 'id') === shapeId) return node;
    }
    const found = findShape(children(node), shapeId);
    if (found) return found;
  }
  return undefined;
}

function firstRunProperties(nodes: OrderedXmlNode[]) {
  const properties = findDescendant(nodes, 'rPr');
  return properties
    ? (structuredClone(properties) as OrderedXmlNode)
    : undefined;
}

function textNode(prefix: string, text: string) {
  const node = createElement(prefix, 't', [{ '#text': text }]);
  if (/^\s|\s$/.test(text)) node[':@'] = { 'xml:space': 'preserve' };
  return node;
}

function replaceText(shape: OrderedXmlNode, text: string) {
  const shapeKey = elementKey(shape);
  const shapePrefix = shapeKey ? prefixOf(shapeKey) : 'p';
  const shapeChildren = children(shape);
  let textBody = findChild(shapeChildren, 'txBody');
  if (!textBody) {
    if (shapeKey && localName(shapeKey) !== 'sp') {
      throw new OoxmlPackageError('PPTX target shape cannot own editable text');
    }
    textBody = createElement(shapePrefix, 'txBody', [
      createElement('a', 'bodyPr'),
      createElement('a', 'lstStyle'),
    ]);
    shapeChildren.push(textBody);
  }
  const textChildren = children(textBody);
  const formatting = firstRunProperties(textChildren);
  for (let index = textChildren.length - 1; index >= 0; index--) {
    const key = elementKey(textChildren[index]);
    if (key && localName(key) === 'p') textChildren.splice(index, 1);
  }
  const lines = text.split('\n');
  for (const line of lines) {
    const runContent = [
      ...(formatting ? [structuredClone(formatting) as OrderedXmlNode] : []),
      textNode('a', line),
    ];
    textChildren.push(
      createElement('a', 'p', [createElement('a', 'r', runContent)])
    );
  }
  return lines.length;
}

function ensureTransform(shape: OrderedXmlNode) {
  const shapeKey = elementKey(shape);
  const shapeName = shapeKey ? localName(shapeKey) : '';
  const existing = findDescendant(children(shape), 'xfrm');
  if (existing) return existing;
  if (shapeName === 'graphicFrame') {
    const transform = createElement(prefixOf(shapeKey ?? 'p'), 'xfrm');
    children(shape).push(transform);
    return transform;
  }
  const propertyName = shapeName === 'grpSp' ? 'grpSpPr' : 'spPr';
  let properties = findChild(children(shape), propertyName);
  if (!properties) {
    properties = createElement(prefixOf(shapeKey ?? 'p'), propertyName);
    children(shape).push(properties);
  }
  const transform = createElement('a', 'xfrm');
  children(properties).unshift(transform);
  return transform;
}

function upsertTransformChild(
  transform: OrderedXmlNode,
  name: 'off' | 'ext',
  attrs: Record<string, string>
) {
  const transformChildren = children(transform);
  let node = findChild(transformChildren, name);
  if (!node) {
    node = createElement('a', name);
    const insertion =
      name === 'off' ? 0 : findChild(transformChildren, 'off') ? 1 : 0;
    transformChildren.splice(insertion, 0, node);
  }
  for (const [key, value] of Object.entries(attrs))
    setAttribute(node, key, value);
}

function replaceGeometry(
  shape: OrderedXmlNode,
  geometry: OfficePresentationSetShapeGeometryCommand['geometry']
) {
  const transform = ensureTransform(shape);
  setAttribute(
    transform,
    'rot',
    geometry.rotationDeg === undefined
      ? undefined
      : String(Math.round(geometry.rotationDeg * 60_000))
  );
  upsertTransformChild(transform, 'off', {
    x: String(Math.round(geometry.xPt * EMU_PER_POINT)),
    y: String(Math.round(geometry.yPt * EMU_PER_POINT)),
  });
  upsertTransformChild(transform, 'ext', {
    cx: String(Math.round(geometry.widthPt * EMU_PER_POINT)),
    cy: String(Math.round(geometry.heightPt * EMU_PER_POINT)),
  });
}

function findSemanticShape(
  shapes: readonly PptxShape[],
  id: string
): PptxShape | undefined {
  for (const shape of shapes) {
    if (shape.id === id) return shape;
    const nested = shape.children
      ? findSemanticShape(shape.children, id)
      : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function verifyResult(state: PptxSemanticState, command: PptxCommand) {
  const slide = state.slides.find(
    candidate => candidate.id === command.target.slideId
  );
  const shape = slide
    ? findSemanticShape(slide.shapes, command.target.shapeId)
    : undefined;
  if (!slide || !shape)
    throw new OoxmlPackageError(
      'PPTX command output is missing its target shape'
    );
  if (command.operation === 'office.presentation.shape.text.set') {
    if (shape.text !== command.text)
      throw new OoxmlPackageError('PPTX command output text does not match');
    return;
  }
  const actual = shape.geometry;
  const expected = command.geometry;
  const close = (left: number | undefined, right: number) =>
    left !== undefined && Math.abs(left - right) < 0.001;
  if (
    !actual ||
    !close(actual.xPt, expected.xPt) ||
    !close(actual.yPt, expected.yPt) ||
    !close(actual.widthPt, expected.widthPt) ||
    !close(actual.heightPt, expected.heightPt) ||
    (expected.rotationDeg !== undefined &&
      !close(actual.rotationDeg, expected.rotationDeg))
  ) {
    throw new OoxmlPackageError('PPTX command output geometry does not match');
  }
}

export function applyPptxCommand(
  pkg: OoxmlOpcPackage,
  input: OfficeCommand | unknown
): PptxCommandResult {
  const parsed = parseOfficeCommand(input);
  if (
    parsed.operation !== 'office.presentation.shape.text.set' &&
    parsed.operation !== 'office.presentation.shape.geometry.set'
  ) {
    if (parsed.operation.startsWith('office.presentation.')) {
      return applyPptxStructuralCommand(pkg, parsed as PptxStructuralCommand);
    }
    throw new OoxmlPackageError(
      `Expected a PPTX command, received ${parsed.operation}`
    );
  }
  const command = parsed as PptxCommand;
  const state = readPptxSemanticState(pkg);
  const slide = state.slides.find(
    candidate => candidate.id === command.target.slideId
  );
  if (!slide)
    throw new OoxmlPackageError(
      `PPTX slide not found: ${command.target.slideId}`
    );
  if (!findSemanticShape(slide.shapes, command.target.shapeId)) {
    throw new OoxmlPackageError(
      `PPTX shape not found: ${command.target.shapeId}`
    );
  }
  const xml = parsePreservedXml(
    pkg.requirePart(slide.part),
    slide.part,
    pkg.limits.maxXmlPartBytes
  );
  const shape = findShape(xml, command.target.shapeId);
  if (!shape)
    throw new OoxmlPackageError(
      'PPTX shape identity changed while resolving command'
    );
  const paragraphs =
    command.operation === 'office.presentation.shape.text.set'
      ? replaceText(shape, command.text)
      : undefined;
  if (command.operation === 'office.presentation.shape.geometry.set') {
    replaceGeometry(shape, command.geometry);
  }
  const slideBytes = buildPreservedXml(
    xml,
    slide.part,
    pkg.limits.maxXmlPartBytes
  );
  const packageBytes = pkg.write(new Map([[slide.part, slideBytes]]));
  const outputState = readPptxSemanticState(
    openPptxPackage(packageBytes, pkg.limits)
  );
  verifyResult(outputState, command);
  return {
    packageBytes,
    state: outputState,
    summary:
      command.operation === 'office.presentation.shape.text.set'
        ? {
            operation: command.operation,
            slideId: command.target.slideId,
            shapeId: command.target.shapeId,
            textLength: command.text.length,
            paragraphs: paragraphs ?? 0,
          }
        : {
            operation: command.operation,
            slideId: command.target.slideId,
            shapeId: command.target.shapeId,
            geometry: command.geometry,
          },
  };
}
