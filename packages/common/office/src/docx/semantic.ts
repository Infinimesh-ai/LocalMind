import { type DocxOpcPackage, DocxPackageError } from './package';
import {
  relationshipPartName,
  sourcePartNameFromRelationshipPart,
} from './path';
import { type DocxRelationship, relationshipTypeName } from './relationships';
import {
  findChildElement,
  findFirstElement,
  getAttribute,
  getElementChildren,
  getTextContent,
  type OrderedXmlNode,
  parseOrderedXml,
} from './xml';

export const DOCX_SEMANTIC_STATE_VERSION = 'localmind-office-docx-state/v1';
export const DOCX_MODEL_VERSION = 'localmind-office-docx-model/v1';

export type DocxSemanticLimits = {
  maxBlocks: number;
  maxParagraphs: number;
  maxRuns: number;
  maxTextCharacters: number;
  maxStyles: number;
  maxRelationships: number;
};

export const DEFAULT_DOCX_SEMANTIC_LIMITS: Readonly<DocxSemanticLimits> = {
  maxBlocks: 100_000,
  maxParagraphs: 100_000,
  maxRuns: 500_000,
  maxTextCharacters: 32 * 1024 * 1024,
  maxStyles: 20_000,
  maxRelationships: 100_000,
};

export type DocxSemanticOptions = Partial<DocxSemanticLimits>;

export type DocxRunFormat = {
  fontFamily?: string;
  fonts?: {
    ascii?: string;
    highAnsi?: string;
    eastAsia?: string;
    complexScript?: string;
  };
  fontSizePt?: number;
  complexScriptFontSizePt?: number;
  color?: string;
  themeColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: false | { style: string; color?: string };
  strike?: boolean;
  highlight?: string;
  verticalAlign?: string;
  language?: string;
};

export type DocxRunContent =
  | { type: 'text'; text: string }
  | { type: 'tab' }
  | { type: 'break'; breakType?: string }
  | { type: 'noBreakHyphen' }
  | { type: 'softHyphen' }
  | { type: 'symbol'; font?: string; character?: string }
  | { type: 'footnoteReference'; id?: string }
  | { type: 'endnoteReference'; id?: string }
  | { type: 'commentReference'; id?: string }
  | { type: 'fieldCharacter'; fieldType?: string }
  | {
      type: 'object';
      objectType: 'image' | 'drawing' | 'chart' | 'shape' | 'ole' | 'equation';
      relationshipId?: string;
      part?: string;
      contentType?: string;
      name?: string;
      description?: string;
      widthPt?: number;
      heightPt?: number;
    };

export type DocxChangeMetadata = {
  id?: string;
  author?: string;
  date?: string;
};

export type DocxRun = {
  content: DocxRunContent[];
  format?: DocxRunFormat;
  hyperlinkRelationshipId?: string;
  change?: 'inserted' | 'deleted';
  changeMetadata?: DocxChangeMetadata;
};

export type DocxField = {
  instruction: string;
  kind: string;
  argument?: string;
};

export type DocxBookmark = {
  id?: string;
  name: string;
};

export type DocxParagraphProperties = {
  styleId?: string;
  alignment?: string;
  outlineLevel?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  pageBreakBefore?: boolean;
  numbering?: { id?: string; level?: number };
  spacing?: {
    beforePt?: number;
    afterPt?: number;
    linePt?: number;
  };
  indent?: {
    leftPt?: number;
    rightPt?: number;
    firstLinePt?: number;
    hangingPt?: number;
  };
};

export type DocxParagraph = {
  type: 'paragraph';
  id: string;
  sourceId?: string;
  properties?: DocxParagraphProperties;
  runs: DocxRun[];
  text: string;
  fields: DocxField[];
  bookmarks: DocxBookmark[];
};

export type DocxTableCell = {
  gridSpan?: number;
  verticalMerge?: string;
  widthTwips?: number;
  blocks: DocxBlock[];
};

export type DocxTableRow = {
  cells: DocxTableCell[];
};

export type DocxTable = {
  type: 'table';
  id: string;
  styleId?: string;
  widthTwips?: number;
  layout?: string;
  rows: DocxTableRow[];
};

export type DocxContentControl = {
  type: 'contentControl';
  id: string;
  tag?: string;
  title?: string;
  blocks: DocxBlock[];
};

export type DocxUnsupportedBlock = {
  type: 'unsupported';
  id: string;
  element: string;
};

export type DocxBlock =
  | DocxParagraph
  | DocxTable
  | DocxContentControl
  | DocxUnsupportedBlock;

export type DocxSection = {
  index: number;
  type?: string;
  pageSize?: {
    widthPt?: number;
    heightPt?: number;
    orientation?: string;
  };
  margins?: {
    topPt?: number;
    rightPt?: number;
    bottomPt?: number;
    leftPt?: number;
    headerPt?: number;
    footerPt?: number;
    gutterPt?: number;
  };
  titlePage?: boolean;
  columns?: number;
  headerReferences: DocxSectionReference[];
  footerReferences: DocxSectionReference[];
};

export type DocxSectionReference = {
  type?: string;
  relationshipId?: string;
  part?: string;
};

export type DocxStory = {
  kind: 'header' | 'footer';
  type?: string;
  relationshipId?: string;
  part: string;
  blocks: DocxBlock[];
};

export type DocxNote = {
  id: string;
  type?: string;
  blocks: DocxBlock[];
};

export type DocxNativeComment = {
  id: string;
  author?: string;
  initials?: string;
  date?: string;
  text: string;
  blocks: DocxBlock[];
};

export type DocxDocumentProtection = {
  edit?: string;
  enforcement?: boolean;
  formatting?: boolean;
};

