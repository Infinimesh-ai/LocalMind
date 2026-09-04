import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export type OrderedXmlNode = Record<string, unknown>;

const xmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: {
    enabled: true,
    maxEntitySize: 1024,
    maxExpansionDepth: 8,
    maxTotalExpansions: 100_000,
    maxExpandedLength: 4 * 1024 * 1024,
    maxEntityCount: 16,
  },
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: 256,
});

const preservedXmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: {
    enabled: true,
    maxEntitySize: 1024,
    maxExpansionDepth: 8,
    maxTotalExpansions: 100_000,
    maxExpandedLength: 4 * 1024 * 1024,
    maxEntityCount: 16,
  },
  ignoreDeclaration: false,
  ignorePiTags: false,
  maxNestedTags: 256,
});

const preservedXmlBuilder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  format: false,
  suppressEmptyNode: true,
});

function decodeXml(bytes: Uint8Array) {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
  }
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function requireSafeXmlText(
  bytes: Uint8Array,
  partName: string,
  maxBytes: number
) {
  if (bytes.byteLength > maxBytes) {
    throw new Error(`DOCX XML part exceeds its byte limit: ${partName}`);
  }

  let xml: string;
  try {
    xml = decodeXml(bytes);
  } catch {
    throw new Error(`DOCX XML part is not valid UTF-8/UTF-16: ${partName}`);
  }
  if (/<!DOCTYPE\b/i.test(xml) || /<!ENTITY\b/i.test(xml)) {
    throw new Error(`DOCX XML declarations are not allowed: ${partName}`);
  }
  return xml;
}

export function parseOrderedXml(
  bytes: Uint8Array,
  partName: string,
  maxBytes: number
): OrderedXmlNode[] {
  const xml = requireSafeXmlText(bytes, partName, maxBytes);

  try {
    const parsed = xmlParser.parse(xml, true);
    if (!Array.isArray(parsed)) {
      throw new Error('root is not an ordered XML node list');
    }
    return parsed as OrderedXmlNode[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid DOCX XML part ${partName}: ${message}`);
  }
}

export function parsePreservedXml(
  bytes: Uint8Array,
  partName: string,
  maxBytes: number
): OrderedXmlNode[] {
  const xml = requireSafeXmlText(bytes, partName, maxBytes);
  try {
    const parsed = preservedXmlParser.parse(xml, true);
    if (!Array.isArray(parsed)) {
      throw new Error('root is not an ordered XML node list');
    }
    return parsed as OrderedXmlNode[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid DOCX XML part ${partName}: ${message}`);
  }
}

export function buildPreservedXml(
  nodes: OrderedXmlNode[],
  partName: string,
  maxBytes: number
) {
  const bytes = new TextEncoder().encode(preservedXmlBuilder.build(nodes));
  if (!bytes.byteLength || bytes.byteLength > maxBytes) {
    throw new Error(`DOCX XML part exceeds its byte limit: ${partName}`);
  }
  return bytes;
}

export function getElementChildren(
  node: OrderedXmlNode,
  elementName: string
): OrderedXmlNode[] {
  const value = node[elementName];
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

export function getAttributes(node: OrderedXmlNode) {
  const value = node[':@'];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

export function getAttribute(node: OrderedXmlNode, name: string) {
  const value = getAttributes(node)[name];
  return typeof value === 'string' ? value : undefined;
}

export function findFirstElement(nodes: OrderedXmlNode[], elementName: string) {
  return nodes.find(node => Array.isArray(node[elementName]));
}

export function findChildElement(nodes: OrderedXmlNode[], elementName: string) {
  return findFirstElement(nodes, elementName);
}

export function getTextContent(nodes: OrderedXmlNode[]) {
  let text = '';
  for (const node of nodes) {
    const value = node['#text'];
    if (typeof value === 'string') text += value;
  }
  return text;
}
