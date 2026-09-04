import {
  type OfficeDocumentContentControlTextCommand,
  type OfficeDocumentFormatParagraphCommand,
  type OfficeDocumentFormatTextCommand,
  type OfficeDocumentHeaderFooterTextCommand,
  type OfficeDocumentInsertBreakCommand,
  type OfficeDocumentInsertObjectCommand,
  type OfficeDocumentInsertSectionCommand,
  type OfficeDocumentInsertTableCommand,
  type OfficeDocumentMailMergeCommand,
  type OfficeDocumentPageLayoutCommand,
  type OfficeDocumentReplaceTextCommand,
  type OfficeDocumentReviewResolveCommand,
  parseOfficeCommand,
} from '../command';
import {
  appendOoxmlRelationship,
  ensureOoxmlContentType,
  nextOoxmlPartName,
  nextOoxmlRelationshipId,
  relativeOoxmlTarget,
} from '../ooxml';
import {
  type DocxOpcPackage,
  DocxPackageError,
  openDocxPackage,
} from './package';
import { relationshipPartName } from './path';
import {
  type DocxBlock,
  type DocxParagraph,
  type DocxSemanticState,
  readDocxSemanticState,
} from './semantic';
import {
  buildPreservedXml,
  type OrderedXmlNode,
  parsePreservedXml,
} from './xml';

const RUN_CONTAINERS = new Set([
  'hyperlink',
  'ins',
  'del',
  'smartTag',
  'sdt',
  'sdtContent',
  'fldSimple',
]);

const RUN_PROPERTY_ORDER = [
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
  'rPrChange',
] as const;

type ElementRef = {
  node: OrderedXmlNode;
  key: string;
  children: OrderedXmlNode[];
  parent: OrderedXmlNode[];
  index: number;
};

export type DocxCommandResult = {
  packageBytes: Uint8Array;
  state: DocxSemanticState;
  summary: Record<string, unknown> & { operation: string };
};

type DocxStructuralCommand =
  | OfficeDocumentFormatParagraphCommand
  | OfficeDocumentInsertBreakCommand
  | OfficeDocumentInsertSectionCommand
  | OfficeDocumentInsertTableCommand
  | OfficeDocumentPageLayoutCommand
  | OfficeDocumentHeaderFooterTextCommand
  | OfficeDocumentContentControlTextCommand
  | OfficeDocumentReviewResolveCommand
  | OfficeDocumentMailMergeCommand;

type DocxInsertedObject<
  K extends OfficeDocumentInsertObjectCommand['object']['type'],
> = Omit<OfficeDocumentInsertObjectCommand, 'object'> & {
  object: Extract<OfficeDocumentInsertObjectCommand['object'], { type: K }>;
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

function attributeByLocalName(node: OrderedXmlNode, name: string) {
  const entry = Object.entries(attributes(node)).find(
    ([key]) => localName(key) === name
  );
  return entry?.[1];
}

function setAttribute(
  attrs: Record<string, string>,
  prefix: string,
  name: string,
  value: string
) {
  const existing = Object.keys(attrs).find(key => localName(key) === name);
  attrs[existing ?? qualify(prefix, name)] = value;
}

function deleteAttribute(attrs: Record<string, string>, name: string) {
  for (const key of Object.keys(attrs)) {
    if (localName(key) === name) delete attrs[key];
  }
}

function createElement(
  prefix: string,
  name: string,
  attrs?: Record<string, string>
): OrderedXmlNode {
  return {
    [qualify(prefix, name)]: [],
    ...(attrs && Object.keys(attrs).length ? { ':@': attrs } : {}),
  };
}

function findChild(nodes: OrderedXmlNode[], name: string) {
  return nodes.find(node => {
    const key = elementKey(node);
    return key ? localName(key) === name : false;
  });
}

function requireRootBody(nodes: OrderedXmlNode[]) {
  const document = findChild(nodes, 'document');
  const documentKey = document ? elementKey(document) : undefined;
  const documentChildren = documentKey ? document?.[documentKey] : undefined;
  const body = Array.isArray(documentChildren)
    ? findChild(documentChildren as OrderedXmlNode[], 'body')
    : undefined;
  const bodyKey = body ? elementKey(body) : undefined;
  const bodyChildren = bodyKey ? body?.[bodyKey] : undefined;
  if (!body || !bodyKey || !Array.isArray(bodyChildren)) {
    throw new DocxPackageError('DOCX document part has no editable body');
  }
  return bodyChildren as OrderedXmlNode[];
}

function collectParagraphElements(
  nodes: OrderedXmlNode[],
  output: ElementRef[]
) {
  nodes.forEach((node, index) => {
    const key = elementKey(node);
    if (!key) return;
    const name = localName(key);
    const children = node[key];
    if (!Array.isArray(children)) return;
    if (name === 'p') {
      output.push({ node, key, children, parent: nodes, index });
      return;
    }
    if (name === 'sdt') {
      const content = findChild(children, 'sdtContent');
      const contentKey = content ? elementKey(content) : undefined;
      const contentChildren = contentKey ? content?.[contentKey] : undefined;
      if (Array.isArray(contentChildren)) {
        collectParagraphElements(contentChildren as OrderedXmlNode[], output);
      }
      return;
    }
    if (name !== 'tbl') return;
    for (const row of children) {
      const rowKey = elementKey(row);
      if (!rowKey || localName(rowKey) !== 'tr') continue;
      const rowChildren = row[rowKey];
      if (!Array.isArray(rowChildren)) continue;
      for (const cell of rowChildren) {
        const cellKey = elementKey(cell);
        if (!cellKey || localName(cellKey) !== 'tc') continue;
        const cellChildren = cell[cellKey];
        if (Array.isArray(cellChildren)) {
          collectParagraphElements(cellChildren as OrderedXmlNode[], output);
        }
      }
    }
  });
}

function collectSemanticParagraphs(
  blocks: readonly DocxBlock[],
  output: DocxParagraph[]
) {
  for (const block of blocks) {
    if (block.type === 'paragraph') output.push(block);
    else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectSemanticParagraphs(cell.blocks, output);
        }
      }
    } else if (block.type === 'contentControl') {
      collectSemanticParagraphs(block.blocks, output);
    }
  }
}

function collectRunElements(nodes: OrderedXmlNode[], output: ElementRef[]) {
  nodes.forEach((node, index) => {
    const key = elementKey(node);
    if (!key) return;
    const name = localName(key);
    const children = node[key];
    if (!Array.isArray(children)) return;
    if (name === 'r') {
      output.push({ node, key, children, parent: nodes, index });
    } else if (RUN_CONTAINERS.has(name)) {
      collectRunElements(children as OrderedXmlNode[], output);
    }
  });
}

function nodeText(node: OrderedXmlNode, key: string) {
  const children = node[key];
  if (!Array.isArray(children)) return '';
  return (children as OrderedXmlNode[])
    .map(child => (typeof child['#text'] === 'string' ? child['#text'] : ''))
    .join('');
}

function nodeLogicalLength(node: OrderedXmlNode) {
  const key = elementKey(node);
  if (!key) return 0;
  const name = localName(key);
  if (name === 't' || name === 'delText' || name === 'instrText') {
    return nodeText(node, key).length;
  }
  return [
    'tab',
    'br',
    'cr',
    'lastRenderedPageBreak',
    'noBreakHyphen',
    'softHyphen',
  ].includes(name)
    ? 1
    : 0;
}

function runLogicalLength(run: ElementRef) {
  return run.children.reduce(
    (total, node) => total + nodeLogicalLength(node),
    0
  );
}

function cloneTextNode(
  node: OrderedXmlNode,
  key: string,
  text: string
): OrderedXmlNode {
  const cloned = structuredClone(node) as OrderedXmlNode;
  cloned[key] = [{ '#text': text }];
  if (/^\s|\s$/.test(text)) {
    const attrs = { ...attributes(cloned) };
    attrs['xml:space'] = 'preserve';
    cloned[':@'] = attrs;
  }
  return cloned;
}

function splitContentNode(node: OrderedXmlNode, from: number, to: number) {
  const key = elementKey(node);
  if (!key) return undefined;
  const name = localName(key);
  const length = nodeLogicalLength(node);
  if (from === 0 && to === length) {
    return structuredClone(node) as OrderedXmlNode;
  }
  if (!['t', 'delText', 'instrText'].includes(name)) {
    throw new DocxPackageError(
      `DOCX run cannot be split safely around ${name || 'unknown content'}`
    );
  }
  return cloneTextNode(node, key, nodeText(node, key).slice(from, to));
}

function propertyOrder(name: string) {
  const index = RUN_PROPERTY_ORDER.indexOf(
    name as (typeof RUN_PROPERTY_ORDER)[number]
  );
  return index === -1 ? RUN_PROPERTY_ORDER.length - 1 : index;
}

function upsertProperty(
  propertyChildren: OrderedXmlNode[],
  name: string,
  node: OrderedXmlNode
) {
  const matchingIndexes: number[] = [];
  for (let index = 0; index < propertyChildren.length; index++) {
    const key = elementKey(propertyChildren[index]);
    if (!key || localName(key) !== name) continue;
    matchingIndexes.push(index);
  }
  if (matchingIndexes.length) {
    const replacementIndex = matchingIndexes[0];
    for (let index = matchingIndexes.length - 1; index >= 0; index--) {
      propertyChildren.splice(matchingIndexes[index], 1);
    }
    propertyChildren.splice(replacementIndex, 0, node);
    return;
  }
  const order = propertyOrder(name);
  const insertionIndex = propertyChildren.findIndex(child => {
    const key = elementKey(child);
    return key ? propertyOrder(localName(key)) > order : false;
  });
  propertyChildren.splice(
    insertionIndex === -1 ? propertyChildren.length : insertionIndex,
    0,
    node
  );
}

