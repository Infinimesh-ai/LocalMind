import { sourcePartNameFromRelationshipPart } from '../docx/path';
import { relationshipTypeName } from '../docx/relationships';
import {
  findChildElement,
  findFirstElement,
  getAttribute,
  getElementChildren,
  getTextContent,
  type OrderedXmlNode,
  parseOrderedXml,
} from '../docx/xml';
import { type OoxmlOpcPackage, OoxmlPackageError } from '../ooxml';

export const PPTX_SEMANTIC_STATE_VERSION = 'localmind-office-pptx-state/v1';
export const PPTX_MODEL_VERSION = 'localmind-office-pptx-model/v1';

const EMU_PER_POINT = 12_700;

export type PptxGeometry = {
  xPt?: number;
  yPt?: number;
  widthPt?: number;
  heightPt?: number;
  rotationDeg?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  preset?: string;
};

export type PptxTextRun = {
  text: string;
  fontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
};

export type PptxTextParagraph = {
  alignment?: string;
  level?: number;
  runs: PptxTextRun[];
  text: string;
};

export type PptxShape = {
  id: string;
  type:
    | 'shape'
    | 'picture'
    | 'graphicFrame'
    | 'connector'
    | 'group'
    | 'unknown';
  name?: string;
  description?: string;
  hidden?: boolean;
  placeholder?: { type?: string; index?: number };
  geometry?: PptxGeometry;
  text?: string;
  paragraphs?: PptxTextParagraph[];
  relationshipIds: string[];
  image?: {
    relationshipId: string;
    part: string;
    contentType?: string;
  };
  children?: PptxShape[];
};

export type PptxSlide = {
  id: string;
  relationshipId: string;
  part: string;
  name: string;
  hidden?: boolean;
  layoutPart?: string;
  notesPart?: string;
  notesText?: string;
  hasTiming?: boolean;
  commentParts: string[];
  shapes: PptxShape[];
};

export type PptxMaster = {
  id: string;
  relationshipId: string;
  part: string;
  themePart?: string;
  themeColors: Partial<Record<PptxThemeColorSlot, string>>;
  layoutParts: string[];
  shapes: PptxShape[];
};

export type PptxThemeColorSlot =
  | 'dk1'
  | 'lt1'
  | 'dk2'
  | 'lt2'
  | 'accent1'
  | 'accent2'
  | 'accent3'
  | 'accent4'
  | 'accent5'
  | 'accent6'
  | 'hlink'
  | 'folHlink';

export type PptxSemanticState = {
  schemaVersion: typeof PPTX_SEMANTIC_STATE_VERSION;
  modelVersion: typeof PPTX_MODEL_VERSION;
  presentationPart: string;
  slideSize: { widthPt: number; heightPt: number; type?: string };
  notesSize?: { widthPt: number; heightPt: number };
  slides: PptxSlide[];
  masters: PptxMaster[];
  package: {
    parts: Array<{
      path: string;
      contentType?: string;
      byteSize: number;
      handling: 'semantic' | 'opaque';
    }>;
    opaqueParts: string[];
    externalRelationships: Array<{
      sourcePart: string | null;
      id: string;
      type: string;
      target: string;
    }>;
  };
  compatibility: {
    animationParts: string[];
    animatedSlideIds: string[];
    unsupportedShapeElements: string[];
  };
  stats: {
    slides: number;
    masters: number;
    shapes: number;
    textCharacters: number;
    packageParts: number;
    opaqueParts: number;
  };
};

export type PptxSemanticLimits = {
  maxSlides: number;
  maxShapes: number;
  maxTextCharacters: number;
  maxRelationships: number;
};

export const DEFAULT_PPTX_SEMANTIC_LIMITS: Readonly<PptxSemanticLimits> = {
  maxSlides: 10_000,
  maxShapes: 1_000_000,
  maxTextCharacters: 128 * 1024 * 1024,
  maxRelationships: 1_000_000,
};