export type DocxStyle = {
  styleId: string;
  type?: string;
  name?: string;
  basedOn?: string;
  next?: string;
  linkedStyle?: string;
  isDefault?: boolean;
  isCustom?: boolean;
  hidden?: boolean;
  semiHidden?: boolean;
  quickFormat?: boolean;
  priority?: number;
  paragraph?: DocxParagraphProperties;
  run?: DocxRunFormat;
};

export type DocxExternalRelationship = {
  sourcePart: string | null;
  id: string;
  type: string;
  target: string;
};

export type DocxSemanticState = {
  schemaVersion: typeof DOCX_SEMANTIC_STATE_VERSION;
  modelVersion: typeof DOCX_MODEL_VERSION;
  documentPart: string;
  body: DocxBlock[];
  styles: DocxStyle[];
  sections: DocxSection[];
  stories: DocxStory[];
  notes: {
    footnotes: DocxNote[];
    endnotes: DocxNote[];
  };
  references: {
    fields: Array<DocxField & { paragraphId: string }>;
    bookmarks: Array<DocxBookmark & { paragraphId: string }>;
    tableOfContentsFields: Array<DocxField & { paragraphId: string }>;
    crossReferenceFields: Array<DocxField & { paragraphId: string }>;
    mailMergeFields: Array<DocxField & { paragraphId: string }>;
  };
  review: {
    trackRevisions: boolean;
    protection?: DocxDocumentProtection;
    comments: DocxNativeComment[];
    changes: Array<
      DocxChangeMetadata & {
        type: 'inserted' | 'deleted';
        paragraphId: string;
        text: string;
      }
    >;
  };
  package: {
    parts: Array<{
      path: string;
      contentType?: string;
      byteSize: number;
      handling: 'semantic' | 'opaque';
    }>;
    opaqueParts: string[];
    externalRelationships: DocxExternalRelationship[];
  };
  compatibility: {
    unsupportedBodyElements: string[];
  };
  stats: {
    blocks: number;
    paragraphs: number;
    runs: number;
    textCharacters: number;
    tables: number;
    styles: number;
    sections: number;
    headersFooters: number;
    footnotes: number;
    endnotes: number;
    fields: number;
    bookmarks: number;
    comments: number;
    changes: number;
    objects: number;
    packageParts: number;
    opaqueParts: number;
    externalRelationships: number;
  };
};

class SemanticContext {
  readonly limits: DocxSemanticLimits;
  readonly usedIds = new Set<string>();
  readonly sectionNodes: OrderedXmlNode[] = [];
  readonly unsupportedBodyElements = new Set<string>();
  blocks = 0;
  paragraphs = 0;
  runs = 0;
  textCharacters = 0;
  tables = 0;
  contentControls = 0;
  unsupportedBlocks = 0;
  objects = 0;

  constructor(options: DocxSemanticOptions) {
    this.limits = { ...DEFAULT_DOCX_SEMANTIC_LIMITS, ...options };
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new DocxPackageError(
          `DOCX semantic limit must be positive: ${name}`
        );
      }
    }
  }

  claimBlockId(kind: string, preferred?: string) {
    this.blocks++;
    if (this.blocks > this.limits.maxBlocks) {
      throw new DocxPackageError('DOCX document contains too many blocks');
    }
    const safePreferred = preferred?.replace(/[^A-Za-z0-9_.-]/g, '');
    let id = safePreferred
      ? `${kind}:${safePreferred}`
      : `${kind}:${this.blocks}`;
    if (this.usedIds.has(id)) id = `${kind}:${this.blocks}`;
    while (this.usedIds.has(id))
      id = `${kind}:${this.blocks}:${this.usedIds.size}`;
    this.usedIds.add(id);
    return id;
  }

  countParagraph() {
    this.paragraphs++;
    if (this.paragraphs > this.limits.maxParagraphs) {
      throw new DocxPackageError('DOCX document contains too many paragraphs');
    }
  }

  countRun(textCharacters: number) {
    this.runs++;
    this.textCharacters += textCharacters;
    if (this.runs > this.limits.maxRuns) {
      throw new DocxPackageError('DOCX document contains too many runs');
    }
    if (this.textCharacters > this.limits.maxTextCharacters) {
      throw new DocxPackageError('DOCX document contains too much text');
    }
  }
}

function childNode(nodes: OrderedXmlNode[], name: string) {
  return findChildElement(nodes, name);
}

function childValue(nodes: OrderedXmlNode[], name: string) {
  const node = childNode(nodes, name);
  return node ? getAttribute(node, 'val') : undefined;
}

function parseInteger(value: string | undefined) {
  if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

function parseTwips(value: string | undefined) {
  const twips = parseInteger(value);
  return twips === undefined ? undefined : twips / 20;
}

function parseOnOffNode(node: OrderedXmlNode | undefined) {
  if (!node) return undefined;
  const value = getAttribute(node, 'val')?.toLowerCase();
  return value === undefined || !['0', 'false', 'off', 'none'].includes(value);
}

function parseBooleanAttribute(value: string | undefined) {
  if (value === undefined) return undefined;
  return !['0', 'false', 'off', 'none'].includes(value.toLowerCase());
}

function parseOnOff(nodes: OrderedXmlNode[], name: string) {
  return parseOnOffNode(childNode(nodes, name));
}

function compactObject<T extends object>(value: T): T | undefined {
  return Object.values(value).some(item => item !== undefined)
    ? value
    : undefined;
}

function descendants(
  nodes: OrderedXmlNode[],
  name: string,
  output: OrderedXmlNode[] = []
) {
  for (const node of nodes) {
    if (name in node) output.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      descendants(value as OrderedXmlNode[], name, output);
    }
  }
  return output;
}