function currentProperty(propertyChildren: OrderedXmlNode[], name: string) {
  return propertyChildren.find(child => {
    const key = elementKey(child);
    return key ? localName(key) === name : false;
  });
}

function updateAttributeProperty(
  propertyChildren: OrderedXmlNode[],
  prefix: string,
  name: string,
  updates: Record<string, string>,
  remove: readonly string[] = []
) {
  const existing = currentProperty(propertyChildren, name);
  const attrs = existing ? { ...attributes(existing) } : {};
  for (const attribute of remove) deleteAttribute(attrs, attribute);
  for (const [attribute, value] of Object.entries(updates)) {
    setAttribute(attrs, prefix, attribute, value);
  }
  upsertProperty(propertyChildren, name, createElement(prefix, name, attrs));
}

function ensureRunProperties(run: ElementRef) {
  const prefix = prefixOf(run.key);
  let property = findChild(run.children, 'rPr');
  if (!property) {
    property = createElement(prefix, 'rPr');
    run.children.unshift(property);
  }
  const key = elementKey(property);
  const children = key ? property[key] : undefined;
  if (!key || !Array.isArray(children)) {
    throw new DocxPackageError('DOCX run properties are not editable');
  }
  return { prefix, children: children as OrderedXmlNode[] };
}

function applyRunFormat(run: ElementRef, format: DocxRunFormatCommand) {
  const { prefix, children } = ensureRunProperties(run);
  if (format.fontFamily !== undefined) {
    updateAttributeProperty(
      children,
      prefix,
      'rFonts',
      {
        ascii: format.fontFamily,
        hAnsi: format.fontFamily,
        eastAsia: format.fontFamily,
        cs: format.fontFamily,
      },
      ['asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme']
    );
  }
  if (format.fontSizePt !== undefined) {
    const halfPoints = String(format.fontSizePt * 2);
    updateAttributeProperty(children, prefix, 'sz', { val: halfPoints });
    updateAttributeProperty(children, prefix, 'szCs', { val: halfPoints });
  }
  if (format.textColor !== undefined) {
    updateAttributeProperty(
      children,
      prefix,
      'color',
      { val: format.textColor.slice(1).toUpperCase() },
      ['themeColor', 'themeTint', 'themeShade']
    );
  }
  for (const [name, value] of [
    ['b', format.bold],
    ['i', format.italic],
  ] as const) {
    if (value === undefined) continue;
    upsertProperty(
      children,
      name,
      createElement(
        prefix,
        name,
        value ? undefined : { [qualify(prefix, 'val')]: '0' }
      )
    );
  }
  if (format.underline !== undefined) {
    if (format.underline === false) {
      updateAttributeProperty(children, prefix, 'u', { val: 'none' }, [
        'color',
        'themeColor',
        'themeTint',
        'themeShade',
      ]);
    } else {
      const style =
        format.underline.style === 'dashed' ? 'dash' : format.underline.style;
      updateAttributeProperty(
        children,
        prefix,
        'u',
        {
          val: style,
          ...(format.underline.color
            ? { color: format.underline.color.slice(1).toUpperCase() }
            : {}),
        },
        format.underline.color ? ['themeColor', 'themeTint', 'themeShade'] : []
      );
    }
  }
}

type DocxRunFormatCommand = Omit<
  OfficeDocumentFormatTextCommand['format'],
  'paragraphStyleId'
>;

function applyParagraphStyle(paragraph: ElementRef, styleId: string) {
  const prefix = prefixOf(paragraph.key);
  let property = findChild(paragraph.children, 'pPr');
  if (!property) {
    property = createElement(prefix, 'pPr');
    paragraph.children.unshift(property);
  }
  const propertyKey = elementKey(property);
  const propertyChildren = propertyKey ? property[propertyKey] : undefined;
  if (!propertyKey || !Array.isArray(propertyChildren)) {
    throw new DocxPackageError('DOCX paragraph properties are not editable');
  }
  const style = createElement(prefix, 'pStyle', {
    [qualify(prefix, 'val')]: styleId,
  });
  const existingIndex = (propertyChildren as OrderedXmlNode[]).findIndex(
    node => {
      const key = elementKey(node);
      return key ? localName(key) === 'pStyle' : false;
    }
  );
  if (existingIndex === -1)
    (propertyChildren as OrderedXmlNode[]).unshift(style);
  else (propertyChildren as OrderedXmlNode[])[existingIndex] = style;
}

function splitAndFormatRun(
  run: ElementRef,
  selectionStart: number,
  selectionEnd: number,
  format: DocxRunFormatCommand
) {
  const property = findChild(run.children, 'rPr');
  const content = run.children.filter(node => node !== property);
  if (content.some(node => nodeLogicalLength(node) === 0)) {
    throw new DocxPackageError(
      'DOCX run contains zero-width content and cannot be split safely'
    );
  }

  const segments: OrderedXmlNode[][] = [[], [], []];
  let offset = 0;
  for (const node of content) {
    const length = nodeLogicalLength(node);
    const boundaries = [
      0,
      selectionStart,
      selectionEnd,
      Number.POSITIVE_INFINITY,
    ];
    for (let segment = 0; segment < 3; segment++) {
      const from = Math.max(offset, boundaries[segment]);
      const to = Math.min(offset + length, boundaries[segment + 1]);
      if (from >= to) continue;
      const split = splitContentNode(node, from - offset, to - offset);
      if (split) segments[segment].push(split);
    }
    offset += length;
  }

  const replacements = segments
    .map((nodes, segment) => {
      if (!nodes.length) return undefined;
      const cloned = structuredClone(run.node) as OrderedXmlNode;
      const clonedChildren = [
        ...(property ? [structuredClone(property) as OrderedXmlNode] : []),
        ...nodes,
      ];
      cloned[run.key] = clonedChildren;
      const ref: ElementRef = {
        node: cloned,
        key: run.key,
        children: clonedChildren,
        parent: run.parent,
        index: run.index,
      };
      if (segment === 1) applyRunFormat(ref, format);
      return cloned;
    })
    .filter((node): node is OrderedXmlNode => Boolean(node));
  run.parent.splice(run.index, 1, ...replacements);
}

function createTextNode(prefix: string, text: string) {
  const node = createElement(
    prefix,
    't',
    /^\s|\s$/.test(text) ? { 'xml:space': 'preserve' } : undefined
  );
  node[qualify(prefix, 't')] = [{ '#text': text }];
  return node;
}

function cloneRunSlice(run: ElementRef, from: number, to: number) {
  if (from === to) return undefined;
  const property = findChild(run.children, 'rPr');
  const content = run.children.filter(node => node !== property);
  if (content.some(node => nodeLogicalLength(node) === 0)) {
    throw new DocxPackageError(
      'DOCX run contains zero-width content and cannot be edited safely'
    );
  }
  const nodes: OrderedXmlNode[] = [];
  let offset = 0;
  for (const node of content) {
    const length = nodeLogicalLength(node);
    const overlapStart = Math.max(from, offset);
    const overlapEnd = Math.min(to, offset + length);
    if (overlapStart < overlapEnd) {
      const split = splitContentNode(
        node,
        overlapStart - offset,
        overlapEnd - offset
      );
      if (split) nodes.push(split);
    }
    offset += length;
  }
  if (!nodes.length) return undefined;
  const cloned = structuredClone(run.node) as OrderedXmlNode;
  cloned[run.key] = [
    ...(property ? [structuredClone(property) as OrderedXmlNode] : []),
    ...nodes,
  ];
  return cloned;
}

function cloneRunWithText(run: ElementRef, text: string) {
  if (!text) return undefined;
  const property = findChild(run.children, 'rPr');
  const cloned = structuredClone(run.node) as OrderedXmlNode;
  cloned[run.key] = [
    ...(property ? [structuredClone(property) as OrderedXmlNode] : []),
    createTextNode(prefixOf(run.key), text),
  ];
  return cloned;
}

function replaceParagraphText(
  paragraph: ElementRef,
  semantic: DocxParagraph,
  command: OfficeDocumentReplaceTextCommand
) {
  const start = command.target.start.offset;
  const end = command.target.end.offset;
  const runs: ElementRef[] = [];
  collectRunElements(paragraph.children, runs);
  if (!runs.length) {
    if (start !== 0 || end !== 0) {
      throw new DocxPackageError(
        `DOCX paragraph text mapping is not editable: ${semantic.id}`
      );
    }
    if (command.text) {
      const prefix = prefixOf(paragraph.key);
      const run = createElement(prefix, 'r');
      run[qualify(prefix, 'r')] = [createTextNode(prefix, command.text)];
      paragraph.children.push(run);
    }
    return command.text ? 1 : 0;
  }

  const lengths = runs.map(runLogicalLength);
  if (
    lengths.reduce((total, length) => total + length, 0) !==
    semantic.text.length
  ) {
    throw new DocxPackageError(
      `DOCX paragraph text mapping is not editable: ${semantic.id}`
    );
  }
  let insertionRunIndex = lengths.length - 1;
  let runningOffset = 0;
  for (let index = 0; index < lengths.length; index++) {
    const runEnd = runningOffset + lengths[index];
    if (start < runEnd || (start === 0 && runEnd === 0)) {
      insertionRunIndex = index;
      break;
    }
    runningOffset = runEnd;
  }

  const operations: Array<{
    run: ElementRef;
    runIndex: number;
    runStart: number;
    runEnd: number;
  }> = [];
  runningOffset = 0;
  runs.forEach((run, runIndex) => {
    const runStart = runningOffset;
    const runEnd = runStart + lengths[runIndex];
    runningOffset = runEnd;
    const overlaps = start < runEnd && end > runStart;
    if (overlaps || runIndex === insertionRunIndex) {
      operations.push({ run, runIndex, runStart, runEnd });
    }
  });

  for (const operation of operations.reverse()) {
    const localStart = Math.max(
      0,
      Math.min(lengths[operation.runIndex], start - operation.runStart)
    );
    const localEnd = Math.max(
      0,
      Math.min(lengths[operation.runIndex], end - operation.runStart)
    );
    const replacements = [
      cloneRunSlice(operation.run, 0, localStart),
      operation.runIndex === insertionRunIndex
        ? cloneRunWithText(operation.run, command.text)
        : undefined,
      cloneRunSlice(operation.run, localEnd, lengths[operation.runIndex]),
    ].filter((node): node is OrderedXmlNode => Boolean(node));
    operation.run.parent.splice(operation.run.index, 1, ...replacements);
  }
  return operations.length;
}

