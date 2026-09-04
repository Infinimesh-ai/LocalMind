import { normalizeOpcPartName } from '../docx/path';
import {
  buildPreservedXml,
  type OrderedXmlNode,
  parsePreservedXml,
} from '../docx/xml';
import { OoxmlPackageError } from './package';

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

function children(node: OrderedXmlNode) {
  const key = elementKey(node);
  const value = key ? node[key] : undefined;
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

function createElement(
  prefix: string,
  name: string,
  attrs: Record<string, string> = {}
): OrderedXmlNode {
  return {
    [qualify(prefix, name)]: [],
    ...(Object.keys(attrs).length ? { ':@': attrs } : {}),
  };
}

function requireRoot(nodes: OrderedXmlNode[], name: string, partName: string) {
  const root = nodes.find(node => {
    const key = elementKey(node);
    return key ? localName(key) === name : false;
  });
  if (!root) {
    throw new OoxmlPackageError(`OOXML part has no ${name} root: ${partName}`);
  }
  return root;
}

export type OoxmlRelationshipInput = {
  id: string;
  type: string;
  target: string;
  targetMode?: 'External';
};

export function createEmptyRelationshipPart() {
  return new TextEncoder().encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  );
}

export function appendOoxmlRelationship(
  bytes: Uint8Array | undefined,
  partName: string,
  relationship: OoxmlRelationshipInput,
  maxXmlPartBytes: number
) {
  const source = bytes ?? createEmptyRelationshipPart();
  const nodes = parsePreservedXml(source, partName, maxXmlPartBytes);
  const root = requireRoot(nodes, 'Relationships', partName);
  const rootKey = elementKey(root) ?? 'Relationships';
  const prefix = prefixOf(rootKey);
  const entries = children(root);
  if (
    entries.some(
      node =>
        localName(elementKey(node) ?? '') === 'Relationship' &&
        attribute(node, 'Id') === relationship.id
    )
  ) {
    throw new OoxmlPackageError(
      `OOXML relationship id already exists: ${relationship.id}`
    );
  }
  entries.push(
    createElement(prefix, 'Relationship', {
      Id: relationship.id,
      Type: relationship.type,
      Target: relationship.target,
      ...(relationship.targetMode
        ? { TargetMode: relationship.targetMode }
        : {}),
    })
  );
  return buildPreservedXml(nodes, partName, maxXmlPartBytes);
}

export function removeOoxmlRelationship(
  bytes: Uint8Array,
  partName: string,
  relationshipId: string,
  maxXmlPartBytes: number
) {
  const nodes = parsePreservedXml(bytes, partName, maxXmlPartBytes);
  const root = requireRoot(nodes, 'Relationships', partName);
  const entries = children(root);
  const index = entries.findIndex(
    node =>
      localName(elementKey(node) ?? '') === 'Relationship' &&
      attribute(node, 'Id') === relationshipId
  );
  if (index === -1) {
    throw new OoxmlPackageError(
      `OOXML relationship not found: ${relationshipId}`
    );
  }
  entries.splice(index, 1);
  return buildPreservedXml(nodes, partName, maxXmlPartBytes);
}