function descendantText(nodes: OrderedXmlNode[]) {
  let text = getTextContent(nodes);
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ':@' || key === '#text' || !Array.isArray(value)) continue;
      text += descendantText(value as OrderedXmlNode[]);
    }
  }
  return text;
}

function parseFields(nodes: OrderedXmlNode[]) {
  const instructions = [
    ...descendants(nodes, 'fldSimple')
      .map(node => getAttribute(node, 'instr'))
      .filter((value): value is string => Boolean(value?.trim())),
    ...descendants(nodes, 'instrText')
      .map(node => descendantText(getElementChildren(node, 'instrText')))
      .filter(value => value.trim()),
  ];
  return instructions.map(instruction => {
    const normalized = instruction.trim();
    const [kind = 'UNKNOWN', argument] = normalized.split(/\s+/, 2);
    return {
      instruction: normalized,
      kind: kind.toUpperCase(),
      argument: argument?.replace(/^"|"$/g, ''),
    } satisfies DocxField;
  });
}

function parseBookmarks(nodes: OrderedXmlNode[]) {
  return descendants(nodes, 'bookmarkStart')
    .map(node => ({
      id: getAttribute(node, 'id'),
      name: getAttribute(node, 'name') ?? '',
    }))
    .filter(bookmark => bookmark.name && !bookmark.name.startsWith('_'));
}

function parseParagraphProperties(
  propertyNode: OrderedXmlNode | undefined
): DocxParagraphProperties | undefined {
  if (!propertyNode) return undefined;
  const nodes = getElementChildren(propertyNode, 'pPr');
  const numPr = childNode(nodes, 'numPr');
  const numNodes = numPr ? getElementChildren(numPr, 'numPr') : [];
  const spacing = childNode(nodes, 'spacing');
  const indent = childNode(nodes, 'ind');
  return compactObject({
    styleId: childValue(nodes, 'pStyle'),
    alignment: childValue(nodes, 'jc'),
    outlineLevel: parseInteger(childValue(nodes, 'outlineLvl')),
    keepNext: parseOnOff(nodes, 'keepNext'),
    keepLines: parseOnOff(nodes, 'keepLines'),
    pageBreakBefore: parseOnOff(nodes, 'pageBreakBefore'),
    numbering: numPr
      ? compactObject({
          id: childValue(numNodes, 'numId'),
          level: parseInteger(childValue(numNodes, 'ilvl')),
        })
      : undefined,
    spacing: spacing
      ? compactObject({
          beforePt: parseTwips(getAttribute(spacing, 'before')),
          afterPt: parseTwips(getAttribute(spacing, 'after')),
          linePt: parseTwips(getAttribute(spacing, 'line')),
        })
      : undefined,
    indent: indent
      ? compactObject({
          leftPt: parseTwips(getAttribute(indent, 'left')),
          rightPt: parseTwips(getAttribute(indent, 'right')),
          firstLinePt: parseTwips(getAttribute(indent, 'firstLine')),
          hangingPt: parseTwips(getAttribute(indent, 'hanging')),
        })
      : undefined,
  });
}

function colorValue(value: string | undefined) {
  if (!value) return undefined;
  return /^[0-9A-F]{6}$/i.test(value) ? `#${value.toUpperCase()}` : value;
}

function parseHalfPoints(value: string | undefined) {
  const halfPoints = parseInteger(value);
  return halfPoints !== undefined && halfPoints >= 0
    ? halfPoints / 2
    : undefined;
}

function parseRunFormat(
  propertyNode: OrderedXmlNode | undefined
): DocxRunFormat | undefined {
  if (!propertyNode) return undefined;
  const nodes = getElementChildren(propertyNode, 'rPr');
  const fontsNode = childNode(nodes, 'rFonts');
  const fonts = fontsNode
    ? compactObject({
        ascii: getAttribute(fontsNode, 'ascii'),
        highAnsi: getAttribute(fontsNode, 'hAnsi'),
        eastAsia: getAttribute(fontsNode, 'eastAsia'),
        complexScript: getAttribute(fontsNode, 'cs'),
      })
    : undefined;
  const colorNode = childNode(nodes, 'color');
  const underlineNode = childNode(nodes, 'u');
  const underlineValue = underlineNode
    ? (getAttribute(underlineNode, 'val') ?? 'single')
    : undefined;
  return compactObject({
    fontFamily:
      fonts?.ascii ??
      fonts?.highAnsi ??
      fonts?.eastAsia ??
      fonts?.complexScript,
    fonts,
    fontSizePt: parseHalfPoints(childValue(nodes, 'sz')),
    complexScriptFontSizePt: parseHalfPoints(childValue(nodes, 'szCs')),
    color: colorValue(getAttribute(colorNode ?? {}, 'val')),
    themeColor: getAttribute(colorNode ?? {}, 'themeColor'),
    bold: parseOnOff(nodes, 'b'),
    italic: parseOnOff(nodes, 'i'),
    underline:
      underlineValue === undefined
        ? undefined
        : underlineValue === 'none'
          ? false
          : {
              style: underlineValue,
              color: colorValue(getAttribute(underlineNode ?? {}, 'color')),
            },
    strike: parseOnOff(nodes, 'strike'),
    highlight: childValue(nodes, 'highlight'),
    verticalAlign: childValue(nodes, 'vertAlign'),
    language: getAttribute(childNode(nodes, 'lang') ?? {}, 'val'),
  });
}