function paragraphTexts(state: DocxSemanticState) {
  const paragraphs: DocxParagraph[] = [];
  collectSemanticParagraphs(state.body, paragraphs);
  return paragraphs.map(paragraph => ({
    id: paragraph.id,
    text: paragraph.text,
  }));
}

function isUnicodeBoundary(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

function removeChildren(nodes: OrderedXmlNode[], name: string) {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const key = elementKey(nodes[index]);
    if (key && localName(key) === name) nodes.splice(index, 1);
  }
}

function upsertChild(
  nodes: OrderedXmlNode[],
  prefix: string,
  name: string,
  attrs: Record<string, string> = {},
  content?: OrderedXmlNode[]
) {
  let node = findChild(nodes, name);
  if (!node) {
    node = createElement(prefix, name);
    nodes.push(node);
  }
  const key = elementKey(node);
  if (!key) throw new DocxPackageError(`DOCX ${name} element is invalid`);
  const nextAttrs = { ...attributes(node) };
  for (const [attribute, value] of Object.entries(attrs)) {
    setAttribute(nextAttrs, prefix, localName(attribute), value);
  }
  if (Object.keys(nextAttrs).length) node[':@'] = nextAttrs;
  else delete node[':@'];
  if (content) node[key] = content;
  return node;
}

function ensureParagraphProperties(paragraph: ElementRef) {
  const prefix = prefixOf(paragraph.key);
  let property = findChild(paragraph.children, 'pPr');
  if (!property) {
    property = createElement(prefix, 'pPr');
    paragraph.children.unshift(property);
  }
  const key = elementKey(property);
  const content = key ? property[key] : undefined;
  if (!key || !Array.isArray(content)) {
    throw new DocxPackageError('DOCX paragraph properties are not editable');
  }
  return { prefix, children: content as OrderedXmlNode[] };
}

function setToggle(
  nodes: OrderedXmlNode[],
  prefix: string,
  name: string,
  value: boolean
) {
  upsertChild(
    nodes,
    prefix,
    name,
    value ? {} : { [qualify(prefix, 'val')]: '0' }
  );
}

function pointsToTwips(value: number) {
  return String(Math.round(value * 20));
}

function resolveParagraph(
  state: DocxSemanticState,
  paragraphElements: ElementRef[],
  blockId: string
) {
  const paragraphs: DocxParagraph[] = [];
  collectSemanticParagraphs(state.body, paragraphs);
  const index = paragraphs.findIndex(paragraph => paragraph.id === blockId);
  if (index === -1 || !paragraphElements[index]) {
    throw new DocxPackageError(`DOCX paragraph not found: ${blockId}`);
  }
  return { semantic: paragraphs[index], element: paragraphElements[index] };
}

function applyParagraphFormat(
  paragraph: ElementRef,
  command: OfficeDocumentFormatParagraphCommand
) {
  const { prefix, children } = ensureParagraphProperties(paragraph);
  const format = command.format;
  if (format.alignment !== undefined) {
    upsertChild(children, prefix, 'jc', {
      [qualify(prefix, 'val')]: format.alignment,
    });
  }
  for (const [name, value] of [
    ['keepNext', format.keepNext],
    ['keepLines', format.keepLines],
    ['pageBreakBefore', format.pageBreakBefore],
  ] as const) {
    if (value !== undefined) setToggle(children, prefix, name, value);
  }
  if (format.outlineLevel !== undefined) {
    if (format.outlineLevel === null) removeChildren(children, 'outlineLvl');
    else {
      upsertChild(children, prefix, 'outlineLvl', {
        [qualify(prefix, 'val')]: String(format.outlineLevel),
      });
    }
  }
  if (format.numbering !== undefined) {
    if (format.numbering === false) {
      removeChildren(children, 'numPr');
    } else {
      const numPr = upsertChild(children, prefix, 'numPr');
      const key = elementKey(numPr);
      if (!key || !Array.isArray(numPr[key])) {
        throw new DocxPackageError('DOCX numbering properties are invalid');
      }
      const numberChildren = numPr[key] as OrderedXmlNode[];
      upsertChild(numberChildren, prefix, 'ilvl', {
        [qualify(prefix, 'val')]: String(format.numbering.level),
      });
      upsertChild(numberChildren, prefix, 'numId', {
        [qualify(prefix, 'val')]: format.numbering.id,
      });
    }
  }
  const spacingUpdates = Object.fromEntries(
    [
      ['before', format.spaceBeforePt],
      ['after', format.spaceAfterPt],
      ['line', format.lineSpacingPt],
    ]
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .map(([name, value]) => [qualify(prefix, name), pointsToTwips(value)])
  );
  if (Object.keys(spacingUpdates).length) {
    upsertChild(children, prefix, 'spacing', spacingUpdates);
  }
  const indentUpdates = Object.fromEntries(
    [
      ['left', format.leftIndentPt],
      ['right', format.rightIndentPt],
      ['firstLine', format.firstLineIndentPt],
    ]
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .map(([name, value]) => [qualify(prefix, name), pointsToTwips(value)])
  );
  if (Object.keys(indentUpdates).length) {
    upsertChild(children, prefix, 'ind', indentUpdates);
  }
}

function createRunWithContent(
  prefix: string,
  content: OrderedXmlNode,
  template?: ElementRef
) {
  const run = createElement(prefix, 'r');
  run[qualify(prefix, 'r')] = [
    ...(template
      ? template.children
          .filter(node => {
            const key = elementKey(node);
            return key ? localName(key) === 'rPr' : false;
          })
          .map(node => structuredClone(node) as OrderedXmlNode)
      : []),
    content,
  ];
  return run;
}

function insertBreak(
  paragraph: ElementRef,
  semantic: DocxParagraph,
  command: OfficeDocumentInsertBreakCommand
) {
  const offset = command.target.offset;
  if (
    offset > semantic.text.length ||
    !isUnicodeBoundary(semantic.text, offset)
  ) {
    throw new DocxPackageError('DOCX break target offset is invalid');
  }
  const runs: ElementRef[] = [];
  collectRunElements(paragraph.children, runs);
  const lengths = runs.map(runLogicalLength);
  if (
    lengths.reduce((total, length) => total + length, 0) !==
    semantic.text.length
  ) {
    throw new DocxPackageError(
      `DOCX paragraph text mapping is not editable: ${semantic.id}`
    );
  }
  const prefix = prefixOf(paragraph.key);
  const breakNode = createElement(
    prefix,
    'br',
    command.breakType === 'line'
      ? undefined
      : { [qualify(prefix, 'type')]: command.breakType }
  );
  if (!runs.length) {
    paragraph.children.push(createRunWithContent(prefix, breakNode));
    return;
  }
  let running = 0;
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    const length = lengths[index];
    const end = running + length;
    if (offset <= end || index === runs.length - 1) {
      const localOffset = Math.max(0, Math.min(length, offset - running));
      const replacements = [
        cloneRunSlice(run, 0, localOffset),
        createRunWithContent(prefixOf(run.key), breakNode, run),
        cloneRunSlice(run, localOffset, length),
      ].filter((node): node is OrderedXmlNode => Boolean(node));
      run.parent.splice(run.index, 1, ...replacements);
      return;
    }
    running = end;
  }
}

function insertSection(
  body: OrderedXmlNode[],
  state: DocxSemanticState,
  paragraphElements: ElementRef[],
  command: OfficeDocumentInsertSectionCommand
) {
  const target = resolveParagraph(
    state,
    paragraphElements,
    command.target.blockId
  );
  if (!body.includes(target.element.node)) {
    throw new DocxPackageError(
      'DOCX section breaks can be inserted only after a top-level paragraph'
    );
  }
  const existingSections = sectionNodes(body);
  if (!existingSections.length) {
    existingSections.push(createFinalSection(body));
  }
  const sourceIndex =
    command.sourceSectionIndex ?? Math.max(0, existingSections.length - 1);
  const source = existingSections[sourceIndex];
  if (!source) {
    throw new DocxPackageError(`DOCX section not found: ${sourceIndex}`);
  }
  const properties = ensureParagraphProperties(target.element);
  if (findChild(properties.children, 'sectPr')) {
    throw new DocxPackageError(
      `DOCX paragraph already ends a section: ${target.semantic.id}`
    );
  }
  const inserted = structuredClone(source) as OrderedXmlNode;
  const insertedKey = elementKey(inserted);
  const insertedChildren = insertedKey ? inserted[insertedKey] : undefined;
  if (!insertedKey || !Array.isArray(insertedChildren)) {
    throw new DocxPackageError('DOCX source section properties are invalid');
  }
  upsertChild(
    insertedChildren as OrderedXmlNode[],
    prefixOf(insertedKey),
    'type',
    {
      [qualify(prefixOf(insertedKey), 'val')]: command.sectionType,
    }
  );
  properties.children.push(inserted);
  return target.semantic.id;
}

function nodeWithChildren(
  prefix: string,
  name: string,
  content: OrderedXmlNode[],
  attrs?: Record<string, string>
) {
  const node = createElement(prefix, name, attrs);
  node[qualify(prefix, name)] = content;
  return node;
}

