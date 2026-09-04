import type {
  OfficePresentationAddImageCommand,
  OfficePresentationAddShapeCommand,
  OfficePresentationAddSlideCommand,
  OfficePresentationDeleteShapeCommand,
  OfficePresentationDeleteSlideCommand,
  OfficePresentationDuplicateSlideCommand,
  OfficePresentationReorderSlidesCommand,
  OfficePresentationSetNotesCommand,
  OfficePresentationSetThemeColorCommand,
} from '../command';
import {
  relationshipPartName,
  sourcePartNameFromRelationshipPart,
} from '../docx/path';
import { relationshipTypeName } from '../docx/relationships';
import {
  buildPreservedXml,
  type OrderedXmlNode,
  parsePreservedXml,
} from '../docx/xml';
import {
  appendOoxmlRelationship,
  ensureOoxmlContentType,
  nextOoxmlPartName,
  nextOoxmlRelationshipId,
  type OoxmlOpcPackage,
  OoxmlPackageError,
  relativeOoxmlTarget,
  removeOoxmlContentTypeOverride,
  removeOoxmlRelationship,
} from '../ooxml';
import { openPptxPackage } from './package';
import {
  type PptxSemanticState,
  type PptxShape,
  type PptxSlide,
  readPptxSemanticState,
} from './semantic';

const EMU_PER_POINT = 12_700;
const SLIDE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const NOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml';
const SLIDE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const LAYOUT_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout';
const NOTES_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const NOTES_MASTER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster';
const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

export type PptxStructuralCommand =
  | OfficePresentationAddShapeCommand
  | OfficePresentationDeleteShapeCommand
  | OfficePresentationAddImageCommand
  | OfficePresentationAddSlideCommand
  | OfficePresentationDuplicateSlideCommand
  | OfficePresentationDeleteSlideCommand
  | OfficePresentationReorderSlidesCommand
  | OfficePresentationSetNotesCommand
  | OfficePresentationSetThemeColorCommand;

type PackageChanges = {
  replacements: Map<string, Uint8Array>;
  additions: Map<string, Uint8Array>;
  removals: Set<string>;
};

function changes(): PackageChanges {
  return {
    replacements: new Map(),
    additions: new Map(),
    removals: new Set(),
  };
}

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

function exactAttribute(node: OrderedXmlNode, name: string) {
  return attributes(node)[name];
}

function setAttribute(node: OrderedXmlNode, name: string, value?: string) {
  const attrs = { ...attributes(node) };
  const existing = Object.keys(attrs).find(key => key === name);
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
  return nodes.find(node => localName(elementKey(node) ?? '') === name);
}

function findDescendant(
  nodes: OrderedXmlNode[],
  name: string
): OrderedXmlNode | undefined {
  for (const node of nodes) {
    if (localName(elementKey(node) ?? '') === name) return node;
    const found = findDescendant(children(node), name);
    if (found) return found;
  }
  return undefined;
}

function requireRoot(nodes: OrderedXmlNode[], name: string, part: string) {
  const root = findChild(nodes, name);
  if (!root)
    throw new OoxmlPackageError(`PPTX ${name} root is invalid: ${part}`);
  return {
    root,
    prefix: prefixOf(elementKey(root) ?? ''),
    content: children(root),
  };
}

function ensureContainer(
  nodes: OrderedXmlNode[],
  prefix: string,
  name: string,
  before: readonly string[] = []
) {
  const existing = findChild(nodes, name);
  if (existing) return existing;
  const created = createElement(prefix, name);
  const index = nodes.findIndex(node =>
    before.includes(localName(elementKey(node) ?? ''))
  );
  nodes.splice(index === -1 ? nodes.length : index, 0, created);
  return created;
}

function writePart(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  part: string,
  bytes: Uint8Array
) {
  if (pkg.hasPart(part)) output.replacements.set(part, bytes);
  else output.additions.set(part, bytes);
}

function currentPart(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  part: string
) {
  return (
    output.replacements.get(part) ??
    output.additions.get(part) ??
    pkg.readPart(part)
  );
}