function parseObject(
  node: OrderedXmlNode,
  objectType: 'drawing' | 'shape' | 'ole' | 'equation',
  relationships: ReadonlyMap<string, DocxRelationship>,
  context: SemanticContext
): Extract<DocxRunContent, { type: 'object' }> {
  context.objects++;
  const nodeChildren = getElementChildren(node, Object.keys(node)[0] ?? '');
  const blip = descendants(nodeChildren, 'blip')[0];
  const imageData = descendants(nodeChildren, 'imagedata')[0];
  const chart = descendants(nodeChildren, 'chart')[0];
  const ole = descendants(nodeChildren, 'OLEObject')[0];
  const relationshipId =
    getAttribute(blip ?? {}, 'embed') ??
    getAttribute(blip ?? {}, 'link') ??
    getAttribute(imageData ?? {}, 'id') ??
    getAttribute(chart ?? {}, 'id') ??
    getAttribute(ole ?? {}, 'id');
  const relationship = relationshipId
    ? relationships.get(relationshipId)
    : undefined;
  const properties = descendants(nodeChildren, 'docPr')[0];
  const extent = descendants(nodeChildren, 'extent')[0];
  const width = parseInteger(getAttribute(extent ?? {}, 'cx'));
  const height = parseInteger(getAttribute(extent ?? {}, 'cy'));
  const resolvedType = chart
    ? 'chart'
    : ole
      ? 'ole'
      : blip || imageData
        ? 'image'
        : objectType;
  return {
    type: 'object',
    objectType: resolvedType,
    relationshipId,
    part: relationship?.resolvedTarget,
    name: getAttribute(properties ?? {}, 'name'),
    description: getAttribute(properties ?? {}, 'descr'),
    widthPt: width === undefined ? undefined : width / 12_700,
    heightPt: height === undefined ? undefined : height / 12_700,
  };
}

function parseRunContent(
  nodes: OrderedXmlNode[],
  relationships: ReadonlyMap<string, DocxRelationship>,
  context: SemanticContext
) {
  const content: DocxRunContent[] = [];
  for (const node of nodes) {
    if ('t' in node || 'delText' in node || 'instrText' in node) {
      const elementName =
        't' in node ? 't' : 'delText' in node ? 'delText' : 'instrText';
      content.push({
        type: 'text',
        text: getTextContent(getElementChildren(node, elementName)),
      });
    } else if ('tab' in node) {
      content.push({ type: 'tab' });
    } else if (
      'br' in node ||
      'cr' in node ||
      'lastRenderedPageBreak' in node
    ) {
      content.push({
        type: 'break',
        breakType:
          'lastRenderedPageBreak' in node
            ? 'lastRenderedPageBreak'
            : getAttribute(node, 'type'),
      });
    } else if ('noBreakHyphen' in node) {
      content.push({ type: 'noBreakHyphen' });
    } else if ('softHyphen' in node) {
      content.push({ type: 'softHyphen' });
    } else if ('sym' in node) {
      content.push({
        type: 'symbol',
        font: getAttribute(node, 'font'),
        character: getAttribute(node, 'char'),
      });
    } else if ('footnoteReference' in node) {
      content.push({ type: 'footnoteReference', id: getAttribute(node, 'id') });
    } else if ('endnoteReference' in node) {
      content.push({ type: 'endnoteReference', id: getAttribute(node, 'id') });
    } else if ('commentReference' in node) {
      content.push({ type: 'commentReference', id: getAttribute(node, 'id') });
    } else if ('fldChar' in node) {
      content.push({
        type: 'fieldCharacter',
        fieldType: getAttribute(node, 'fldCharType'),
      });
    } else if ('drawing' in node) {
      content.push(parseObject(node, 'drawing', relationships, context));
    } else if ('pict' in node) {
      content.push(parseObject(node, 'shape', relationships, context));
    } else if ('object' in node) {
      content.push(parseObject(node, 'ole', relationships, context));
    } else if ('oMath' in node) {
      content.push(parseObject(node, 'equation', relationships, context));
    }
  }
  return content;
}

function runText(content: DocxRunContent[]) {
  return content
    .map(item => {
      if (item.type === 'text') return item.text;
      if (item.type === 'tab') return '\t';
      if (item.type === 'break') return '\n';
      if (item.type === 'noBreakHyphen') return '\u2011';
      if (item.type === 'softHyphen') return '\u00AD';
      return '';
    })
    .join('');
}

function parseRun(
  node: OrderedXmlNode,
  context: SemanticContext,
  relationships: ReadonlyMap<string, DocxRelationship>,
  metadata: Pick<
    DocxRun,
    'hyperlinkRelationshipId' | 'change' | 'changeMetadata'
  > = {}
) {
  const nodes = getElementChildren(node, 'r');
  const content = parseRunContent(nodes, relationships, context);
  const textCharacters = runText(content).length;
  context.countRun(textCharacters);
  return {
    content,
    format: parseRunFormat(childNode(nodes, 'rPr')),
    ...metadata,
  } satisfies DocxRun;
}