function tableNode(prefix: string, command: OfficeDocumentInsertTableCommand) {
  if (
    command.cells &&
    (command.cells.length > command.rows ||
      command.cells.some(row => row.length > command.columns))
  ) {
    throw new DocxPackageError(
      'DOCX table cell values exceed the requested dimensions'
    );
  }
  const columnWidth = Math.max(240, Math.floor(9000 / command.columns));
  const grid = nodeWithChildren(
    prefix,
    'tblGrid',
    Array.from({ length: command.columns }, () =>
      createElement(prefix, 'gridCol', {
        [qualify(prefix, 'w')]: String(columnWidth),
      })
    )
  );
  const rows = Array.from({ length: command.rows }, (_, rowIndex) =>
    nodeWithChildren(
      prefix,
      'tr',
      Array.from({ length: command.columns }, (_, columnIndex) => {
        const text = command.cells?.[rowIndex]?.[columnIndex] ?? '';
        return nodeWithChildren(prefix, 'tc', [
          nodeWithChildren(prefix, 'tcPr', [
            createElement(prefix, 'tcW', {
              [qualify(prefix, 'w')]: String(columnWidth),
              [qualify(prefix, 'type')]: 'dxa',
            }),
          ]),
          nodeWithChildren(prefix, 'p', [
            nodeWithChildren(prefix, 'r', [createTextNode(prefix, text)]),
          ]),
        ]);
      })
    )
  );
  return nodeWithChildren(prefix, 'tbl', [
    nodeWithChildren(prefix, 'tblPr', [
      createElement(prefix, 'tblW', {
        [qualify(prefix, 'w')]: '0',
        [qualify(prefix, 'type')]: 'auto',
      }),
      createElement(prefix, 'tblLayout', {
        [qualify(prefix, 'type')]: 'fixed',
      }),
    ]),
    grid,
    ...rows,
  ]);
}

function insertTable(
  body: OrderedXmlNode[],
  state: DocxSemanticState,
  command: OfficeDocumentInsertTableCommand
) {
  const blockIndex = state.body.findIndex(
    block => block.id === command.afterBlockId
  );
  if (blockIndex === -1) {
    throw new DocxPackageError(`DOCX block not found: ${command.afterBlockId}`);
  }
  const blockNodes = body.filter(node => {
    const key = elementKey(node);
    return key ? localName(key) !== 'sectPr' : false;
  });
  const target = blockNodes[blockIndex];
  const targetIndex = body.indexOf(target);
  if (!target || targetIndex === -1) {
    throw new DocxPackageError(
      'DOCX block identity changed while inserting table'
    );
  }
  const prefix = prefixOf(elementKey(target) ?? 'w:p');
  body.splice(targetIndex + 1, 0, tableNode(prefix, command));
}

function sectionNodes(body: OrderedXmlNode[]) {
  const output: OrderedXmlNode[] = [];
  const visit = (nodes: OrderedXmlNode[]) => {
    for (const node of nodes) {
      const key = elementKey(node);
      if (key && localName(key) === 'sectPr') output.push(node);
      const value = key ? node[key] : undefined;
      if (Array.isArray(value)) visit(value as OrderedXmlNode[]);
    }
  };
  visit(body);
  return output;
}

function createFinalSection(body: OrderedXmlNode[]) {
  const firstElementKey = body
    .map(node => elementKey(node))
    .find((key): key is string => Boolean(key));
  const section = createElement(prefixOf(firstElementKey ?? 'w:p'), 'sectPr');
  body.push(section);
  return section;
}

function resolveOrCreateSection(body: OrderedXmlNode[], sectionIndex: number) {
  const sections = sectionNodes(body);
  if (!sections.length && sectionIndex === 0) return createFinalSection(body);
  const section = sections[sectionIndex];
  if (!section) {
    throw new DocxPackageError(`DOCX section not found: ${sectionIndex}`);
  }
  return section;
}

function applyPageLayout(
  body: OrderedXmlNode[],
  command: OfficeDocumentPageLayoutCommand
) {
  const section = resolveOrCreateSection(body, command.sectionIndex);
  const key = elementKey(section);
  const children = key ? section[key] : undefined;
  if (!key || !Array.isArray(children)) {
    throw new DocxPackageError('DOCX section properties are invalid');
  }
  const prefix = prefixOf(key);
  const layout = command.layout;
  const pageSize: Record<string, string> = {};
  if (layout.widthPt !== undefined)
    pageSize[qualify(prefix, 'w')] = pointsToTwips(layout.widthPt);
  if (layout.heightPt !== undefined)
    pageSize[qualify(prefix, 'h')] = pointsToTwips(layout.heightPt);
  if (layout.orientation !== undefined)
    pageSize[qualify(prefix, 'orient')] = layout.orientation;
  if (Object.keys(pageSize).length)
    upsertChild(children as OrderedXmlNode[], prefix, 'pgSz', pageSize);
  const margins = Object.fromEntries(
    [
      ['top', layout.marginTopPt],
      ['right', layout.marginRightPt],
      ['bottom', layout.marginBottomPt],
      ['left', layout.marginLeftPt],
      ['header', layout.headerPt],
      ['footer', layout.footerPt],
      ['gutter', layout.gutterPt],
    ]
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .map(([name, value]) => [qualify(prefix, name), pointsToTwips(value)])
  );
  if (Object.keys(margins).length)
    upsertChild(children as OrderedXmlNode[], prefix, 'pgMar', margins);
  if (layout.columns !== undefined) {
    upsertChild(children as OrderedXmlNode[], prefix, 'cols', {
      [qualify(prefix, 'num')]: String(layout.columns),
    });
  }
  if (layout.titlePage !== undefined) {
    setToggle(
      children as OrderedXmlNode[],
      prefix,
      'titlePg',
      layout.titlePage
    );
  }
}

function findContentControl(
  nodes: OrderedXmlNode[],
  targetId: string
): OrderedXmlNode | undefined {
  for (const node of nodes) {
    const key = elementKey(node);
    if (key && localName(key) === 'sdt') {
      const properties = findChild(childrenOf(node), 'sdtPr');
      const idNode = properties
        ? findChild(childrenOf(properties), 'id')
        : undefined;
      const id = idNode ? attributeByLocalName(idNode, 'val') : undefined;
      if (targetId === id || targetId === `content-control:${id}`) return node;
    }
    const found = findContentControl(childrenOf(node), targetId);
    if (found) return found;
  }
  return undefined;
}

function childrenOf(node: OrderedXmlNode) {
  const key = elementKey(node);
  const value = key ? node[key] : undefined;
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

function setContentControlText(
  body: OrderedXmlNode[],
  command: OfficeDocumentContentControlTextCommand
) {
  const control = findContentControl(body, command.contentControlId);
  if (!control) {
    throw new DocxPackageError(
      `DOCX content control not found: ${command.contentControlId}`
    );
  }
  const content = findChild(childrenOf(control), 'sdtContent');
  if (!content)
    throw new DocxPackageError('DOCX content control has no content');
  const key = elementKey(content);
  if (!key) throw new DocxPackageError('DOCX content control is invalid');
  const prefix = prefixOf(key);
  content[key] = [
    nodeWithChildren(prefix, 'p', [
      nodeWithChildren(prefix, 'r', [createTextNode(prefix, command.text)]),
    ]),
  ];
}

function resolveReviewChanges(
  nodes: OrderedXmlNode[],
  command: OfficeDocumentReviewResolveCommand
) {
  const selected = command.changeIds ? new Set(command.changeIds) : undefined;
  let resolved = 0;
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    const key = elementKey(node);
    if (!key) continue;
    const name = localName(key);
    const content = childrenOf(node);
    resolved += resolveReviewChanges(content, command);
    if (!['ins', 'del'].includes(name)) continue;
    const id = attributeByLocalName(node, 'id');
    if (selected && (!id || !selected.has(id))) continue;
    const keep =
      (name === 'ins' && command.action === 'accept') ||
      (name === 'del' && command.action === 'reject');
    nodes.splice(index, 1, ...(keep ? content : []));
    resolved++;
  }
  return resolved;
}

function replaceTextNodes(nodes: OrderedXmlNode[], text: string) {
  const textNodes: OrderedXmlNode[] = [];
  const visit = (items: OrderedXmlNode[]) => {
    for (const node of items) {
      const key = elementKey(node);
      if (key && ['t', 'delText'].includes(localName(key)))
        textNodes.push(node);
      visit(childrenOf(node));
    }
  };
  visit(nodes);
  if (!textNodes.length) return false;
  const first = textNodes[0];
  const key = elementKey(first);
  if (!key) return false;
  first[key] = [{ '#text': text }];
  for (const node of textNodes.slice(1)) {
    const childKey = elementKey(node);
    if (childKey) node[childKey] = [];
  }
  return true;
}

function applyMailMerge(
  xml: OrderedXmlNode[],
  state: DocxSemanticState,
  paragraphElements: ElementRef[],
  command: OfficeDocumentMailMergeCommand
) {
  let mergedFields = 0;
  const visitFields = (nodes: OrderedXmlNode[]) => {
    for (const node of nodes) {
      const key = elementKey(node);
      if (key && localName(key) === 'fldSimple') {
        const instruction = attributeByLocalName(node, 'instr')?.trim() ?? '';
        const match = /^MERGEFIELD\s+(?:"([^"]+)"|(\S+))/i.exec(instruction);
        const fieldName = match?.[1] ?? match?.[2];
        if (
          fieldName &&
          fieldName in command.values &&
          replaceTextNodes(childrenOf(node), command.values[fieldName])
        ) {
          mergedFields++;
        }
      }
      visitFields(childrenOf(node));
    }
  };

  const semanticParagraphs: DocxParagraph[] = [];
  collectSemanticParagraphs(state.body, semanticParagraphs);
  semanticParagraphs.forEach((paragraph, index) => {
    let text = paragraph.text;
    for (const [field, value] of Object.entries(command.values)) {
      text = text
        .replaceAll(`{{${field}}}`, value)
        .replaceAll(`«${field}»`, value);
    }
    if (text !== paragraph.text) {
      replaceParagraphText(paragraphElements[index], paragraph, {
        ...command,
        operation: 'office.document.text.replace',
        target: {
          type: 'text_range',
          start: { blockId: paragraph.id, offset: 0 },
          end: { blockId: paragraph.id, offset: paragraph.text.length },
        },
        text,
      });
      mergedFields++;
    }
  });
  visitFields(xml);
  return mergedFields;
}