function ensureContentType(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  input:
    | { kind: 'default'; extension: string; contentType: string }
    | { kind: 'override'; partName: string; contentType: string }
) {
  output.replacements.set(
    '[Content_Types].xml',
    ensureOoxmlContentType(
      currentPart(pkg, output, '[Content_Types].xml') ??
        pkg.requirePart('[Content_Types].xml'),
      input,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function removeContentType(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  part: string
) {
  output.replacements.set(
    '[Content_Types].xml',
    removeOoxmlContentTypeOverride(
      currentPart(pkg, output, '[Content_Types].xml') ??
        pkg.requirePart('[Content_Types].xml'),
      part,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function appendRelationship(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  sourcePart: string,
  relationship: { id: string; type: string; target: string }
) {
  const part = relationshipPartName(sourcePart);
  writePart(
    pkg,
    output,
    part,
    appendOoxmlRelationship(
      currentPart(pkg, output, part),
      part,
      relationship,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function deleteRelationship(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  sourcePart: string,
  relationshipId: string
) {
  const part = relationshipPartName(sourcePart);
  const bytes = currentPart(pkg, output, part);
  if (!bytes)
    throw new OoxmlPackageError(`PPTX relationship part is missing: ${part}`);
  writePart(
    pkg,
    output,
    part,
    removeOoxmlRelationship(
      bytes,
      part,
      relationshipId,
      pkg.limits.maxXmlPartBytes
    )
  );
}

function requireSlide(state: PptxSemanticState, slideId: string) {
  const slide = state.slides.find(candidate => candidate.id === slideId);
  if (!slide) throw new OoxmlPackageError(`PPTX slide not found: ${slideId}`);
  return slide;
}

function slideXml(pkg: OoxmlOpcPackage, slide: PptxSlide) {
  const xml = parsePreservedXml(
    pkg.requirePart(slide.part),
    slide.part,
    pkg.limits.maxXmlPartBytes
  );
  const root = requireRoot(xml, 'sld', slide.part);
  const common = findChild(root.content, 'cSld');
  const tree = common ? findChild(children(common), 'spTree') : undefined;
  if (!tree)
    throw new OoxmlPackageError(`PPTX slide has no shape tree: ${slide.part}`);
  return { xml, root, tree, shapes: children(tree) };
}

function flattenShapes(shapes: readonly PptxShape[]): PptxShape[] {
  return shapes.flatMap(shape => [
    shape,
    ...flattenShapes(shape.children ?? []),
  ]);
}

function nextShapeId(slide: PptxSlide) {
  return String(
    Math.max(
      1,
      ...flattenShapes(slide.shapes).map(shape => Number(shape.id) || 0)
    ) + 1
  );
}

function transform(geometry: OfficePresentationAddShapeCommand['geometry']) {
  return createElement(
    'a',
    'xfrm',
    [
      createElement('a', 'off', [], {
        x: String(Math.round(geometry.xPt * EMU_PER_POINT)),
        y: String(Math.round(geometry.yPt * EMU_PER_POINT)),
      }),
      createElement('a', 'ext', [], {
        cx: String(Math.round(geometry.widthPt * EMU_PER_POINT)),
        cy: String(Math.round(geometry.heightPt * EMU_PER_POINT)),
      }),
    ],
    geometry.rotationDeg === undefined
      ? undefined
      : { rot: String(Math.round(geometry.rotationDeg * 60_000)) }
  );
}

function solidFill(color: string) {
  return createElement('a', 'solidFill', [
    createElement('a', 'srgbClr', [], { val: color.slice(1).toUpperCase() }),
  ]);
}

function textBody(text: string) {
  return createElement('p', 'txBody', [
    createElement('a', 'bodyPr'),
    createElement('a', 'lstStyle'),
    ...text
      .split('\n')
      .map(line =>
        createElement('a', 'p', [
          createElement('a', 'r', [
            createElement('a', 't', [{ '#text': line }]),
          ]),
        ])
      ),
  ]);
}

function createShapeNode(
  id: string,
  command: OfficePresentationAddShapeCommand
) {
  const preset = {
    rectangle: 'rect',
    roundedRectangle: 'roundRect',
    ellipse: 'ellipse',
    line: 'line',
  }[command.shape];
  return createElement('p', 'sp', [
    createElement('p', 'nvSpPr', [
      createElement('p', 'cNvPr', [], { id, name: `Shape ${id}` }),
      createElement('p', 'cNvSpPr'),
      createElement('p', 'nvPr'),
    ]),
    createElement('p', 'spPr', [
      transform(command.geometry),
      createElement('a', 'prstGeom', [createElement('a', 'avLst')], {
        prst: preset,
      }),
      ...(command.fillColor ? [solidFill(command.fillColor)] : []),
      ...(command.lineColor
        ? [createElement('a', 'ln', [solidFill(command.lineColor)])]
        : []),
    ]),
    ...(command.text !== undefined ? [textBody(command.text)] : []),
  ]);
}

function addShape(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationAddShapeCommand,
  output: PackageChanges
) {
  const slide = requireSlide(state, command.slideId);
  const parsed = slideXml(pkg, slide);
  const shapeId = nextShapeId(slide);
  parsed.shapes.push(createShapeNode(shapeId, command));
  writePart(
    pkg,
    output,
    slide.part,
    buildPreservedXml(parsed.xml, slide.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    slideId: slide.id,
    shapeId,
    shape: command.shape,
    textLength: command.text?.length ?? 0,
  };
}

function decodeBase64(value: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new OoxmlPackageError('PPTX image payload is not valid base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function assertImage(bytes: Uint8Array, mimeType: string) {
  const valid =
    mimeType === 'image/png'
      ? bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
      : mimeType === 'image/jpeg'
        ? bytes.length >= 3 &&
          bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes[2] === 0xff
        : bytes.length >= 6 &&
          ['GIF87a', 'GIF89a'].includes(
            new TextDecoder('ascii').decode(bytes.slice(0, 6))
          );
  if (!valid)
    throw new OoxmlPackageError(
      'PPTX image bytes do not match their MIME type'
    );
}

function addImage(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationAddImageCommand,
  output: PackageChanges
) {
  const slide = requireSlide(state, command.slideId);
  const parsed = slideXml(pkg, slide);
  const bytes = decodeBase64(command.dataBase64);
  assertImage(bytes, command.mimeType);
  const extension =
    command.mimeType === 'image/png'
      ? 'png'
      : command.mimeType === 'image/jpeg'
        ? 'jpg'
        : 'gif';
  const part = nextOoxmlPartName(
    pkg.listParts().map(item => item.path),
    'ppt/media',
    'image',
    extension
  );
  const relationshipId = nextOoxmlRelationshipId(
    pkg.getRelationships(slide.part)
  );
  appendRelationship(pkg, output, slide.part, {
    id: relationshipId,
    type: IMAGE_RELATIONSHIP,
    target: relativeOoxmlTarget(slide.part, part),
  });
  ensureContentType(pkg, output, {
    kind: 'default',
    extension,
    contentType: command.mimeType,
  });
  output.additions.set(part, bytes);
  const shapeId = nextShapeId(slide);
  parsed.shapes.push(
    createElement('p', 'pic', [
      createElement('p', 'nvPicPr', [
        createElement('p', 'cNvPr', [], {
          id: shapeId,
          name: command.name ?? `Picture ${shapeId}`,
          ...(command.description ? { descr: command.description } : {}),
        }),
        createElement('p', 'cNvPicPr', [
          createElement('a', 'picLocks', [], { noChangeAspect: '1' }),
        ]),
        createElement('p', 'nvPr'),
      ]),
      createElement('p', 'blipFill', [
        createElement('a', 'blip', [], { 'r:embed': relationshipId }),
        createElement('a', 'stretch', [createElement('a', 'fillRect')]),
      ]),
      createElement('p', 'spPr', [
        transform(command.geometry),
        createElement('a', 'prstGeom', [createElement('a', 'avLst')], {
          prst: 'rect',
        }),
      ]),
    ])
  );
  writePart(
    pkg,
    output,
    slide.part,
    buildPreservedXml(parsed.xml, slide.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    slideId: slide.id,
    shapeId,
    imagePart: part,
    byteSize: bytes.byteLength,
  };
}

function findShapeParent(
  nodes: OrderedXmlNode[],
  shapeId: string
):
  | { nodes: OrderedXmlNode[]; index: number; node: OrderedXmlNode }
  | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const name = localName(elementKey(node) ?? '');
    if (['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].includes(name)) {
      const nonVisual = findDescendant(children(node), 'cNvPr');
      if (nonVisual && attribute(nonVisual, 'id') === shapeId) {
        return { nodes, index, node };
      }
    }
    const nested = findShapeParent(children(node), shapeId);
    if (nested) return nested;
  }
  return undefined;
}

function relationshipIds(node: OrderedXmlNode, output = new Set<string>()) {
  for (const [key, value] of Object.entries(attributes(node))) {
    if (
      ['embed', 'link', 'id'].includes(localName(key)) &&
      /^rId|^rel/i.test(value)
    ) {
      output.add(value);
    }
  }
  for (const child of children(node)) relationshipIds(child, output);
  return [...output];
}

function internalReferenceCount(
  pkg: OoxmlOpcPackage,
  targetPart: string,
  excludedSource: string,
  excludedId: string
) {
  let count = 0;
  for (const part of pkg.listParts()) {
    if (!part.path.endsWith('.rels')) continue;
    const source = sourcePartNameFromRelationshipPart(part.path);
    for (const relationship of pkg.getRelationships(source)) {
      if (
        relationship.resolvedTarget === targetPart &&
        !(source === excludedSource && relationship.id === excludedId)
      ) {
        count++;
      }
    }
  }
  return count;
}

function deleteShape(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationDeleteShapeCommand,
  output: PackageChanges
) {
  const slide = requireSlide(state, command.target.slideId);
  const parsed = slideXml(pkg, slide);
  const found = findShapeParent(parsed.shapes, command.target.shapeId);
  if (!found)
    throw new OoxmlPackageError(
      `PPTX shape not found: ${command.target.shapeId}`
    );
  const slideRelationships = new Map(
    pkg
      .getRelationships(slide.part)
      .map(relationship => [relationship.id, relationship])
  );
  for (const relationshipId of relationshipIds(found.node)) {
    const relationship = slideRelationships.get(relationshipId);
    if (!relationship || relationshipTypeName(relationship.type) !== 'image') {
      continue;
    }
    deleteRelationship(pkg, output, slide.part, relationshipId);
    if (
      relationship.resolvedTarget &&
      internalReferenceCount(
        pkg,
        relationship.resolvedTarget,
        slide.part,
        relationshipId
      ) === 0
    ) {
      output.removals.add(relationship.resolvedTarget);
    }
  }
  found.nodes.splice(found.index, 1);
  writePart(
    pkg,
    output,
    slide.part,
    buildPreservedXml(parsed.xml, slide.part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    slideId: slide.id,
    shapeId: command.target.shapeId,
  };
}

function presentationXml(pkg: OoxmlOpcPackage) {
  const xml = parsePreservedXml(
    pkg.requirePart(pkg.mainPart),
    pkg.mainPart,
    pkg.limits.maxXmlPartBytes
  );
  const root = requireRoot(xml, 'presentation', pkg.mainPart);
  const list = ensureContainer(root.content, root.prefix, 'sldIdLst', [
    'sldSz',
    'notesSz',
  ]);
  return { xml, root, list, slides: children(list) };
}

function slideRelationshipId(node: OrderedXmlNode) {
  return exactAttribute(node, 'r:id') ?? attribute(node, 'id');
}

function numericSlideId(node: OrderedXmlNode) {
  return Number(exactAttribute(node, 'id')) || 0;
}

function emptyShapeTree(title?: string) {
  return createElement('p', 'spTree', [
    createElement('p', 'nvGrpSpPr', [
      createElement('p', 'cNvPr', [], { id: '1', name: '' }),
      createElement('p', 'cNvGrpSpPr'),
      createElement('p', 'nvPr'),
    ]),
    createElement('p', 'grpSpPr', [
      createElement('a', 'xfrm', [
        createElement('a', 'off', [], { x: '0', y: '0' }),
        createElement('a', 'ext', [], { cx: '0', cy: '0' }),
        createElement('a', 'chOff', [], { x: '0', y: '0' }),
        createElement('a', 'chExt', [], { cx: '0', cy: '0' }),
      ]),
    ]),
    ...(title
      ? [
          createElement('p', 'sp', [
            createElement('p', 'nvSpPr', [
              createElement('p', 'cNvPr', [], { id: '2', name: 'Title' }),
              createElement('p', 'cNvSpPr'),
              createElement('p', 'nvPr'),
            ]),
            createElement('p', 'spPr', [
              transform({
                xPt: 54,
                yPt: 40,
                widthPt: 852,
                heightPt: 72,
              }),
              createElement('a', 'prstGeom', [createElement('a', 'avLst')], {
                prst: 'rect',
              }),
              createElement('a', 'noFill'),
            ]),
            textBody(title),
          ]),
        ]
      : []),
  ]);
}

function buildSlidePart(
  part: string,
  title: string | undefined,
  maxBytes: number
) {
  return buildPreservedXml(
    [
      createElement(
        'p',
        'sld',
        [
          createElement('p', 'cSld', [emptyShapeTree(title)]),
          createElement('p', 'clrMapOvr', [
            createElement('a', 'masterClrMapping'),
          ]),
        ],
        {
          'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
          'xmlns:r':
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'xmlns:p':
            'http://schemas.openxmlformats.org/presentationml/2006/main',
        }
      ),
    ],
    part,
    maxBytes
  );
}

function insertSlideNode(
  presentation: ReturnType<typeof presentationXml>,
  state: PptxSemanticState,
  relationshipId: string,
  afterSlideId?: string
) {
  const numericId = String(
    Math.max(255, ...presentation.slides.map(numericSlideId)) + 1
  );
  const node = createElement(presentation.root.prefix, 'sldId', [], {
    id: numericId,
    'r:id': relationshipId,
  });
  const afterIndex = afterSlideId
    ? state.slides.findIndex(slide => slide.id === afterSlideId)
    : state.slides.length - 1;
  if (afterSlideId && afterIndex === -1) {
    throw new OoxmlPackageError(`PPTX slide not found: ${afterSlideId}`);
  }
  presentation.slides.splice(afterIndex + 1, 0, node);
  return numericId;
}

function addSlide(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationAddSlideCommand,
  output: PackageChanges
) {
  const presentation = presentationXml(pkg);
  const relationshipId = nextOoxmlRelationshipId(
    pkg.getRelationships(pkg.mainPart)
  );
  const part = nextOoxmlPartName(
    pkg.listParts().map(item => item.path),
    'ppt/slides',
    'slide',
    'xml'
  );
  insertSlideNode(presentation, state, relationshipId, command.afterSlideId);
  appendRelationship(pkg, output, pkg.mainPart, {
    id: relationshipId,
    type: SLIDE_RELATIONSHIP,
    target: relativeOoxmlTarget(pkg.mainPart, part),
  });
  const layoutPart =
    state.slides.find(slide => slide.id === command.afterSlideId)?.layoutPart ??
    state.slides[0]?.layoutPart ??
    state.masters[0]?.layoutParts[0];
  if (layoutPart) {
    appendRelationship(pkg, output, part, {
      id: 'rId1',
      type: LAYOUT_RELATIONSHIP,
      target: relativeOoxmlTarget(part, layoutPart),
    });
  }
  ensureContentType(pkg, output, {
    kind: 'override',
    partName: part,
    contentType: SLIDE_CONTENT_TYPE,
  });
  output.additions.set(
    part,
    buildSlidePart(part, command.title, pkg.limits.maxXmlPartBytes)
  );
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(
      presentation.xml,
      pkg.mainPart,
      pkg.limits.maxXmlPartBytes
    )
  );
  return {
    operation: command.operation,
    slideId: relationshipId,
    part,
    titleLength: command.title?.length ?? 0,
  };
}

function rewriteNotesBackReference(
  pkg: OoxmlOpcPackage,
  bytes: Uint8Array,
  relationshipPart: string,
  newSlidePart: string
) {
  const xml = parsePreservedXml(
    bytes,
    relationshipPart,
    pkg.limits.maxXmlPartBytes
  );
  const root = requireRoot(xml, 'Relationships', relationshipPart);
  for (const node of root.content) {
    if (relationshipTypeName(exactAttribute(node, 'Type') ?? '') === 'slide') {
      setAttribute(
        node,
        'Target',
        relativeOoxmlTarget(
          sourcePartNameFromRelationshipPart(relationshipPart) ?? '',
          newSlidePart
        )
      );
    }
  }
  return buildPreservedXml(xml, relationshipPart, pkg.limits.maxXmlPartBytes);
}

function duplicateSlide(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationDuplicateSlideCommand,
  output: PackageChanges
) {
  const source = requireSlide(state, command.slideId);
  const presentation = presentationXml(pkg);
  const relationshipId = nextOoxmlRelationshipId(
    pkg.getRelationships(pkg.mainPart)
  );
  const part = nextOoxmlPartName(
    pkg.listParts().map(item => item.path),
    'ppt/slides',
    'slide',
    'xml'
  );
  insertSlideNode(presentation, state, relationshipId, source.id);
  appendRelationship(pkg, output, pkg.mainPart, {
    id: relationshipId,
    type: SLIDE_RELATIONSHIP,
    target: relativeOoxmlTarget(pkg.mainPart, part),
  });
  ensureContentType(pkg, output, {
    kind: 'override',
    partName: part,
    contentType: SLIDE_CONTENT_TYPE,
  });
  output.additions.set(part, pkg.requirePart(source.part));
  const sourceRelationshipPart = relationshipPartName(source.part);
  if (pkg.hasPart(sourceRelationshipPart)) {
    const relationshipXml = parsePreservedXml(
      pkg.requirePart(sourceRelationshipPart),
      sourceRelationshipPart,
      pkg.limits.maxXmlPartBytes
    );
    const root = requireRoot(
      relationshipXml,
      'Relationships',
      sourceRelationshipPart
    );
    const relationships = new Map(
      pkg.getRelationships(source.part).map(item => [item.id, item])
    );
    for (let index = root.content.length - 1; index >= 0; index--) {
      const node = root.content[index];
      const id = exactAttribute(node, 'Id');
      const relationship = id ? relationships.get(id) : undefined;
      const type = relationship
        ? relationshipTypeName(relationship.type)
        : relationshipTypeName(exactAttribute(node, 'Type') ?? '');
      if (type === 'comments' || type === 'commentAuthors') {
        root.content.splice(index, 1);
        continue;
      }
      if (type !== 'notesSlide' || !relationship?.resolvedTarget) continue;
      const notesPart = nextOoxmlPartName(
        [...pkg.listParts().map(item => item.path), ...output.additions.keys()],
        'ppt/notesSlides',
        'notesSlide',
        'xml'
      );
      output.additions.set(
        notesPart,
        pkg.requirePart(relationship.resolvedTarget)
      );
      ensureContentType(pkg, output, {
        kind: 'override',
        partName: notesPart,
        contentType: NOTES_CONTENT_TYPE,
      });
      setAttribute(node, 'Target', relativeOoxmlTarget(part, notesPart));
      const oldNotesRelationshipPart = relationshipPartName(
        relationship.resolvedTarget
      );
      if (pkg.hasPart(oldNotesRelationshipPart)) {
        const notesRelationshipPart = relationshipPartName(notesPart);
        output.additions.set(
          notesRelationshipPart,
          rewriteNotesBackReference(
            pkg,
            pkg.requirePart(oldNotesRelationshipPart),
            notesRelationshipPart,
            part
          )
        );
      }
    }
    const newRelationshipPart = relationshipPartName(part);
    output.additions.set(
      newRelationshipPart,
      buildPreservedXml(
        relationshipXml,
        newRelationshipPart,
        pkg.limits.maxXmlPartBytes
      )
    );
  }
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(
      presentation.xml,
      pkg.mainPart,
      pkg.limits.maxXmlPartBytes
    )
  );
  return {
    operation: command.operation,
    sourceSlideId: source.id,
    slideId: relationshipId,
    part,
  };
}

function removeOwnedPart(
  pkg: OoxmlOpcPackage,
  output: PackageChanges,
  part: string
) {
  if (!pkg.hasPart(part) || output.removals.has(part)) return;
  output.removals.add(part);
  removeContentType(pkg, output, part);
  const relationshipPart = relationshipPartName(part);
  if (pkg.hasPart(relationshipPart)) output.removals.add(relationshipPart);
}

function deleteSlide(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationDeleteSlideCommand,
  output: PackageChanges
) {
  if (state.slides.length === 1) {
    throw new OoxmlPackageError('PPTX cannot delete its final slide');
  }
  const slide = requireSlide(state, command.slideId);
  const presentation = presentationXml(pkg);
  const index = presentation.slides.findIndex(
    node => slideRelationshipId(node) === slide.relationshipId
  );
  if (index === -1) throw new OoxmlPackageError('PPTX slide identity changed');
  presentation.slides.splice(index, 1);
  deleteRelationship(pkg, output, pkg.mainPart, slide.relationshipId);
  for (const relationship of pkg.getRelationships(slide.part)) {
    if (!relationship.resolvedTarget) continue;
    const type = relationshipTypeName(relationship.type);
    if (type === 'notesSlide' || type === 'comments') {
      removeOwnedPart(pkg, output, relationship.resolvedTarget);
    } else if (
      type === 'image' &&
      internalReferenceCount(
        pkg,
        relationship.resolvedTarget,
        slide.part,
        relationship.id
      ) === 0
    ) {
      output.removals.add(relationship.resolvedTarget);
    }
  }
  output.removals.add(slide.part);
  const slideRelationshipPart = relationshipPartName(slide.part);
  if (pkg.hasPart(slideRelationshipPart))
    output.removals.add(slideRelationshipPart);
  removeContentType(pkg, output, slide.part);
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(
      presentation.xml,
      pkg.mainPart,
      pkg.limits.maxXmlPartBytes
    )
  );
  return { operation: command.operation, slideId: slide.id, part: slide.part };
}

function reorderSlides(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationReorderSlidesCommand,
  output: PackageChanges
) {
  if (
    command.slideIds.length !== state.slides.length ||
    new Set(command.slideIds).size !== state.slides.length ||
    command.slideIds.some(id => !state.slides.some(slide => slide.id === id))
  ) {
    throw new OoxmlPackageError(
      'PPTX slide order must contain every slide exactly once'
    );
  }
  const presentation = presentationXml(pkg);
  const byId = new Map(
    presentation.slides.map(node => [slideRelationshipId(node), node])
  );
  const ordered = command.slideIds.map(id => byId.get(id));
  if (ordered.some(node => !node))
    throw new OoxmlPackageError('PPTX slide identity changed');
  presentation.slides.splice(
    0,
    presentation.slides.length,
    ...(ordered as OrderedXmlNode[])
  );
  output.replacements.set(
    pkg.mainPart,
    buildPreservedXml(
      presentation.xml,
      pkg.mainPart,
      pkg.limits.maxXmlPartBytes
    )
  );
  return { operation: command.operation, slideIds: command.slideIds };
}

function replaceShapeText(shape: OrderedXmlNode, text: string) {
  const shapeChildren = children(shape);
  let body = findChild(shapeChildren, 'txBody');
  if (!body) {
    body = textBody(text);
    shapeChildren.push(body);
    return;
  }
  const bodyChildren = children(body);
  for (let index = bodyChildren.length - 1; index >= 0; index--) {
    if (localName(elementKey(bodyChildren[index]) ?? '') === 'p') {
      bodyChildren.splice(index, 1);
    }
  }
  bodyChildren.push(
    ...children(textBody(text)).filter(
      node => localName(elementKey(node) ?? '') === 'p'
    )
  );
}

function notesBodyShape(shapes: OrderedXmlNode[]) {
  return shapes.find(node => {
    if (localName(elementKey(node) ?? '') !== 'sp') return false;
    const placeholder = findDescendant(children(node), 'ph');
    return attribute(placeholder ?? {}, 'type') === 'body';
  });
}

function buildNotesPart(part: string, text: string, maxBytes: number) {
  const bodyShape = createElement('p', 'sp', [
    createElement('p', 'nvSpPr', [
      createElement('p', 'cNvPr', [], { id: '2', name: 'Notes Placeholder' }),
      createElement('p', 'cNvSpPr'),
      createElement('p', 'nvPr', [
        createElement('p', 'ph', [], { type: 'body', idx: '1' }),
      ]),
    ]),
    createElement('p', 'spPr'),
    textBody(text),
  ]);
  return buildPreservedXml(
    [
      createElement(
        'p',
        'notes',
        [
          createElement('p', 'cSld', [
            createElement('p', 'spTree', [
              createElement('p', 'nvGrpSpPr', [
                createElement('p', 'cNvPr', [], { id: '1', name: '' }),
                createElement('p', 'cNvGrpSpPr'),
                createElement('p', 'nvPr'),
              ]),
              createElement('p', 'grpSpPr', [
                createElement('a', 'xfrm', [
                  createElement('a', 'off', [], { x: '0', y: '0' }),
                  createElement('a', 'ext', [], { cx: '0', cy: '0' }),
                  createElement('a', 'chOff', [], { x: '0', y: '0' }),
                  createElement('a', 'chExt', [], { cx: '0', cy: '0' }),
                ]),
              ]),
              bodyShape,
            ]),
          ]),
          createElement('p', 'clrMapOvr', [
            createElement('a', 'masterClrMapping'),
          ]),
        ],
        {
          'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
          'xmlns:r':
            'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
          'xmlns:p':
            'http://schemas.openxmlformats.org/presentationml/2006/main',
        }
      ),
    ],
    part,
    maxBytes
  );
}

function setNotes(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationSetNotesCommand,
  output: PackageChanges
) {
  const slide = requireSlide(state, command.slideId);
  let part = slide.notesPart;
  if (part) {
    const xml = parsePreservedXml(
      pkg.requirePart(part),
      part,
      pkg.limits.maxXmlPartBytes
    );
    const root = requireRoot(xml, 'notes', part);
    const tree = findDescendant(root.content, 'spTree');
    if (!tree)
      throw new OoxmlPackageError(`PPTX notes have no shape tree: ${part}`);
    let shape = notesBodyShape(children(tree));
    if (!shape) {
      shape = createElement('p', 'sp', [
        createElement('p', 'nvSpPr', [
          createElement('p', 'cNvPr', [], {
            id: '2',
            name: 'Notes Placeholder',
          }),
          createElement('p', 'cNvSpPr'),
          createElement('p', 'nvPr', [
            createElement('p', 'ph', [], { type: 'body' }),
          ]),
        ]),
        createElement('p', 'spPr'),
      ]);
      children(tree).push(shape);
    }
    replaceShapeText(shape, command.text);
    writePart(
      pkg,
      output,
      part,
      buildPreservedXml(xml, part, pkg.limits.maxXmlPartBytes)
    );
  } else {
    part = nextOoxmlPartName(
      pkg.listParts().map(item => item.path),
      'ppt/notesSlides',
      'notesSlide',
      'xml'
    );
    const slideRelationshipId = nextOoxmlRelationshipId(
      pkg.getRelationships(slide.part)
    );
    appendRelationship(pkg, output, slide.part, {
      id: slideRelationshipId,
      type: NOTES_RELATIONSHIP,
      target: relativeOoxmlTarget(slide.part, part),
    });
    appendRelationship(pkg, output, part, {
      id: 'rId1',
      type: SLIDE_RELATIONSHIP,
      target: relativeOoxmlTarget(part, slide.part),
    });
    const notesMaster = pkg
      .getRelationships(pkg.mainPart)
      .find(
        item => relationshipTypeName(item.type) === 'notesMaster'
      )?.resolvedTarget;
    if (notesMaster) {
      appendRelationship(pkg, output, part, {
        id: 'rId2',
        type: NOTES_MASTER_RELATIONSHIP,
        target: relativeOoxmlTarget(part, notesMaster),
      });
    }
    ensureContentType(pkg, output, {
      kind: 'override',
      partName: part,
      contentType: NOTES_CONTENT_TYPE,
    });
    output.additions.set(
      part,
      buildNotesPart(part, command.text, pkg.limits.maxXmlPartBytes)
    );
  }
  return {
    operation: command.operation,
    slideId: slide.id,
    notesPart: part,
    textLength: command.text.length,
  };
}

function setThemeColor(
  pkg: OoxmlOpcPackage,
  state: PptxSemanticState,
  command: OfficePresentationSetThemeColorCommand,
  output: PackageChanges
) {
  const master = state.masters.find(item => item.id === command.masterId);
  if (!master?.themePart) {
    throw new OoxmlPackageError(
      `PPTX master theme not found: ${command.masterId}`
    );
  }
  const part = master.themePart;
  const xml = parsePreservedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const root = requireRoot(xml, 'theme', part);
  const themeElements = ensureContainer(
    root.content,
    root.prefix,
    'themeElements'
  );
  const scheme = ensureContainer(
    children(themeElements),
    root.prefix,
    'clrScheme'
  );
  setAttribute(scheme, 'name', exactAttribute(scheme, 'name') ?? 'LocalMind');
  let slot = findChild(children(scheme), command.slot);
  if (!slot) {
    slot = createElement(root.prefix, command.slot);
    children(scheme).push(slot);
  }
  children(slot).splice(
    0,
    children(slot).length,
    createElement(root.prefix, 'srgbClr', [], {
      val: command.color.slice(1).toUpperCase(),
    })
  );
  writePart(
    pkg,
    output,
    part,
    buildPreservedXml(xml, part, pkg.limits.maxXmlPartBytes)
  );
  return {
    operation: command.operation,
    masterId: master.id,
    slot: command.slot,
    color: command.color,
  };
}

export function applyPptxStructuralCommand(
  pkg: OoxmlOpcPackage,
  command: PptxStructuralCommand
) {
  const state = readPptxSemanticState(pkg);
  const output = changes();
  const summary = (() => {
    switch (command.operation) {
      case 'office.presentation.shape.add':
        return addShape(pkg, state, command, output);
      case 'office.presentation.shape.delete':
        return deleteShape(pkg, state, command, output);
      case 'office.presentation.image.add':
        return addImage(pkg, state, command, output);
      case 'office.presentation.slide.add':
        return addSlide(pkg, state, command, output);
      case 'office.presentation.slide.duplicate':
        return duplicateSlide(pkg, state, command, output);
      case 'office.presentation.slide.delete':
        return deleteSlide(pkg, state, command, output);
      case 'office.presentation.slides.reorder':
        return reorderSlides(pkg, state, command, output);
      case 'office.presentation.notes.text.set':
        return setNotes(pkg, state, command, output);
      case 'office.presentation.theme.color.set':
        return setThemeColor(pkg, state, command, output);
    }
  })();
  const packageBytes = pkg.write(output.replacements, {
    additions: output.additions,
    removals: output.removals,
  });
  const next = readPptxSemanticState(openPptxPackage(packageBytes, pkg.limits));
  return { packageBytes, state: next, summary };
}