export function ensureOoxmlContentType(
  bytes: Uint8Array,
  input:
    | { kind: 'default'; extension: string; contentType: string }
    | { kind: 'override'; partName: string; contentType: string },
  maxXmlPartBytes: number
) {
  const partName = '[Content_Types].xml';
  const nodes = parsePreservedXml(bytes, partName, maxXmlPartBytes);
  const root = requireRoot(nodes, 'Types', partName);
  const rootKey = elementKey(root) ?? 'Types';
  const prefix = prefixOf(rootKey);
  const entries = children(root);
  if (input.kind === 'default') {
    const extension = input.extension.replace(/^\./, '').toLowerCase();
    const existing = entries.find(
      node =>
        localName(elementKey(node) ?? '') === 'Default' &&
        attribute(node, 'Extension')?.toLowerCase() === extension
    );
    if (existing) {
      if (attribute(existing, 'ContentType') !== input.contentType) {
        throw new OoxmlPackageError(
          `OOXML extension has a conflicting content type: ${extension}`
        );
      }
      return bytes.slice();
    }
    entries.unshift(
      createElement(prefix, 'Default', {
        Extension: extension,
        ContentType: input.contentType,
      })
    );
  } else {
    const normalized = normalizeOpcPartName(input.partName, {
      allowLeadingSlash: true,
    });
    const existing = entries.find(
      node =>
        localName(elementKey(node) ?? '') === 'Override' &&
        normalizeOpcPartName(attribute(node, 'PartName') ?? '', {
          allowLeadingSlash: true,
        }) === normalized
    );
    if (existing) {
      if (attribute(existing, 'ContentType') !== input.contentType) {
        throw new OoxmlPackageError(
          `OOXML part has a conflicting content type: ${normalized}`
        );
      }
      return bytes.slice();
    }
    entries.push(
      createElement(prefix, 'Override', {
        PartName: `/${normalized}`,
        ContentType: input.contentType,
      })
    );
  }
  return buildPreservedXml(nodes, partName, maxXmlPartBytes);
}

export function removeOoxmlContentTypeOverride(
  bytes: Uint8Array,
  targetPartName: string,
  maxXmlPartBytes: number
) {
  const partName = '[Content_Types].xml';
  const target = normalizeOpcPartName(targetPartName, {
    allowLeadingSlash: true,
  });
  const nodes = parsePreservedXml(bytes, partName, maxXmlPartBytes);
  const root = requireRoot(nodes, 'Types', partName);
  const entries = children(root);
  const index = entries.findIndex(node => {
    if (localName(elementKey(node) ?? '') !== 'Override') return false;
    const candidate = attribute(node, 'PartName');
    return (
      candidate !== undefined &&
      normalizeOpcPartName(candidate, { allowLeadingSlash: true }) === target
    );
  });
  if (index !== -1) entries.splice(index, 1);
  return buildPreservedXml(nodes, partName, maxXmlPartBytes);
}

export function nextOoxmlRelationshipId(
  relationships: readonly { id: string }[]
) {
  const used = new Set(relationships.map(relationship => relationship.id));
  for (let index = 1; index < 1_000_000; index++) {
    const id = `rId${index}`;
    if (!used.has(id)) return id;
  }
  throw new OoxmlPackageError('OOXML relationship id space is exhausted');
}

export function nextOoxmlPartName(
  existing: Iterable<string>,
  directory: string,
  baseName: string,
  extension: string
) {
  const used = new Set(existing);
  const normalizedDirectory = normalizeOpcPartName(directory, {
    allowDirectory: true,
  });
  const normalizedExtension = extension.replace(/^\./, '');
  for (let index = 1; index < 1_000_000; index++) {
    const candidate = `${normalizedDirectory}/${baseName}${index}.${normalizedExtension}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new OoxmlPackageError('OOXML part name space is exhausted');
}

export function relativeOoxmlTarget(sourcePart: string, targetPart: string) {
  const source = normalizeOpcPartName(sourcePart);
  const target = normalizeOpcPartName(targetPart);
  const sourceDirectory = source.split('/').slice(0, -1);
  const targetSegments = target.split('/');
  let shared = 0;
  while (
    shared < sourceDirectory.length &&
    shared < targetSegments.length &&
    sourceDirectory[shared] === targetSegments[shared]
  ) {
    shared++;
  }
  const relative = [
    ...sourceDirectory.slice(shared).map(() => '..'),
    ...targetSegments.slice(shared),
  ].join('/');
  if (!relative || relative.startsWith('/')) {
    throw new OoxmlPackageError(
      `Cannot create OOXML relationship target: ${source} -> ${target}`
    );
  }
  return relative;
}