const WORD_NAMESPACES = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
} as const;

const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const CHART_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const HEADER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const SETTINGS_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const SETTINGS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const CHART_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const EMU_PER_POINT = 12_700;

function ensureDocumentNamespaces(
  xml: OrderedXmlNode[],
  prefixes: readonly (keyof typeof WORD_NAMESPACES)[]
) {
  const document = findChild(xml, 'document');
  if (!document) throw new DocxPackageError('DOCX document root is invalid');
  const attrs = { ...attributes(document) };
  for (const prefix of prefixes) {
    attrs[`xmlns:${prefix}`] ??= WORD_NAMESPACES[prefix];
  }
  document[':@'] = attrs;
}

function decodeBase64(value: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new DocxPackageError('Office object payload is not valid base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function assertImageBytes(bytes: Uint8Array, mimeType: string) {
  const matches =
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
          new TextDecoder('ascii').decode(bytes.slice(0, 6)) in
            { GIF87a: true, GIF89a: true };
  if (!matches) {
    throw new DocxPackageError(
      `Office object payload does not match ${mimeType}`
    );
  }
}

function nextDrawingId(nodes: OrderedXmlNode[]) {
  let maximum = 0;
  const visit = (items: OrderedXmlNode[]) => {
    for (const node of items) {
      const key = elementKey(node);
      if (key && localName(key) === 'docPr') {
        const value = Number(attributeByLocalName(node, 'id'));
        if (Number.isSafeInteger(value)) maximum = Math.max(maximum, value);
      }
      visit(childrenOf(node));
    }
  };
  visit(nodes);
  return maximum + 1;
}

function insertRunAtOffset(
  paragraph: ElementRef,
  semantic: DocxParagraph,
  offset: number,
  runNode: OrderedXmlNode
) {
  if (
    offset > semantic.text.length ||
    !isUnicodeBoundary(semantic.text, offset)
  ) {
    throw new DocxPackageError('DOCX object target offset is invalid');
  }
  const runs: ElementRef[] = [];
  collectRunElements(paragraph.children, runs);
  const lengths = runs.map(runLogicalLength);
  if (
    lengths.reduce((total, length) => total + length, 0) !==
    semantic.text.length
  ) {
    throw new DocxPackageError(
      `DOCX paragraph text mapping is not editable: ${semantic.id}`
    );
  }
  if (!runs.length) {
    paragraph.children.push(runNode);
    return;
  }
  if (offset === 0) {
    runs[0].parent.splice(runs[0].index, 0, runNode);
    return;
  }
  if (offset === semantic.text.length) {
    const last = runs[runs.length - 1];
    last.parent.splice(last.index + 1, 0, runNode);
    return;
  }
  let running = 0;
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    const length = lengths[index];
    const end = running + length;
    if (offset <= end && length > 0) {
      const localOffset = offset - running;
      if (localOffset === length) {
        run.parent.splice(run.index + 1, 0, runNode);
      } else if (localOffset === 0) {
        run.parent.splice(run.index, 0, runNode);
      } else {
        const replacement = [
          cloneRunSlice(run, 0, localOffset),
          runNode,
          cloneRunSlice(run, localOffset, length),
        ].filter((node): node is OrderedXmlNode => Boolean(node));
        run.parent.splice(run.index, 1, ...replacement);
      }
      return;
    }
    running = end;
  }
  const last = runs[runs.length - 1];
  last.parent.splice(last.index + 1, 0, runNode);
}

function inlineDrawing(
  drawingId: number,
  widthPt: number,
  heightPt: number,
  content: OrderedXmlNode,
  name: string,
  description = ''
) {
  const width = String(Math.round(widthPt * EMU_PER_POINT));
  const height = String(Math.round(heightPt * EMU_PER_POINT));
  return nodeWithChildren('w', 'drawing', [
    nodeWithChildren(
      'wp',
      'inline',
      [
        createElement('wp', 'extent', { cx: width, cy: height }),
        createElement('wp', 'effectExtent', {
          l: '0',
          t: '0',
          r: '0',
          b: '0',
        }),
        createElement('wp', 'docPr', {
          id: String(drawingId),
          name,
          descr: description,
        }),
        nodeWithChildren('wp', 'cNvGraphicFramePr', [
          createElement('a', 'graphicFrameLocks', { noChangeAspect: '1' }),
        ]),
        nodeWithChildren('a', 'graphic', [content]),
      ],
      {
        distT: '0',
        distB: '0',
        distL: '0',
        distR: '0',
      }
    ),
  ]);
}

function imageDrawing(
  relationshipId: string,
  drawingId: number,
  widthPt: number,
  heightPt: number,
  name: string,
  description?: string
) {
  const width = String(Math.round(widthPt * EMU_PER_POINT));
  const height = String(Math.round(heightPt * EMU_PER_POINT));
  return inlineDrawing(
    drawingId,
    widthPt,
    heightPt,
    nodeWithChildren(
      'a',
      'graphicData',
      [
        nodeWithChildren('pic', 'pic', [
          nodeWithChildren('pic', 'nvPicPr', [
            createElement('pic', 'cNvPr', {
              id: String(drawingId),
              name,
              descr: description ?? '',
            }),
            createElement('pic', 'cNvPicPr'),
          ]),
          nodeWithChildren('pic', 'blipFill', [
            createElement('a', 'blip', { 'r:embed': relationshipId }),
            nodeWithChildren('a', 'stretch', [createElement('a', 'fillRect')]),
          ]),
          nodeWithChildren('pic', 'spPr', [
            nodeWithChildren('a', 'xfrm', [
              createElement('a', 'off', { x: '0', y: '0' }),
              createElement('a', 'ext', { cx: width, cy: height }),
            ]),
            nodeWithChildren('a', 'prstGeom', [createElement('a', 'avLst')], {
              prst: 'rect',
            }),
          ]),
        ]),
      ],
      { uri: WORD_NAMESPACES.pic }
    ),
    name,
    description
  );
}

function chartSeriesNode(
  index: number,
  name: string,
  categories: readonly string[],
  values: readonly number[]
) {
  return nodeWithChildren('c', 'ser', [
    createElement('c', 'idx', { val: String(index) }),
    createElement('c', 'order', { val: String(index) }),
    nodeWithChildren('c', 'tx', [
      nodeWithChildren('c', 'strRef', [
        nodeWithChildren('c', 'strCache', [
          createElement('c', 'ptCount', { val: '1' }),
          nodeWithChildren(
            'c',
            'pt',
            [nodeWithChildren('c', 'v', [{ '#text': name }])],
            { idx: '0' }
          ),
        ]),
      ]),
    ]),
    nodeWithChildren('c', 'cat', [
      nodeWithChildren('c', 'strLit', [
        createElement('c', 'ptCount', { val: String(categories.length) }),
        ...categories.map((value, pointIndex) =>
          nodeWithChildren(
            'c',
            'pt',
            [nodeWithChildren('c', 'v', [{ '#text': value }])],
            { idx: String(pointIndex) }
          )
        ),
      ]),
    ]),
    nodeWithChildren('c', 'val', [
      nodeWithChildren('c', 'numLit', [
        nodeWithChildren('c', 'formatCode', [{ '#text': 'General' }]),
        createElement('c', 'ptCount', { val: String(values.length) }),
        ...values.map((value, pointIndex) =>
          nodeWithChildren(
            'c',
            'pt',
            [nodeWithChildren('c', 'v', [{ '#text': String(value) }])],
            { idx: String(pointIndex) }
          )
        ),
      ]),
    ]),
  ]);
}