function collectRuns(
  nodes: OrderedXmlNode[],
  context: SemanticContext,
  relationships: ReadonlyMap<string, DocxRelationship>,
  metadata: Pick<
    DocxRun,
    'hyperlinkRelationshipId' | 'change' | 'changeMetadata'
  > = {}
): DocxRun[] {
  const runs: DocxRun[] = [];
  for (const node of nodes) {
    if ('r' in node) {
      runs.push(parseRun(node, context, relationships, metadata));
      continue;
    }
    for (const container of [
      'hyperlink',
      'ins',
      'del',
      'smartTag',
      'sdt',
      'sdtContent',
      'fldSimple',
    ]) {
      if (!(container in node)) continue;
      const childMetadata = {
        ...metadata,
        hyperlinkRelationshipId:
          container === 'hyperlink'
            ? getAttribute(node, 'id')
            : metadata.hyperlinkRelationshipId,
        change:
          container === 'ins'
            ? ('inserted' as const)
            : container === 'del'
              ? ('deleted' as const)
              : metadata.change,
        changeMetadata:
          container === 'ins' || container === 'del'
            ? {
                id: getAttribute(node, 'id'),
                author: getAttribute(node, 'author'),
                date: getAttribute(node, 'date'),
              }
            : metadata.changeMetadata,
      };
      runs.push(
        ...collectRuns(
          getElementChildren(node, container),
          context,
          relationships,
          childMetadata
        )
      );
    }
  }
  return runs;
}

function parseParagraph(
  node: OrderedXmlNode,
  context: SemanticContext,
  relationships: ReadonlyMap<string, DocxRelationship>,
  trackSections = true
) {
  context.countParagraph();
  const nodes = getElementChildren(node, 'p');
  const sourceId = getAttribute(node, 'paraId');
  const id = context.claimBlockId('paragraph', sourceId);
  const paragraph = {
    type: 'paragraph',
    id,
    sourceId,
    properties: parseParagraphProperties(childNode(nodes, 'pPr')),
    runs: collectRuns(nodes, context, relationships),
    text: '',
    fields: parseFields(nodes),
    bookmarks: parseBookmarks(nodes),
  } satisfies DocxParagraph;
  paragraph.text = paragraph.runs.map(run => runText(run.content)).join('');

  const propertyNode = childNode(nodes, 'pPr');
  const sectionNode = propertyNode
    ? childNode(getElementChildren(propertyNode, 'pPr'), 'sectPr')
    : undefined;
  if (sectionNode && trackSections) context.sectionNodes.push(sectionNode);
  return paragraph;
}

function parseCell(
  node: OrderedXmlNode,
  context: SemanticContext,
  relationships: ReadonlyMap<string, DocxRelationship>
): DocxTableCell {
  const nodes = getElementChildren(node, 'tc');
  const properties = childNode(nodes, 'tcPr');
  const propertyNodes = properties
    ? getElementChildren(properties, 'tcPr')
    : [];
  return {
    gridSpan: parseInteger(childValue(propertyNodes, 'gridSpan')),
    verticalMerge: childValue(propertyNodes, 'vMerge'),
    widthTwips: parseInteger(
      getAttribute(childNode(propertyNodes, 'tcW') ?? {}, 'w')
    ),
    blocks: parseBlocks(nodes, context, relationships, new Set(['tcPr'])),
  };
}

function parseTable(
  node: OrderedXmlNode,
  context: SemanticContext,
  relationships: ReadonlyMap<string, DocxRelationship>
) {
  context.tables++;
  const nodes = getElementChildren(node, 'tbl');
  const properties = childNode(nodes, 'tblPr');
  const propertyNodes = properties
    ? getElementChildren(properties, 'tblPr')
    : [];
  const rows = nodes
    .filter(child => 'tr' in child)
    .map(row => ({
      cells: getElementChildren(row, 'tr')
        .filter(child => 'tc' in child)
        .map(cell => parseCell(cell, context, relationships)),
    }));
  return {
    type: 'table',
    id: context.claimBlockId('table'),
    styleId: childValue(propertyNodes, 'tblStyle'),
    widthTwips: parseInteger(
      getAttribute(childNode(propertyNodes, 'tblW') ?? {}, 'w')
    ),
    layout: getAttribute(childNode(propertyNodes, 'tblLayout') ?? {}, 'type'),
    rows,
  } satisfies DocxTable;
}

function parseContentControl(
  node: OrderedXmlNode,
  context: SemanticContext,
  relationships: ReadonlyMap<string, DocxRelationship>
) {
  context.contentControls++;
  const nodes = getElementChildren(node, 'sdt');
  const properties = childNode(nodes, 'sdtPr');
  const propertyNodes = properties
    ? getElementChildren(properties, 'sdtPr')
    : [];
  const content = childNode(nodes, 'sdtContent');
  return {
    type: 'contentControl',
    id: context.claimBlockId(
      'content-control',
      getAttribute(childNode(propertyNodes, 'id') ?? {}, 'val')
    ),
    tag: childValue(propertyNodes, 'tag'),
    title: childValue(propertyNodes, 'alias'),
    blocks: content
      ? parseBlocks(
          getElementChildren(content, 'sdtContent'),
          context,
          relationships
        )
      : [],
  } satisfies DocxContentControl;
}

function elementName(node: OrderedXmlNode) {
  return Object.keys(node).find(key => key !== ':@' && key !== '#text');
}

function parseBlocks(
  nodes: OrderedXmlNode[],
  context: SemanticContext,
  relationships: ReadonlyMap<string, DocxRelationship>,
  ignored = new Set<string>(),
  trackSections = true
): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  for (const node of nodes) {
    if ('p' in node)
      blocks.push(parseParagraph(node, context, relationships, trackSections));
    else if ('tbl' in node)
      blocks.push(parseTable(node, context, relationships));
    else if ('sdt' in node)
      blocks.push(parseContentControl(node, context, relationships));
    else {
      const name = elementName(node);
      if (!name || ignored.has(name) || name === 'sectPr') continue;
      context.unsupportedBodyElements.add(name);
      context.unsupportedBlocks++;
      blocks.push({
        type: 'unsupported',
        id: context.claimBlockId('unsupported'),
        element: name,
      });
    }
  }
  return blocks;
}

