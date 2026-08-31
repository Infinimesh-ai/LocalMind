import type JSZip from 'jszip';

export type OfficeHtmlResult = {
  html: string;
  fileName: string;
};

const XML_PARSER_ERROR = 'parsererror';
const MAX_OFFICE_XML_CHARACTERS = 20_000_000;
const OFFICE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function officeFileName(file: Blob, extension: RegExp) {
  const name = 'name' in file && typeof file.name === 'string' ? file.name : '';
  return name.replace(extension, '') || 'Imported Office file';
}

export function parseOfficeXml(xml: string, partName: string) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = Array.from(document.getElementsByTagName('*')).find(
    element => element.localName === XML_PARSER_ERROR
  );
  if (parserError) {
    throw new Error(`The Office file contains invalid XML in ${partName}.`);
  }
  return document;
}

export function readOfficeXml(
  archive: JSZip,
  partName: string,
  required?: true
): Promise<Document>;
export function readOfficeXml(
  archive: JSZip,
  partName: string,
  required: false
): Promise<Document | null>;
export async function readOfficeXml(
  archive: JSZip,
  partName: string,
  required = true
) {
  const entry = archive.file(partName);
  if (!entry) {
    if (required) {
      throw new Error(`The Office file is missing ${partName}.`);
    }
    return null;
  }
  const xml = await entry.async('text');
  if (xml.length > MAX_OFFICE_XML_CHARACTERS) {
    throw new Error(`The Office file part ${partName} is too large to import.`);
  }
  return parseOfficeXml(xml, partName);
}

export function elementsByLocalName(
  root: Document | Element,
  localName: string
) {
  return Array.from(root.getElementsByTagName('*')).filter(
    element => element.localName === localName
  );
}

export function directChildrenByLocalName(
  root: Document | Element,
  localName: string
) {
  return Array.from(root.children).filter(
    element => element.localName === localName
  );
}

export function firstElementByLocalName(
  root: Document | Element,
  localName: string
) {
  return elementsByLocalName(root, localName)[0] ?? null;
}

export function textFromRuns(root: Document | Element) {
  return elementsByLocalName(root, 't')
    .map(element => element.textContent ?? '')
    .join('');
}

export function relationshipTargets(document: Document) {
  const relationships = new Map<string, string>();
  for (const relationship of elementsByLocalName(document, 'Relationship')) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    const targetMode = relationship.getAttribute('TargetMode');
    if (id && target && targetMode !== 'External') {
      relationships.set(id, target);
    }
  }
  return relationships;
}

export function relationshipId(element: Element) {
  return (
    element.getAttributeNS(OFFICE_RELATIONSHIPS_NAMESPACE, 'id') ??
    element.getAttribute('r:id') ??
    Array.from(element.attributes).find(attribute =>
      attribute.name.endsWith(':id')
    )?.value ??
    null
  );
}

export function resolveOfficePart(sourcePart: string, target: string) {
  if (target.startsWith('/')) {
    return target.slice(1);
  }

  const segments = sourcePart.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) {
        throw new Error('The Office file contains an invalid relationship.');
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

export function createOfficeHtmlDocument() {
  return new DOMParser().parseFromString(
    '<!doctype html><html><body></body></html>',
    'text/html'
  );
}