function chartPart(
  command: DocxInsertedObject<'chart'>,
  partName: string,
  maxXmlPartBytes: number
) {
  const chart = command.object;
  const chartElement =
    chart.chartType === 'pie'
      ? nodeWithChildren('c', 'pieChart', [
          createElement('c', 'varyColors', { val: '1' }),
          ...chart.series.map((series, index) =>
            chartSeriesNode(index, series.name, chart.categories, series.values)
          ),
        ])
      : chart.chartType === 'line'
        ? nodeWithChildren('c', 'lineChart', [
            createElement('c', 'grouping', { val: 'standard' }),
            createElement('c', 'varyColors', { val: '0' }),
            ...chart.series.map((series, index) =>
              chartSeriesNode(
                index,
                series.name,
                chart.categories,
                series.values
              )
            ),
            createElement('c', 'axId', { val: '48963328' }),
            createElement('c', 'axId', { val: '48964864' }),
          ])
        : nodeWithChildren('c', 'barChart', [
            createElement('c', 'barDir', {
              val: chart.chartType === 'bar' ? 'bar' : 'col',
            }),
            createElement('c', 'grouping', { val: 'clustered' }),
            createElement('c', 'varyColors', { val: '0' }),
            ...chart.series.map((series, index) =>
              chartSeriesNode(
                index,
                series.name,
                chart.categories,
                series.values
              )
            ),
            createElement('c', 'axId', { val: '48963328' }),
            createElement('c', 'axId', { val: '48964864' }),
          ]);
  const axes =
    chart.chartType === 'pie'
      ? []
      : [
          nodeWithChildren('c', 'catAx', [
            createElement('c', 'axId', { val: '48963328' }),
            nodeWithChildren('c', 'scaling', [
              createElement('c', 'orientation', { val: 'minMax' }),
            ]),
            createElement('c', 'delete', { val: '0' }),
            createElement('c', 'axPos', { val: 'b' }),
            createElement('c', 'crossAx', { val: '48964864' }),
            createElement('c', 'crosses', { val: 'autoZero' }),
          ]),
          nodeWithChildren('c', 'valAx', [
            createElement('c', 'axId', { val: '48964864' }),
            nodeWithChildren('c', 'scaling', [
              createElement('c', 'orientation', { val: 'minMax' }),
            ]),
            createElement('c', 'delete', { val: '0' }),
            createElement('c', 'axPos', { val: 'l' }),
            createElement('c', 'crossAx', { val: '48963328' }),
            createElement('c', 'crosses', { val: 'autoZero' }),
          ]),
        ];
  const title = chart.title
    ? nodeWithChildren('c', 'title', [
        nodeWithChildren('c', 'tx', [
          nodeWithChildren('c', 'rich', [
            createElement('a', 'bodyPr'),
            createElement('a', 'lstStyle'),
            nodeWithChildren('a', 'p', [
              nodeWithChildren('a', 'r', [
                createElement('a', 'rPr', { lang: 'en-US' }),
                nodeWithChildren('a', 't', [{ '#text': chart.title }]),
              ]),
            ]),
          ]),
        ]),
      ])
    : undefined;
  const root = nodeWithChildren(
    'c',
    'chartSpace',
    [
      createElement('c', 'date1904', { val: '0' }),
      createElement('c', 'lang', { val: 'en-US' }),
      nodeWithChildren('c', 'chart', [
        ...(title ? [title] : []),
        nodeWithChildren('c', 'plotArea', [
          createElement('c', 'layout'),
          chartElement,
          ...axes,
        ]),
        createElement('c', 'plotVisOnly', { val: '1' }),
      ]),
    ],
    {
      'xmlns:c': WORD_NAMESPACES.c,
      'xmlns:a': WORD_NAMESPACES.a,
      'xmlns:r': WORD_NAMESPACES.r,
    }
  );
  return buildPreservedXml([root], partName, maxXmlPartBytes);
}

function chartDrawing(
  relationshipId: string,
  drawingId: number,
  command: DocxInsertedObject<'chart'>
) {
  return inlineDrawing(
    drawingId,
    command.object.widthPt,
    command.object.heightPt,
    nodeWithChildren(
      'a',
      'graphicData',
      [createElement('c', 'chart', { 'r:id': relationshipId })],
      { uri: WORD_NAMESPACES.c }
    ),
    command.object.title || `Chart ${drawingId}`
  );
}

function shapePict(command: DocxInsertedObject<'shape'>, drawingId: number) {
  const shapeType = {
    rectangle: '#_x0000_t202',
    roundedRectangle: '#_x0000_t202',
    ellipse: '#_x0000_t202',
    line: '#_x0000_t32',
  }[command.object.shape];
  const shapeChildren = command.object.text
    ? [
        nodeWithChildren('v', 'textbox', [
          nodeWithChildren('w', 'txbxContent', [
            nodeWithChildren('w', 'p', [
              nodeWithChildren('w', 'r', [
                createTextNode('w', command.object.text),
              ]),
            ]),
          ]),
        ]),
      ]
    : [];
  return nodeWithChildren('w', 'pict', [
    nodeWithChildren('v', 'shape', shapeChildren, {
      id: `_x0000_s${1024 + drawingId}`,
      type: shapeType,
      style: `width:${command.object.widthPt}pt;height:${command.object.heightPt}pt`,
      ...(command.object.shape === 'ellipse' ? { o: 'ellipse' } : {}),
      ...(command.object.fillColor
        ? { fillcolor: command.object.fillColor }
        : {}),
      ...(command.object.lineColor
        ? { strokecolor: command.object.lineColor }
        : {}),
    }),
  ]);
}

function equationNode(linearText: string) {
  return nodeWithChildren('m', 'oMath', [
    nodeWithChildren('m', 'r', [
      nodeWithChildren('m', 't', [{ '#text': linearText }]),
    ]),
  ]);
}

function applyInsertObject(
  pkg: DocxOpcPackage,
  command: OfficeDocumentInsertObjectCommand
) {
  const before = readDocxSemanticState(pkg);
  const xml = parsePreservedXml(
    pkg.requirePart(pkg.documentPart),
    pkg.documentPart,
    pkg.limits.maxXmlPartBytes
  );
  const body = requireRootBody(xml);
  const paragraphElements: ElementRef[] = [];
  collectParagraphElements(body, paragraphElements);
  const target = resolveParagraph(
    before,
    paragraphElements,
    command.target.blockId
  );
  const drawingId = nextDrawingId(xml);
  const additions = new Map<string, Uint8Array>();
  const replacements = new Map<string, Uint8Array>();
  let objectNode: OrderedXmlNode;
  let insertedPart: string | undefined;

  if (command.object.type === 'equation') {
    ensureDocumentNamespaces(xml, ['w', 'm']);
    objectNode = equationNode(command.object.linearText);
  } else if (command.object.type === 'shape') {
    ensureDocumentNamespaces(xml, ['w', 'v', 'o']);
    objectNode = shapePict(command as DocxInsertedObject<'shape'>, drawingId);
  } else {
    ensureDocumentNamespaces(
      xml,
      command.object.type === 'image'
        ? ['w', 'r', 'wp', 'a', 'pic']
        : ['w', 'r', 'wp', 'a', 'c']
    );
    const relationships = pkg.getRelationships(pkg.documentPart);
    const relationshipId = nextOoxmlRelationshipId(relationships);
    const relationshipPart = relationshipPartName(pkg.documentPart);
    let contentTypes = pkg.requirePart('[Content_Types].xml');
    if (command.object.type === 'image') {
      const bytes = decodeBase64(command.object.dataBase64);
      assertImageBytes(bytes, command.object.mimeType);
      const extension =
        command.object.mimeType === 'image/png'
          ? 'png'
          : command.object.mimeType === 'image/jpeg'
            ? 'jpg'
            : 'gif';
      insertedPart = nextOoxmlPartName(
        pkg.listParts().map(part => part.path),
        'word/media',
        'image',
        extension
      );
      contentTypes = ensureOoxmlContentType(
        contentTypes,
        {
          kind: 'default',
          extension,
          contentType: command.object.mimeType,
        },
        pkg.limits.maxXmlPartBytes
      );
      additions.set(insertedPart, bytes);
      objectNode = imageDrawing(
        relationshipId,
        drawingId,
        command.object.widthPt,
        command.object.heightPt,
        command.object.name ?? `Picture ${drawingId}`,
        command.object.description
      );
    } else {
      insertedPart = nextOoxmlPartName(
        pkg.listParts().map(part => part.path),
        'word/charts',
        'chart',
        'xml'
      );
      contentTypes = ensureOoxmlContentType(
        contentTypes,
        {
          kind: 'override',
          partName: insertedPart,
          contentType: CHART_CONTENT_TYPE,
        },
        pkg.limits.maxXmlPartBytes
      );
      additions.set(
        insertedPart,
        chartPart(
          command as DocxInsertedObject<'chart'>,
          insertedPart,
          pkg.limits.maxXmlPartBytes
        )
      );
      objectNode = chartDrawing(
        relationshipId,
        drawingId,
        command as DocxInsertedObject<'chart'>
      );
    }
    replacements.set('[Content_Types].xml', contentTypes);
    const relationshipBytes = appendOoxmlRelationship(
      pkg.readPart(relationshipPart),
      relationshipPart,
      {
        id: relationshipId,
        type:
          command.object.type === 'image'
            ? IMAGE_RELATIONSHIP
            : CHART_RELATIONSHIP,
        target: relativeOoxmlTarget(pkg.documentPart, insertedPart),
      },
      pkg.limits.maxXmlPartBytes
    );
    if (pkg.hasPart(relationshipPart)) {
      replacements.set(relationshipPart, relationshipBytes);
    } else {
      additions.set(relationshipPart, relationshipBytes);
    }
  }

  insertRunAtOffset(
    target.element,
    target.semantic,
    command.target.offset,
    nodeWithChildren('w', 'r', [objectNode])
  );
  replacements.set(
    pkg.documentPart,
    buildPreservedXml(xml, pkg.documentPart, pkg.limits.maxXmlPartBytes)
  );
  const packageBytes = pkg.write(replacements, { additions });
  const state = readDocxSemanticState(
    openDocxPackage(packageBytes, pkg.limits)
  );
  if (state.stats.objects !== before.stats.objects + 1) {
    throw new DocxPackageError('DOCX object insertion output is invalid');
  }
  return {
    packageBytes,
    state,
    summary: {
      operation: command.operation,
      blockId: command.target.blockId,
      offset: command.target.offset,
      objectType: command.object.type,
      insertedPart,
    },
  } satisfies DocxCommandResult;
}