function resolveSectionReference(
  node: OrderedXmlNode,
  relationships: ReadonlyMap<string, DocxRelationship>
): DocxSectionReference {
  const relationshipId = getAttribute(node, 'id');
  return {
    type: getAttribute(node, 'type'),
    relationshipId,
    part: relationshipId
      ? relationships.get(relationshipId)?.resolvedTarget
      : undefined,
  };
}

function parseSection(
  node: OrderedXmlNode,
  index: number,
  relationships: ReadonlyMap<string, DocxRelationship>
): DocxSection {
  const nodes = getElementChildren(node, 'sectPr');
  const pageSize = childNode(nodes, 'pgSz');
  const margins = childNode(nodes, 'pgMar');
  const columns = childNode(nodes, 'cols');
  return {
    index,
    type: childValue(nodes, 'type'),
    pageSize: pageSize
      ? compactObject({
          widthPt: parseTwips(getAttribute(pageSize, 'w')),
          heightPt: parseTwips(getAttribute(pageSize, 'h')),
          orientation: getAttribute(pageSize, 'orient'),
        })
      : undefined,
    margins: margins
      ? compactObject({
          topPt: parseTwips(getAttribute(margins, 'top')),
          rightPt: parseTwips(getAttribute(margins, 'right')),
          bottomPt: parseTwips(getAttribute(margins, 'bottom')),
          leftPt: parseTwips(getAttribute(margins, 'left')),
          headerPt: parseTwips(getAttribute(margins, 'header')),
          footerPt: parseTwips(getAttribute(margins, 'footer')),
          gutterPt: parseTwips(getAttribute(margins, 'gutter')),
        })
      : undefined,
    titlePage: parseOnOff(nodes, 'titlePg'),
    columns: parseInteger(getAttribute(columns ?? {}, 'num')),
    headerReferences: nodes
      .filter(child => 'headerReference' in child)
      .map(child => resolveSectionReference(child, relationships)),
    footerReferences: nodes
      .filter(child => 'footerReference' in child)
      .map(child => resolveSectionReference(child, relationships)),
  };
}

function parseStyles(
  pkg: DocxOpcPackage,
  relationships: readonly DocxRelationship[],
  context: SemanticContext
) {
  const stylesRelationship = relationships.find(
    relationship =>
      relationship.targetMode === 'Internal' &&
      relationshipTypeName(relationship.type) === 'styles'
  );
  if (!stylesRelationship?.resolvedTarget) {
    return { styles: [] as DocxStyle[], stylesPart: undefined };
  }

  const stylesPart = stylesRelationship.resolvedTarget;
  const nodes = parseOrderedXml(
    pkg.requirePart(stylesPart),
    stylesPart,
    pkg.limits.maxXmlPartBytes
  );
  const root = findFirstElement(nodes, 'styles');
  if (!root) throw new DocxPackageError('DOCX styles part is missing its root');

  const styles: DocxStyle[] = [];
  for (const node of getElementChildren(root, 'styles')) {
    if (!('style' in node)) continue;
    if (styles.length >= context.limits.maxStyles) {
      throw new DocxPackageError('DOCX document contains too many styles');
    }
    const styleId = getAttribute(node, 'styleId');
    if (!styleId) continue;
    const children = getElementChildren(node, 'style');
    styles.push({
      styleId,
      type: getAttribute(node, 'type'),
      name: childValue(children, 'name'),
      basedOn: childValue(children, 'basedOn'),
      next: childValue(children, 'next'),
      linkedStyle: childValue(children, 'link'),
      isDefault: parseBooleanAttribute(getAttribute(node, 'default')),
      isCustom: parseBooleanAttribute(getAttribute(node, 'customStyle')),
      hidden: parseOnOff(children, 'hidden'),
      semiHidden: parseOnOff(children, 'semiHidden'),
      quickFormat: parseOnOff(children, 'qFormat'),
      priority: parseInteger(childValue(children, 'uiPriority')),
      paragraph: parseParagraphProperties(childNode(children, 'pPr')),
      run: parseRunFormat(childNode(children, 'rPr')),
    });
  }
  return { styles, stylesPart };
}

function collectExternalRelationships(
  pkg: DocxOpcPackage,
  context: SemanticContext
) {
  const relationships: DocxExternalRelationship[] = [];
  let relationshipCount = 0;
  for (const part of pkg.listParts()) {
    if (part.kind !== 'relationships') continue;
    const sourcePart = sourcePartNameFromRelationshipPart(part.path);
    for (const relationship of pkg.getRelationships(sourcePart)) {
      relationshipCount++;
      if (relationshipCount > context.limits.maxRelationships) {
        throw new DocxPackageError(
          'DOCX package contains too many relationships'
        );
      }
      if (relationship.targetMode === 'External') {
        relationships.push({
          sourcePart,
          id: relationship.id,
          type: relationship.type,
          target: relationship.target,
        });
      }
    }
  }
  return relationships;
}

function internalRelationship(
  relationships: readonly DocxRelationship[],
  type: string
) {
  return relationships.find(
    relationship =>
      relationship.targetMode === 'Internal' &&
      relationshipTypeName(relationship.type) === type &&
      relationship.resolvedTarget
  );
}

function parseStory(
  pkg: DocxOpcPackage,
  reference: DocxSectionReference,
  kind: DocxStory['kind'],
  context: SemanticContext
): DocxStory | undefined {
  if (!reference.part || !pkg.hasPart(reference.part)) return undefined;
  const nodes = parseOrderedXml(
    pkg.requirePart(reference.part),
    reference.part,
    pkg.limits.maxXmlPartBytes
  );
  const root = findFirstElement(nodes, kind === 'header' ? 'hdr' : 'ftr');
  if (!root) {
    throw new DocxPackageError(
      `DOCX ${kind} part is missing its root: ${reference.part}`
    );
  }
  const relationships = new Map(
    pkg
      .getRelationships(reference.part)
      .map(relationship => [relationship.id, relationship])
  );
  return {
    kind,
    type: reference.type,
    relationshipId: reference.relationshipId,
    part: reference.part,
    blocks: parseBlocks(
      getElementChildren(root, kind === 'header' ? 'hdr' : 'ftr'),
      context,
      relationships,
      new Set(),
      false
    ),
  };
}