function child(nodes: OrderedXmlNode[], name: string) {
  return findChildElement(nodes, name);
}

function children(node: OrderedXmlNode | undefined, name: string) {
  return node ? getElementChildren(node, name) : [];
}

function parseNumber(value: string | undefined) {
  if (value === undefined || value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseInteger(value: string | undefined) {
  const number = parseNumber(value);
  return number !== undefined && Number.isSafeInteger(number)
    ? number
    : undefined;
}

function parseBoolean(value: string | undefined) {
  if (value === undefined) return undefined;
  return !['0', 'false', 'off'].includes(value.toLowerCase());
}

function emuToPoints(value: string | undefined) {
  const emu = parseNumber(value);
  return emu === undefined ? undefined : emu / EMU_PER_POINT;
}

function color(nodes: OrderedXmlNode[]) {
  const rgb = child(nodes, 'srgbClr');
  const value = getAttribute(rgb ?? {}, 'val');
  return value && /^[0-9A-F]{6}$/i.test(value)
    ? `#${value.toUpperCase()}`
    : undefined;
}

function descendantText(nodes: OrderedXmlNode[]): string {
  let text = getTextContent(nodes);
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      text += descendantText(value as OrderedXmlNode[]);
    }
  }
  return text;
}

function parseRun(node: OrderedXmlNode): PptxTextRun {
  const content = children(
    node,
    Object.keys(node).find(key => !key.startsWith(':')) ?? 'r'
  );
  const properties = child(content, 'rPr');
  const propertyNodes = children(properties, 'rPr');
  const latin = child(propertyNodes, 'latin');
  return {
    text: descendantText(children(child(content, 't'), 't')),
    fontFamily: getAttribute(latin ?? {}, 'typeface'),
    fontSizePt: (() => {
      const value = parseInteger(getAttribute(properties ?? {}, 'sz'));
      return value === undefined ? undefined : value / 100;
    })(),
    bold: parseBoolean(getAttribute(properties ?? {}, 'b')),
    italic: parseBoolean(getAttribute(properties ?? {}, 'i')),
    color: color(children(child(propertyNodes, 'solidFill'), 'solidFill')),
  };
}

function parseTextBody(shapeNodes: OrderedXmlNode[]) {
  const textBody = child(shapeNodes, 'txBody');
  if (!textBody) return undefined;
  const paragraphs = children(textBody, 'txBody')
    .filter(node => 'p' in node)
    .map(node => {
      const content = children(node, 'p');
      const paragraphProperties = child(content, 'pPr');
      const runs = content
        .filter(candidate => ['r', 'fld'].some(name => name in candidate))
        .map(parseRun);
      const endProperties = child(content, 'endParaRPr');
      if (!runs.length && endProperties) runs.push({ text: '' });
      return {
        alignment: getAttribute(paragraphProperties ?? {}, 'algn'),
        level: parseInteger(getAttribute(paragraphProperties ?? {}, 'lvl')),
        runs,
        text: runs.map(run => run.text).join(''),
      } satisfies PptxTextParagraph;
    });
  return {
    paragraphs,
    text: paragraphs.map(paragraph => paragraph.text).join('\n'),
  };
}

function findDescendant(
  nodes: OrderedXmlNode[],
  name: string
): OrderedXmlNode | undefined {
  for (const node of nodes) {
    if (name in node) return node;
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      const found = findDescendant(value as OrderedXmlNode[], name);
      if (found) return found;
    }
  }
  return undefined;
}

function findDescendants(
  nodes: OrderedXmlNode[],
  name: string,
  output: OrderedXmlNode[] = []
) {
  for (const node of nodes) {
    if (name in node) output.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      findDescendants(value as OrderedXmlNode[], name, output);
    }
  }
  return output;
}