function setHeaderFooterText(
  pkg: DocxOpcPackage,
  state: DocxSemanticState,
  command: OfficeDocumentHeaderFooterTextCommand
) {
  const section = state.sections[command.sectionIndex];
  if (!section && !(command.sectionIndex === 0 && !state.sections.length)) {
    throw new DocxPackageError(
      `DOCX section not found: ${command.sectionIndex}`
    );
  }
  const reference = (
    command.storyKind === 'header'
      ? (section?.headerReferences ?? [])
      : (section?.footerReferences ?? [])
  ).find(candidate => (candidate.type ?? 'default') === command.storyType);
  const replacements = new Map<string, Uint8Array>();
  const additions = new Map<string, Uint8Array>();
  const documentXml = parsePreservedXml(
    pkg.requirePart(pkg.documentPart),
    pkg.documentPart,
    pkg.limits.maxXmlPartBytes
  );
  ensureDocumentNamespaces(documentXml, ['w', 'r']);
  const body = requireRootBody(documentXml);
  const sectionElement = resolveOrCreateSection(body, command.sectionIndex);
  const sectionKey = elementKey(sectionElement);
  const sectionChildren = sectionKey ? sectionElement[sectionKey] : undefined;
  if (!sectionKey || !Array.isArray(sectionChildren)) {
    throw new DocxPackageError('DOCX section properties are invalid');
  }
  const prefix = prefixOf(sectionKey);
  let documentChanged = !section;
  if (command.storyType === 'first') {
    setToggle(sectionChildren as OrderedXmlNode[], prefix, 'titlePg', true);
    documentChanged = true;
  }

  const currentPartBytes = (partName: string) =>
    replacements.get(partName) ??
    additions.get(partName) ??
    pkg.readPart(partName);
  const replaceOrAddPart = (partName: string, bytes: Uint8Array) => {
    if (pkg.hasPart(partName)) replacements.set(partName, bytes);
    else additions.set(partName, bytes);
  };
  const ensureContentType = (partName: string, contentType: string) => {
    const contentTypes =
      replacements.get('[Content_Types].xml') ??
      pkg.requirePart('[Content_Types].xml');
    replacements.set(
      '[Content_Types].xml',
      ensureOoxmlContentType(
        contentTypes,
        { kind: 'override', partName, contentType },
        pkg.limits.maxXmlPartBytes
      )
    );
  };
  const relationshipPart = relationshipPartName(pkg.documentPart);
  const reservedRelationshipIds = new Set(
    pkg.getRelationships(pkg.documentPart).map(relationship => relationship.id)
  );
  const allocateRelationshipId = () => {
    const id = nextOoxmlRelationshipId(
      [...reservedRelationshipIds].map(relationshipId => ({
        id: relationshipId,
      }))
    );
    reservedRelationshipIds.add(id);
    return id;
  };
  const appendDocumentRelationship = (
    id: string,
    type: string,
    targetPart: string
  ) => {
    const relationshipBytes = appendOoxmlRelationship(
      currentPartBytes(relationshipPart),
      relationshipPart,
      {
        id,
        type,
        target: relativeOoxmlTarget(pkg.documentPart, targetPart),
      },
      pkg.limits.maxXmlPartBytes
    );
    replaceOrAddPart(relationshipPart, relationshipBytes);
  };

  if (command.storyType === 'even') {
    const settingsRelationship = pkg
      .getRelationships(pkg.documentPart)
      .find(
        relationship =>
          relationship.targetMode === 'Internal' &&
          relationship.type.endsWith('/settings')
      );
    let settingsPart = settingsRelationship?.resolvedTarget;
    if (!settingsPart) {
      const documentDirectory = pkg.documentPart
        .split('/')
        .slice(0, -1)
        .join('/');
      settingsPart = nextOoxmlPartName(
        pkg.listParts().map(part => part.path),
        documentDirectory,
        'settings',
        'xml'
      );
      appendDocumentRelationship(
        allocateRelationshipId(),
        SETTINGS_RELATIONSHIP,
        settingsPart
      );
    }
    const settingsBytes = currentPartBytes(settingsPart);
    let nextSettings: Uint8Array;
    if (settingsBytes) {
      const settingsXml = parsePreservedXml(
        settingsBytes,
        settingsPart,
        pkg.limits.maxXmlPartBytes
      );
      const settingsRoot = findChild(settingsXml, 'settings');
      const settingsKey = settingsRoot ? elementKey(settingsRoot) : undefined;
      const settingsChildren = settingsKey
        ? settingsRoot?.[settingsKey]
        : undefined;
      if (!settingsRoot || !settingsKey || !Array.isArray(settingsChildren)) {
        throw new DocxPackageError('DOCX settings root is invalid');
      }
      upsertChild(
        settingsChildren as OrderedXmlNode[],
        prefixOf(settingsKey),
        'evenAndOddHeaders'
      );
      nextSettings = buildPreservedXml(
        settingsXml,
        settingsPart,
        pkg.limits.maxXmlPartBytes
      );
    } else {
      nextSettings = buildPreservedXml(
        [
          nodeWithChildren(
            'w',
            'settings',
            [createElement('w', 'evenAndOddHeaders')],
            { 'xmlns:w': WORD_NAMESPACES.w }
          ),
        ],
        settingsPart,
        pkg.limits.maxXmlPartBytes
      );
    }
    replaceOrAddPart(settingsPart, nextSettings);
    ensureContentType(settingsPart, SETTINGS_CONTENT_TYPE);
  }

  let storyPart = reference?.part;
  let created = false;
  if (reference && !storyPart) {
    throw new DocxPackageError('DOCX story relationship target is invalid');
  }
  if (storyPart && pkg.hasPart(storyPart)) {
    const xml = parsePreservedXml(
      pkg.requirePart(storyPart),
      storyPart,
      pkg.limits.maxXmlPartBytes
    );
    const root = xml.find(node => {
      const key = elementKey(node);
      return key
        ? localName(key) === (command.storyKind === 'header' ? 'hdr' : 'ftr')
        : false;
    });
    const key = root ? elementKey(root) : undefined;
    if (!root || !key) throw new DocxPackageError('DOCX story root is invalid');
    const prefix = prefixOf(key);
    root[key] = [
      nodeWithChildren(prefix, 'p', [
        nodeWithChildren(prefix, 'r', [createTextNode(prefix, command.text)]),
      ]),
    ];
    replaceOrAddPart(
      storyPart,
      buildPreservedXml(xml, storyPart, pkg.limits.maxXmlPartBytes)
    );
  } else {
    if (!storyPart) {
      const documentDirectory = pkg.documentPart
        .split('/')
        .slice(0, -1)
        .join('/');
      storyPart = nextOoxmlPartName(
        pkg.listParts().map(part => part.path),
        documentDirectory,
        command.storyKind,
        'xml'
      );
      const relationshipId = allocateRelationshipId();
      const referenceNode = createElement(
        prefix,
        `${command.storyKind}Reference`,
        {
          [qualify(prefix, 'type')]: command.storyType,
          'r:id': relationshipId,
        }
      );
      const referenceInsertion = (
        sectionChildren as OrderedXmlNode[]
      ).findIndex(node => {
        const key = elementKey(node);
        return key
          ? ['footnotePr', 'endnotePr', 'type', 'pgSz'].includes(localName(key))
          : false;
      });
      (sectionChildren as OrderedXmlNode[]).splice(
        referenceInsertion === -1
          ? (sectionChildren as OrderedXmlNode[]).length
          : referenceInsertion,
        0,
        referenceNode
      );
      appendDocumentRelationship(
        relationshipId,
        command.storyKind === 'header'
          ? HEADER_RELATIONSHIP
          : FOOTER_RELATIONSHIP,
        storyPart
      );
      documentChanged = true;
    }
    const storyRootName = command.storyKind === 'header' ? 'hdr' : 'ftr';
    const storyRoot = nodeWithChildren(
      'w',
      storyRootName,
      [
        nodeWithChildren('w', 'p', [
          nodeWithChildren('w', 'r', [createTextNode('w', command.text)]),
        ]),
      ],
      { 'xmlns:w': WORD_NAMESPACES.w }
    );
    replaceOrAddPart(
      storyPart,
      buildPreservedXml([storyRoot], storyPart, pkg.limits.maxXmlPartBytes)
    );
    created = true;
    ensureContentType(
      storyPart,
      command.storyKind === 'header' ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE
    );
  }
  if (documentChanged) {
    replacements.set(
      pkg.documentPart,
      buildPreservedXml(
        documentXml,
        pkg.documentPart,
        pkg.limits.maxXmlPartBytes
      )
    );
  }
  return { replacements, additions, created, part: storyPart };
}

function applyStructuralDocxCommand(
  pkg: DocxOpcPackage,
  command: DocxStructuralCommand
): DocxCommandResult {
  const before = readDocxSemanticState(pkg);
  if (command.operation === 'office.document.header_footer.text.set') {
    const story = setHeaderFooterText(pkg, before, command);
    const packageBytes = pkg.write(story.replacements, {
      additions: story.additions,
    });
    return {
      packageBytes,
      state: readDocxSemanticState(openDocxPackage(packageBytes, pkg.limits)),
      summary: {
        operation: command.operation,
        storyKind: command.storyKind,
        storyType: command.storyType,
        textLength: command.text.length,
        created: story.created,
        part: story.part,
      },
    };
  }

  const xml = parsePreservedXml(
    pkg.requirePart(pkg.documentPart),
    pkg.documentPart,
    pkg.limits.maxXmlPartBytes
  );
  ensureDocumentNamespaces(xml, ['w']);
  const body = requireRootBody(xml);
  const paragraphElements: ElementRef[] = [];
  collectParagraphElements(body, paragraphElements);
  let summary: DocxCommandResult['summary'];
  switch (command.operation) {
    case 'office.document.paragraph.format': {
      const target = resolveParagraph(
        before,
        paragraphElements,
        command.target.blockId
      );
      applyParagraphFormat(target.element, command);
      summary = { operation: command.operation, blockId: target.semantic.id };
      break;
    }
    case 'office.document.break.insert': {
      const target = resolveParagraph(
        before,
        paragraphElements,
        command.target.blockId
      );
      insertBreak(target.element, target.semantic, command);
      summary = {
        operation: command.operation,
        blockId: target.semantic.id,
        offset: command.target.offset,
        breakType: command.breakType,
      };
      break;
    }
    case 'office.document.section.insert': {
      const blockId = insertSection(body, before, paragraphElements, command);
      summary = {
        operation: command.operation,
        blockId,
        sectionType: command.sectionType,
        sourceSectionIndex:
          command.sourceSectionIndex ?? Math.max(0, before.sections.length - 1),
      };
      break;
    }
    case 'office.document.table.insert':
      insertTable(body, before, command);
      summary = {
        operation: command.operation,
        afterBlockId: command.afterBlockId,
        rows: command.rows,
        columns: command.columns,
      };
      break;
    case 'office.document.page.layout.set':
      applyPageLayout(body, command);
      summary = {
        operation: command.operation,
        sectionIndex: command.sectionIndex,
        changedProperties: Object.keys(command.layout),
      };
      break;
    case 'office.document.content_control.text.set':
      setContentControlText(body, command);
      summary = {
        operation: command.operation,
        contentControlId: command.contentControlId,
        textLength: command.text.length,
      };
      break;
    case 'office.document.review.resolve': {
      const resolvedChanges = resolveReviewChanges(body, command);
      if (!resolvedChanges)
        throw new DocxPackageError('DOCX review change not found');
      summary = {
        operation: command.operation,
        action: command.action,
        resolvedChanges,
      };
      break;
    }
    case 'office.document.mail_merge.apply': {
      const mergedFields = applyMailMerge(
        xml,
        before,
        paragraphElements,
        command
      );
      if (!mergedFields)
        throw new DocxPackageError('DOCX mail merge fields not found');
      summary = {
        operation: command.operation,
        mergedFields,
        suppliedFields: Object.keys(command.values).length,
      };
      break;
    }
  }
  const documentBytes = buildPreservedXml(
    xml,
    pkg.documentPart,
    pkg.limits.maxXmlPartBytes
  );
  const packageBytes = pkg.write(new Map([[pkg.documentPart, documentBytes]]));
  return {
    packageBytes,
    state: readDocxSemanticState(openDocxPackage(packageBytes, pkg.limits)),
    summary,
  };
}