function parseStories(
  pkg: DocxOpcPackage,
  sections: readonly DocxSection[],
  context: SemanticContext
) {
  const stories = new Map<string, DocxStory>();
  for (const section of sections) {
    for (const [kind, references] of [
      ['header', section.headerReferences],
      ['footer', section.footerReferences],
    ] as const) {
      for (const reference of references) {
        const story = parseStory(pkg, reference, kind, context);
        if (story)
          stories.set(`${story.kind}:${story.part}:${story.type}`, story);
      }
    }
  }
  return [...stories.values()];
}

function parseNotes(
  pkg: DocxOpcPackage,
  documentRelationships: readonly DocxRelationship[],
  type: 'footnotes' | 'endnotes',
  context: SemanticContext
) {
  const relationship = internalRelationship(documentRelationships, type);
  const part = relationship?.resolvedTarget;
  if (!part || !pkg.hasPart(part)) return { part: undefined, notes: [] };
  const nodes = parseOrderedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const root = findFirstElement(nodes, type);
  if (!root)
    throw new DocxPackageError(`DOCX ${type} part is missing its root`);
  const noteName = type === 'footnotes' ? 'footnote' : 'endnote';
  const relationships = new Map(
    pkg.getRelationships(part).map(item => [item.id, item])
  );
  const notes = getElementChildren(root, type)
    .filter(node => noteName in node)
    .map(node => ({
      id: getAttribute(node, 'id') ?? '',
      type: getAttribute(node, 'type'),
      blocks: parseBlocks(
        getElementChildren(node, noteName),
        context,
        relationships,
        new Set(),
        false
      ),
    }))
    .filter(
      note =>
        note.id &&
        !['separator', 'continuationSeparator'].includes(note.type ?? '')
    );
  return { part, notes };
}

function parseNativeComments(
  pkg: DocxOpcPackage,
  documentRelationships: readonly DocxRelationship[],
  context: SemanticContext
) {
  const relationship = internalRelationship(documentRelationships, 'comments');
  const part = relationship?.resolvedTarget;
  if (!part || !pkg.hasPart(part)) return { part: undefined, comments: [] };
  const nodes = parseOrderedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const root = findFirstElement(nodes, 'comments');
  if (!root)
    throw new DocxPackageError('DOCX comments part is missing its root');
  const relationships = new Map(
    pkg.getRelationships(part).map(item => [item.id, item])
  );
  const comments = getElementChildren(root, 'comments')
    .filter(node => 'comment' in node)
    .map(node => {
      const blocks = parseBlocks(
        getElementChildren(node, 'comment'),
        context,
        relationships,
        new Set(),
        false
      );
      return {
        id: getAttribute(node, 'id') ?? '',
        author: getAttribute(node, 'author'),
        initials: getAttribute(node, 'initials'),
        date: getAttribute(node, 'date'),
        text: collectParagraphs(blocks)
          .map(paragraph => paragraph.text)
          .join('\n'),
        blocks,
      } satisfies DocxNativeComment;
    })
    .filter(comment => comment.id);
  return { part, comments };
}

function collectParagraphs(
  blocks: readonly DocxBlock[],
  output: DocxParagraph[] = []
) {
  for (const block of blocks) {
    if (block.type === 'paragraph') output.push(block);
    else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) collectParagraphs(cell.blocks, output);
      }
    } else if (block.type === 'contentControl') {
      collectParagraphs(block.blocks, output);
    }
  }
  return output;
}

function parseSettings(
  pkg: DocxOpcPackage,
  documentRelationships: readonly DocxRelationship[]
) {
  const relationship = internalRelationship(documentRelationships, 'settings');
  const part = relationship?.resolvedTarget;
  if (!part || !pkg.hasPart(part)) {
    return {
      part: undefined,
      trackRevisions: false,
      protection: undefined,
    };
  }
  const nodes = parseOrderedXml(
    pkg.requirePart(part),
    part,
    pkg.limits.maxXmlPartBytes
  );
  const root = findFirstElement(nodes, 'settings');
  if (!root)
    throw new DocxPackageError('DOCX settings part is missing its root');
  const children = getElementChildren(root, 'settings');
  const protection = childNode(children, 'documentProtection');
  return {
    part,
    trackRevisions: Boolean(childNode(children, 'trackRevisions')),
    protection: protection
      ? compactObject({
          edit: getAttribute(protection, 'edit'),
          enforcement: parseBooleanAttribute(
            getAttribute(protection, 'enforcement')
          ),
          formatting: parseBooleanAttribute(
            getAttribute(protection, 'formatting')
          ),
        })
      : undefined,
  };
}

function enrichObjects(pkg: DocxOpcPackage, blocks: readonly DocxBlock[]) {
  for (const paragraph of collectParagraphs(blocks)) {
    for (const run of paragraph.runs) {
      for (const content of run.content) {
        if (content.type === 'object' && content.part) {
          content.contentType = pkg.getContentType(content.part);
        }
      }
    }
  }
}

function semanticRelationshipParts(pkg: DocxOpcPackage, parts: string[]) {
  return parts.flatMap(part => {
    const relationship = relationshipPartName(part);
    return pkg.hasPart(relationship) ? [part, relationship] : [part];
  });
}

