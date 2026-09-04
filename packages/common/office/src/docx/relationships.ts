import {
  resolveRelationshipTarget,
  sourcePartNameFromRelationshipPart,
} from './path';
import {
  findFirstElement,
  getAttribute,
  getElementChildren,
  parseOrderedXml,
} from './xml';

export type DocxRelationship = {
  id: string;
  type: string;
  target: string;
  targetMode: 'Internal' | 'External';
  resolvedTarget?: string;
};

export function parseDocxRelationships(
  bytes: Uint8Array,
  relationshipPart: string,
  maxXmlPartBytes: number
) {
  const nodes = parseOrderedXml(bytes, relationshipPart, maxXmlPartBytes);
  const root = findFirstElement(nodes, 'Relationships');
  if (!root) {
    throw new Error(
      `DOCX relationship part is missing its XML root: ${relationshipPart}`
    );
  }

  const sourcePart = sourcePartNameFromRelationshipPart(relationshipPart);
  const seenIds = new Set<string>();
  const relationships: DocxRelationship[] = [];
  for (const node of getElementChildren(root, 'Relationships')) {
    if (!('Relationship' in node)) continue;
    const id = getAttribute(node, 'Id');
    const type = getAttribute(node, 'Type');
    const target = getAttribute(node, 'Target');
    const rawTargetMode = getAttribute(node, 'TargetMode');
    const normalizedTargetMode = rawTargetMode?.toLowerCase();
    if (
      !id ||
      id.length > 512 ||
      !type ||
      type.length > 2048 ||
      !target ||
      target.length > 8192 ||
      seenIds.has(id) ||
      (normalizedTargetMode !== undefined &&
        normalizedTargetMode !== 'internal' &&
        normalizedTargetMode !== 'external')
    ) {
      throw new Error(`DOCX relationship is invalid: ${relationshipPart}`);
    }
    seenIds.add(id);

    const external = normalizedTargetMode === 'external';
    relationships.push({
      id,
      type,
      target,
      targetMode: external ? 'External' : 'Internal',
      resolvedTarget: external
        ? undefined
        : resolveRelationshipTarget(sourcePart, target),
    });
  }
  return relationships;
}

export function relationshipTypeName(type: string) {
  const slash = type.lastIndexOf('/');
  return slash === -1 ? type : type.slice(slash + 1);
}