function collectRelationshipIds(
  nodes: OrderedXmlNode[],
  output = new Set<string>()
) {
  for (const node of nodes) {
    const attributes = node[':@'];
    if (
      attributes &&
      typeof attributes === 'object' &&
      !Array.isArray(attributes)
    ) {
      for (const [key, value] of Object.entries(attributes)) {
        if (
          typeof value === 'string' &&
          ['embed', 'link', 'id'].includes(key.split(':').pop() ?? '') &&
          /^rId|^rel/i.test(value)
        ) {
          output.add(value);
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      collectRelationshipIds(value as OrderedXmlNode[], output);
    }
  }
  return [...output].sort();
}

function parseGeometry(shapeNodes: OrderedXmlNode[]) {
  const transform = findDescendant(shapeNodes, 'xfrm');
  const transformNodes = children(transform, 'xfrm');
  const offset = child(transformNodes, 'off');
  const extent = child(transformNodes, 'ext');
  const preset = findDescendant(shapeNodes, 'prstGeom');
  if (!transform && !preset) return undefined;
  return {
    xPt: emuToPoints(getAttribute(offset ?? {}, 'x')),
    yPt: emuToPoints(getAttribute(offset ?? {}, 'y')),
    widthPt: emuToPoints(getAttribute(extent ?? {}, 'cx')),
    heightPt: emuToPoints(getAttribute(extent ?? {}, 'cy')),
    rotationDeg: (() => {
      const value = parseNumber(getAttribute(transform ?? {}, 'rot'));
      return value === undefined ? undefined : value / 60_000;
    })(),
    flipHorizontal: parseBoolean(getAttribute(transform ?? {}, 'flipH')),
    flipVertical: parseBoolean(getAttribute(transform ?? {}, 'flipV')),
    preset: getAttribute(preset ?? {}, 'prst'),
  } satisfies PptxGeometry;
}

function shapeType(name: string): PptxShape['type'] {
  switch (name) {
    case 'sp':
      return 'shape';
    case 'pic':
      return 'picture';
    case 'graphicFrame':
      return 'graphicFrame';
    case 'cxnSp':
      return 'connector';
    case 'grpSp':
      return 'group';
    default:
      return 'unknown';
  }
}

function parseShapes(
  nodes: OrderedXmlNode[],
  counters: { shapes: number; textCharacters: number },
  limits: PptxSemanticLimits,
  unsupported: Set<string>
) {
  const shapes: PptxShape[] = [];
  for (const node of nodes) {
    const element = Object.keys(node).find(
      key => key !== ':@' && key !== '#text'
    );
    if (!element) continue;
    const local = element.split(':').pop() ?? element;
    const content = children(node, element);
    if (!['sp', 'pic', 'graphicFrame', 'cxnSp', 'grpSp'].includes(local)) {
      if (!['nvGrpSpPr', 'grpSpPr'].includes(local)) unsupported.add(local);
      continue;
    }
    const nonVisual = findDescendant(content, 'cNvPr');
    const id = getAttribute(nonVisual ?? {}, 'id');
    if (!id)
      throw new OoxmlPackageError(`PPTX ${local} has no stable cNvPr id`);
    counters.shapes++;
    if (counters.shapes > limits.maxShapes)
      throw new OoxmlPackageError('PPTX contains too many shapes');
    const placeholder = findDescendant(content, 'ph');
    const text = parseTextBody(content);
    counters.textCharacters += text?.text.length ?? 0;
    if (counters.textCharacters > limits.maxTextCharacters) {
      throw new OoxmlPackageError('PPTX contains too much text');
    }
    const nested =
      local === 'grpSp'
        ? parseShapes(content, counters, limits, unsupported)
        : undefined;
    shapes.push({
      id,
      type: shapeType(local),
      name: getAttribute(nonVisual ?? {}, 'name'),
      description: getAttribute(nonVisual ?? {}, 'descr'),
      hidden: parseBoolean(getAttribute(nonVisual ?? {}, 'hidden')),
      placeholder: placeholder
        ? {
            type: getAttribute(placeholder, 'type'),
            index: parseInteger(getAttribute(placeholder, 'idx')),
          }
        : undefined,
      geometry: parseGeometry(content),
      text: text?.text,
      paragraphs: text?.paragraphs,
      relationshipIds: collectRelationshipIds(content),
      children: nested,
    });
  }
  return shapes;
}

function parseShapeTree(
  pkg: OoxmlOpcPackage,
  part: string,
  counters: { shapes: number; textCharacters: number },
  limits: PptxSemanticLimits,
  unsupported: Set<string>
) {
  const nodes = parseOrderedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const root = nodes.find(node =>
    ['sld', 'sldMaster', 'sldLayout'].some(name => name in node)
  );
  if (!root)
    throw new OoxmlPackageError(`PPTX part has no slide root: ${part}`);
  const rootKey = Object.keys(root).find(key => !key.startsWith(':')) ?? '';
  const commonSlideData = findDescendant(children(root, rootKey), 'cSld');
  const tree = findDescendant(children(commonSlideData, 'cSld'), 'spTree');
  if (!tree) return [];
  return parseShapes(children(tree, 'spTree'), counters, limits, unsupported);
}

function enrichPictureAssets(
  pkg: OoxmlOpcPackage,
  sourcePart: string,
  shapes: PptxShape[]
) {
  const relationships = new Map(
    pkg
      .getRelationships(sourcePart)
      .map(relationship => [relationship.id, relationship])
  );
  const visit = (items: PptxShape[]) => {
    for (const shape of items) {
      if (shape.type === 'picture') {
        const relationship = shape.relationshipIds
          .map(id => relationships.get(id))
          .find(
            item =>
              item?.resolvedTarget &&
              relationshipTypeName(item.type) === 'image'
          );
        if (relationship?.resolvedTarget) {
          shape.image = {
            relationshipId: relationship.id,
            part: relationship.resolvedTarget,
            contentType: pkg.getContentType(relationship.resolvedTarget),
          };
        }
      }
      if (shape.children) visit(shape.children);
    }
  };
  visit(shapes);
  return shapes;
}

function parseNotesText(pkg: OoxmlOpcPackage, part: string | undefined) {
  if (!part) return undefined;
  const nodes = parseOrderedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const text = findDescendants(nodes, 't')
    .map(node => descendantText(children(node, 't')))
    .filter(Boolean)
    .join('\n');
  return text || '';
}

const THEME_COLOR_SLOTS: readonly PptxThemeColorSlot[] = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
];

function parseThemeColors(pkg: OoxmlOpcPackage, part: string | undefined) {
  const output: Partial<Record<PptxThemeColorSlot, string>> = {};
  if (!part) return output;
  const root = findFirstElement(
    parseOrderedXml(pkg.requirePart(part), part, pkg.limits.maxXmlPartBytes),
    'theme'
  );
  const scheme = root
    ? findDescendant(children(root, 'theme'), 'clrScheme')
    : undefined;
  if (!scheme) return output;
  const schemeNodes = children(scheme, 'clrScheme');
  for (const slot of THEME_COLOR_SLOTS) {
    const node = child(schemeNodes, slot);
    const content = children(node, slot);
    const rgb = child(content, 'srgbClr');
    const system = child(content, 'sysClr');
    const value =
      getAttribute(rgb ?? {}, 'val') ?? getAttribute(system ?? {}, 'lastClr');
    if (value && /^[0-9A-F]{6}$/i.test(value)) {
      output[slot] = `#${value.toUpperCase()}`;
    }
  }
  return output;
}

function packageInventory(pkg: OoxmlOpcPackage, semanticParts: Set<string>) {
  const parts = pkg.listParts().map(part => ({
    ...part,
    handling: semanticParts.has(part.path)
      ? ('semantic' as const)
      : ('opaque' as const),
  }));
  const externalRelationships: PptxSemanticState['package']['externalRelationships'] =
    [];
  for (const part of parts) {
    if (!part.path.endsWith('.rels')) continue;
    const sourcePart = sourcePartNameFromRelationshipPart(part.path);
    for (const relationship of pkg.getRelationships(sourcePart)) {
      if (relationship.targetMode === 'External') {
        externalRelationships.push({
          sourcePart,
          id: relationship.id,
          type: relationship.type,
          target: relationship.target,
        });
      }
    }
  }
  return {
    parts,
    opaqueParts: parts
      .filter(part => part.handling === 'opaque')
      .map(part => part.path),
    externalRelationships,
  };
}

export function readPptxSemanticState(
  pkg: OoxmlOpcPackage,
  options: Partial<PptxSemanticLimits> = {}
): PptxSemanticState {
  if (pkg.format !== 'pptx')
    throw new OoxmlPackageError('Expected a PPTX package');
  const limits = { ...DEFAULT_PPTX_SEMANTIC_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new OoxmlPackageError(
        `PPTX semantic limit must be positive: ${name}`
      );
    }
  }
  const presentationRoot = findFirstElement(
    parseOrderedXml(
      pkg.requirePart(pkg.mainPart),
      pkg.mainPart,
      pkg.limits.maxXmlPartBytes
    ),
    'presentation'
  );
  if (!presentationRoot)
    throw new OoxmlPackageError('PPTX has no presentation root');
  const presentationNodes = children(presentationRoot, 'presentation');
  const relationships = pkg.getRelationships(pkg.mainPart);
  if (relationships.length > limits.maxRelationships)
    throw new OoxmlPackageError('PPTX has too many relationships');
  const relationshipById = new Map(
    relationships.map(relationship => [relationship.id, relationship])
  );
  const counters = { shapes: 0, textCharacters: 0 };
  const unsupported = new Set<string>();
  const slideList = child(presentationNodes, 'sldIdLst');
  const slideNodes = children(slideList, 'sldIdLst').filter(
    node => 'sldId' in node
  );
  if (slideNodes.length > limits.maxSlides)
    throw new OoxmlPackageError('PPTX contains too many slides');
  const slides = slideNodes.map((node, index) => {
    const relationshipId = getAttribute(node, 'id');
    const relationship = relationshipId
      ? relationshipById.get(relationshipId)
      : undefined;
    if (
      !relationshipId ||
      !relationship?.resolvedTarget ||
      relationshipTypeName(relationship.type) !== 'slide'
    ) {
      throw new OoxmlPackageError(
        `PPTX slide relationship is invalid at index ${index}`
      );
    }
    const slideRelationships = pkg.getRelationships(
      relationship.resolvedTarget
    );
    const related = (type: string) =>
      slideRelationships
        .filter(
          item =>
            relationshipTypeName(item.type) === type && item.resolvedTarget
        )
        .map(item => item.resolvedTarget as string);
    const shapes = enrichPictureAssets(
      pkg,
      relationship.resolvedTarget,
      parseShapeTree(
        pkg,
        relationship.resolvedTarget,
        counters,
        limits,
        unsupported
      )
    );
    const slideXml = parseOrderedXml(
      pkg.requirePart(relationship.resolvedTarget),
      relationship.resolvedTarget,
      pkg.limits.maxXmlPartBytes
    );
    const notesPart = related('notesSlide')[0];
    return {
      id: getAttribute(node, 'id') ?? String(index + 256),
      relationshipId,
      part: relationship.resolvedTarget,
      name: `Slide ${index + 1}`,
      hidden:
        parseBoolean(getAttribute(node, 'show')) === false ? true : undefined,
      layoutPart: related('slideLayout')[0],
      notesPart,
      notesText: parseNotesText(pkg, notesPart),
      hasTiming: Boolean(findDescendant(slideXml, 'timing')) || undefined,
      commentParts: [...related('comments'), ...related('commentAuthors')],
      shapes,
    } satisfies PptxSlide;
  });
  const masterList = child(presentationNodes, 'sldMasterIdLst');
  const masters = children(masterList, 'sldMasterIdLst')
    .filter(node => 'sldMasterId' in node)
    .map((node, index) => {
      const relationshipId = getAttribute(node, 'id');
      const relationship = relationshipId
        ? relationshipById.get(relationshipId)
        : undefined;
      if (
        !relationshipId ||
        !relationship?.resolvedTarget ||
        relationshipTypeName(relationship.type) !== 'slideMaster'
      ) {
        throw new OoxmlPackageError(
          `PPTX master relationship is invalid at index ${index}`
        );
      }
      const masterRelationships = pkg.getRelationships(
        relationship.resolvedTarget
      );
      const themePart = masterRelationships.find(
        item => relationshipTypeName(item.type) === 'theme'
      )?.resolvedTarget;
      return {
        id: String(index + 1),
        relationshipId,
        part: relationship.resolvedTarget,
        themePart,
        themeColors: parseThemeColors(pkg, themePart),
        layoutParts: masterRelationships
          .filter(
            item =>
              relationshipTypeName(item.type) === 'slideLayout' &&
              item.resolvedTarget
          )
          .map(item => item.resolvedTarget as string),
        shapes: parseShapeTree(
          pkg,
          relationship.resolvedTarget,
          counters,
          limits,
          unsupported
        ),
      } satisfies PptxMaster;
    });
  const slideSizeNode = child(presentationNodes, 'sldSz');
  const slideWidth = emuToPoints(getAttribute(slideSizeNode ?? {}, 'cx'));
  const slideHeight = emuToPoints(getAttribute(slideSizeNode ?? {}, 'cy'));
  if (!slideWidth || !slideHeight)
    throw new OoxmlPackageError('PPTX has an invalid slide size');
  const notesSizeNode = child(presentationNodes, 'notesSz');
  const notesWidth = emuToPoints(getAttribute(notesSizeNode ?? {}, 'cx'));
  const notesHeight = emuToPoints(getAttribute(notesSizeNode ?? {}, 'cy'));
  const semanticParts = new Set([
    '[Content_Types].xml',
    '_rels/.rels',
    pkg.mainPart,
    ...slides.flatMap(slide =>
      [
        slide.part,
        slide.layoutPart,
        slide.notesPart,
        ...slide.commentParts,
      ].filter((value): value is string => Boolean(value))
    ),
    ...masters.flatMap(master =>
      [master.part, master.themePart, ...master.layoutParts].filter(
        (value): value is string => Boolean(value)
      )
    ),
  ]);
  const packageState = packageInventory(pkg, semanticParts);
  const animationParts = packageState.parts
    .filter(
      part =>
        /animation|timing/i.test(part.contentType ?? '') ||
        /timing/i.test(part.path)
    )
    .map(part => part.path);
  return {
    schemaVersion: PPTX_SEMANTIC_STATE_VERSION,
    modelVersion: PPTX_MODEL_VERSION,
    presentationPart: pkg.mainPart,
    slideSize: {
      widthPt: slideWidth,
      heightPt: slideHeight,
      type: getAttribute(slideSizeNode ?? {}, 'type'),
    },
    notesSize:
      notesWidth && notesHeight
        ? { widthPt: notesWidth, heightPt: notesHeight }
        : undefined,
    slides,
    masters,
    package: packageState,
    compatibility: {
      animationParts,
      animatedSlideIds: slides
        .filter(slide => slide.hasTiming)
        .map(slide => slide.id),
      unsupportedShapeElements: [...unsupported].sort(),
    },
    stats: {
      slides: slides.length,
      masters: masters.length,
      shapes: counters.shapes,
      textCharacters: counters.textCharacters,
      packageParts: packageState.parts.length,
      opaqueParts: packageState.opaqueParts.length,
    },
  };
}