export function readDocxSemanticState(
  pkg: DocxOpcPackage,
  options: DocxSemanticOptions = {}
): DocxSemanticState {
  const context = new SemanticContext(options);
  const documentNodes = parseOrderedXml(
    pkg.requirePart(pkg.documentPart),
    pkg.documentPart,
    pkg.limits.maxXmlPartBytes
  );
  const documentRoot = findFirstElement(documentNodes, 'document');
  const bodyNode = documentRoot
    ? findChildElement(getElementChildren(documentRoot, 'document'), 'body')
    : undefined;
  if (!bodyNode) throw new DocxPackageError('DOCX document part has no body');

  const documentRelationships = pkg.getRelationships(pkg.documentPart);
  const relationshipMap = new Map(
    documentRelationships.map(relationship => [relationship.id, relationship])
  );
  const bodyNodes = getElementChildren(bodyNode, 'body');
  const body = parseBlocks(bodyNodes, context, relationshipMap);

  const rawSections = [...context.sectionNodes];
  const finalSection = childNode(bodyNodes, 'sectPr');
  if (finalSection) rawSections.push(finalSection);
  const sections = rawSections.map((section, index) =>
    parseSection(section, index, relationshipMap)
  );
  const stories = parseStories(pkg, sections, context);
  const footnotes = parseNotes(
    pkg,
    documentRelationships,
    'footnotes',
    context
  );
  const endnotes = parseNotes(pkg, documentRelationships, 'endnotes', context);
  const nativeComments = parseNativeComments(
    pkg,
    documentRelationships,
    context
  );
  const settings = parseSettings(pkg, documentRelationships);

  const { styles, stylesPart } = parseStyles(
    pkg,
    documentRelationships,
    context
  );
  const externalRelationships = collectExternalRelationships(pkg, context);
  const allBlocks = [
    ...body,
    ...stories.flatMap(story => story.blocks),
    ...footnotes.notes.flatMap(note => note.blocks),
    ...endnotes.notes.flatMap(note => note.blocks),
    ...nativeComments.comments.flatMap(comment => comment.blocks),
  ];
  enrichObjects(pkg, allBlocks);
  const bodyParagraphs = collectParagraphs(body);
  const fields = bodyParagraphs.flatMap(paragraph =>
    paragraph.fields.map(field => ({ ...field, paragraphId: paragraph.id }))
  );
  const bookmarks = bodyParagraphs.flatMap(paragraph =>
    paragraph.bookmarks.map(bookmark => ({
      ...bookmark,
      paragraphId: paragraph.id,
    }))
  );
  const changes = bodyParagraphs.flatMap(paragraph =>
    paragraph.runs.flatMap(run =>
      run.change
        ? [
            {
              type: run.change,
              paragraphId: paragraph.id,
              text: runText(run.content),
              ...run.changeMetadata,
            },
          ]
        : []
    )
  );
  const parsedParts = [
    ...stories.map(story => story.part),
    ...(footnotes.part ? [footnotes.part] : []),
    ...(endnotes.part ? [endnotes.part] : []),
    ...(nativeComments.part ? [nativeComments.part] : []),
    ...(settings.part ? [settings.part] : []),
  ];
  const semanticParts = new Set([
    '[Content_Types].xml',
    '_rels/.rels',
    pkg.documentPart,
    relationshipPartName(pkg.documentPart),
    ...(stylesPart ? [stylesPart, relationshipPartName(stylesPart)] : []),
    ...semanticRelationshipParts(pkg, parsedParts),
  ]);
  const packageParts = pkg.listParts().map(part => ({
    path: part.path,
    contentType: part.contentType,
    byteSize: part.byteSize,
    handling: semanticParts.has(part.path)
      ? ('semantic' as const)
      : ('opaque' as const),
  }));
  const opaqueParts = packageParts
    .filter(part => part.handling === 'opaque')
    .map(part => part.path);

  return {
    schemaVersion: DOCX_SEMANTIC_STATE_VERSION,
    modelVersion: DOCX_MODEL_VERSION,
    documentPart: pkg.documentPart,
    body,
    styles,
    sections,
    stories,
    notes: {
      footnotes: footnotes.notes,
      endnotes: endnotes.notes,
    },
    references: {
      fields,
      bookmarks,
      tableOfContentsFields: fields.filter(field => field.kind === 'TOC'),
      crossReferenceFields: fields.filter(field =>
        ['REF', 'PAGEREF', 'NOTEREF'].includes(field.kind)
      ),
      mailMergeFields: fields.filter(field => field.kind === 'MERGEFIELD'),
    },
    review: {
      trackRevisions: settings.trackRevisions,
      protection: settings.protection,
      comments: nativeComments.comments,
      changes,
    },
    package: {
      parts: packageParts,
      opaqueParts,
      externalRelationships,
    },
    compatibility: {
      unsupportedBodyElements: [...context.unsupportedBodyElements].sort(),
    },
    stats: {
      blocks: context.blocks,
      paragraphs: context.paragraphs,
      runs: context.runs,
      textCharacters: context.textCharacters,
      tables: context.tables,
      styles: styles.length,
      sections: sections.length,
      headersFooters: stories.length,
      footnotes: footnotes.notes.length,
      endnotes: endnotes.notes.length,
      fields: fields.length,
      bookmarks: bookmarks.length,
      comments: nativeComments.comments.length,
      changes: changes.length,
      objects: context.objects,
      packageParts: packageParts.length,
      opaqueParts: opaqueParts.length,
      externalRelationships: externalRelationships.length,
    },
  };
}