export function applyDocxCommand(
  pkg: DocxOpcPackage,
  input: unknown
): DocxCommandResult {
  const command = parseOfficeCommand(input);
  if (command.operation === 'office.document.object.insert') {
    return applyInsertObject(pkg, command);
  }
  if (
    command.operation === 'office.document.paragraph.format' ||
    command.operation === 'office.document.break.insert' ||
    command.operation === 'office.document.section.insert' ||
    command.operation === 'office.document.table.insert' ||
    command.operation === 'office.document.page.layout.set' ||
    command.operation === 'office.document.header_footer.text.set' ||
    command.operation === 'office.document.content_control.text.set' ||
    command.operation === 'office.document.review.resolve' ||
    command.operation === 'office.document.mail_merge.apply'
  ) {
    return applyStructuralDocxCommand(pkg, command);
  }
  if (
    command.operation !== 'office.document.text.format' &&
    command.operation !== 'office.document.text.replace'
  ) {
    throw new DocxPackageError(
      `Expected a DOCX command, received ${command.operation}`
    );
  }
  const before = readDocxSemanticState(pkg);
  const semanticParagraphs: DocxParagraph[] = [];
  collectSemanticParagraphs(before.body, semanticParagraphs);
  const startIndex = semanticParagraphs.findIndex(
    paragraph => paragraph.id === command.target.start.blockId
  );
  const endIndex = semanticParagraphs.findIndex(
    paragraph => paragraph.id === command.target.end.blockId
  );
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    throw new DocxPackageError('DOCX command target range cannot be resolved');
  }
  if (
    command.operation === 'office.document.text.replace' &&
    startIndex !== endIndex
  ) {
    throw new DocxPackageError(
      'DOCX text replacement currently requires one paragraph'
    );
  }
  const startParagraph = semanticParagraphs[startIndex];
  const endParagraph = semanticParagraphs[endIndex];
  if (
    command.target.start.offset > startParagraph.text.length ||
    command.target.end.offset > endParagraph.text.length
  ) {
    throw new DocxPackageError(
      'DOCX command target offset is outside its paragraph'
    );
  }
  if (
    !isUnicodeBoundary(startParagraph.text, command.target.start.offset) ||
    !isUnicodeBoundary(endParagraph.text, command.target.end.offset)
  ) {
    throw new DocxPackageError(
      'DOCX command target offset splits a Unicode surrogate pair'
    );
  }

  const documentBytes = pkg.requirePart(pkg.documentPart);
  const xml = parsePreservedXml(
    documentBytes,
    pkg.documentPart,
    pkg.limits.maxXmlPartBytes
  );
  const paragraphElements: ElementRef[] = [];
  collectParagraphElements(requireRootBody(xml), paragraphElements);
  if (paragraphElements.length !== semanticParagraphs.length) {
    throw new DocxPackageError(
      'DOCX semantic paragraphs do not match the editable XML structure'
    );
  }

  if (command.operation === 'office.document.text.replace') {
    const paragraph = paragraphElements[startIndex];
    const semantic = semanticParagraphs[startIndex];
    if (
      semantic.sourceId &&
      attributeByLocalName(paragraph.node, 'paraId') !== semantic.sourceId
    ) {
      throw new DocxPackageError(
        `DOCX paragraph identity changed while resolving ${semantic.id}`
      );
    }
    const changedRuns = replaceParagraphText(paragraph, semantic, command);
    const updatedDocumentBytes = buildPreservedXml(
      xml,
      pkg.documentPart,
      pkg.limits.maxXmlPartBytes
    );
    const packageBytes = pkg.write(
      new Map([[pkg.documentPart, updatedDocumentBytes]])
    );
    const state = readDocxSemanticState(
      openDocxPackage(packageBytes, pkg.limits)
    );
    const expected = paragraphTexts(before);
    expected[startIndex] = {
      ...expected[startIndex],
      text:
        semantic.text.slice(0, command.target.start.offset) +
        command.text +
        semantic.text.slice(command.target.end.offset),
    };
    if (JSON.stringify(expected) !== JSON.stringify(paragraphTexts(state))) {
      throw new DocxPackageError(
        'DOCX text replacement changed unexpected document text'
      );
    }
    return {
      packageBytes,
      state,
      summary: {
        operation: command.operation,
        changedParagraphs: 1,
        changedRuns,
        deletedCharacters:
          command.target.end.offset - command.target.start.offset,
        insertedCharacters: command.text.length,
      },
    };
  }

  const runFormat = {
    fontFamily: command.format.fontFamily,
    fontSizePt: command.format.fontSizePt,
    textColor: command.format.textColor,
    bold: command.format.bold,
    italic: command.format.italic,
    underline: command.format.underline,
  } satisfies DocxRunFormatCommand;
  const hasRunFormat = Object.values(runFormat).some(
    value => value !== undefined
  );
  let changedParagraphs = 0;
  let changedRuns = 0;
  let splitRuns = 0;

  for (
    let paragraphIndex = startIndex;
    paragraphIndex <= endIndex;
    paragraphIndex++
  ) {
    const semantic = semanticParagraphs[paragraphIndex];
    const paragraph = paragraphElements[paragraphIndex];
    if (
      semantic.sourceId &&
      attributeByLocalName(paragraph.node, 'paraId') !== semantic.sourceId
    ) {
      throw new DocxPackageError(
        `DOCX paragraph identity changed while resolving ${semantic.id}`
      );
    }
    const selectionStart =
      paragraphIndex === startIndex ? command.target.start.offset : 0;
    const selectionEnd =
      paragraphIndex === endIndex
        ? command.target.end.offset
        : semantic.text.length;
    if (selectionStart > selectionEnd) {
      throw new DocxPackageError(
        'DOCX command target range cannot be resolved'
      );
    }
    if (command.format.paragraphStyleId !== undefined) {
      applyParagraphStyle(paragraph, command.format.paragraphStyleId);
    }
    if (hasRunFormat && selectionStart < selectionEnd) {
      const runs: ElementRef[] = [];
      collectRunElements(paragraph.children, runs);
      const lengths = runs.map(runLogicalLength);
      if (
        lengths.reduce((total, length) => total + length, 0) !==
        semantic.text.length
      ) {
        throw new DocxPackageError(
          `DOCX paragraph text mapping is not editable: ${semantic.id}`
        );
      }
      let offset = 0;
      const operations: Array<{
        run: ElementRef;
        start: number;
        end: number;
        full: boolean;
      }> = [];
      runs.forEach((run, index) => {
        const runStart = offset;
        const runEnd = offset + lengths[index];
        offset = runEnd;
        const overlapStart = Math.max(selectionStart, runStart);
        const overlapEnd = Math.min(selectionEnd, runEnd);
        if (overlapStart >= overlapEnd) return;
        operations.push({
          run,
          start: overlapStart - runStart,
          end: overlapEnd - runStart,
          full: overlapStart === runStart && overlapEnd === runEnd,
        });
      });
      for (const operation of operations.reverse()) {
        if (operation.full) applyRunFormat(operation.run, runFormat);
        else {
          splitAndFormatRun(
            operation.run,
            operation.start,
            operation.end,
            runFormat
          );
          splitRuns++;
        }
        changedRuns++;
      }
    }
    changedParagraphs++;
  }

  const updatedDocumentBytes = buildPreservedXml(
    xml,
    pkg.documentPart,
    pkg.limits.maxXmlPartBytes
  );
  const packageBytes = pkg.write(
    new Map([[pkg.documentPart, updatedDocumentBytes]])
  );
  const state = readDocxSemanticState(
    openDocxPackage(packageBytes, pkg.limits)
  );
  if (
    JSON.stringify(paragraphTexts(before)) !==
    JSON.stringify(paragraphTexts(state))
  ) {
    throw new DocxPackageError('DOCX formatting command changed document text');
  }
  return {
    packageBytes,
    state,
    summary: {
      operation: command.operation,
      changedParagraphs,
      changedRuns,
      splitRuns,
    },
  };
}
