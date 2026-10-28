import { relationshipPartName } from '../docx/path';
import { relationshipTypeName } from '../docx/relationships';
import {
  buildPreservedXml,
  type OrderedXmlNode,
  parsePreservedXml,
} from '../docx/xml';
import {
  appendOoxmlRelationship,
  ensureOoxmlContentType,
  relativeOoxmlTarget,
  removeOoxmlRelationship,
} from '../ooxml';
import { openXlsxPackage, type XlsxPackageOptions } from './package';

export const XLSX_COMPATIBILITY_EXPORT_VERSION = 'xlsx-compatibility/v1';
const RELATIONSHIPS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export class XlsxCompatibilityError extends Error {}

function elementKey(node: OrderedXmlNode) {
  return Object.keys(node).find(
    key => key !== ':@' && !key.startsWith('#') && !key.startsWith('?')
  );
}

function hasUnboundRelationship(
  nodes: OrderedXmlNode[],
  inherited = false
): boolean {
  return nodes.some(node => {
    const attrs = (node[':@'] ?? {}) as Record<string, string>;
    const bound = 'xmlns:r' in attrs ? !!attrs['xmlns:r'] : inherited;
    const key = elementKey(node);
    return (
      (!bound && Object.keys(attrs).some(name => name.startsWith('r:'))) ||
      (!!key &&
        Array.isArray(node[key]) &&
        hasUnboundRelationship(node[key] as OrderedXmlNode[], bound))
    );
  });
}

/** Derive a download from immutable bytes; never run an editing command or recalculate cells. */
export function exportXlsxCompatibilityCopy(
  input: Uint8Array,
  options: XlsxPackageOptions = {}
) {
  const pkg = openXlsxPackage(input, options);
  const replacements = new Map<string, Uint8Array>();
  const additions = new Map<string, Uint8Array>();
  const relationships = pkg.getRelationships(pkg.mainPart);
  for (const sheet of relationships.filter(
    item => relationshipTypeName(item.type) === 'worksheet'
  )) {
    if (!sheet.resolvedTarget || sheet.targetMode === 'External')
      throw new XlsxCompatibilityError('Unsupported worksheet relationship');
    const xml = parsePreservedXml(
      pkg.requirePart(sheet.resolvedTarget),
      sheet.resolvedTarget,
      pkg.limits.maxXmlPartBytes
    );
    if (!hasUnboundRelationship(xml)) continue;
    const root = xml.find(
      node => elementKey(node)?.split(':').at(-1) === 'worksheet'
    );
    if (!root) throw new XlsxCompatibilityError('Invalid worksheet root');
    const attrs = (root[':@'] ?? {}) as Record<string, string>;
    // Existing namespace bindings, including local overrides, belong to the source.
    if ('xmlns:r' in attrs)
      throw new XlsxCompatibilityError('Ambiguous worksheet namespace');
    root[':@'] = { ...attrs, 'xmlns:r': RELATIONSHIPS };
    if (hasUnboundRelationship(xml))
      throw new XlsxCompatibilityError('Ambiguous worksheet namespace');
    replacements.set(
      sheet.resolvedTarget,
      buildPreservedXml(xml, sheet.resolvedTarget, pkg.limits.maxXmlPartBytes)
    );
  }

  const styles = relationships.filter(
    item => relationshipTypeName(item.type) === 'styles'
  );
  if (styles.length > 1)
    throw new XlsxCompatibilityError('Ambiguous styles relationships');
  const style = styles[0];
  if (
    style?.resolvedTarget &&
    /^xl\/styles\d+\.xml$/.test(style.resolvedTarget)
  ) {
    const bytes = pkg.requirePart(style.resolvedTarget);
    const canonical = pkg.readPart('xl/styles.xml');
    if (
      canonical &&
      (canonical.length !== bytes.length ||
        canonical.some((byte, index) => byte !== bytes[index]))
    )
      throw new XlsxCompatibilityError('Conflicting conventional styles part');
    if (!canonical) additions.set('xl/styles.xml', bytes);
    const part = relationshipPartName(pkg.mainPart);
    replacements.set(
      part,
      appendOoxmlRelationship(
        removeOoxmlRelationship(
          pkg.requirePart(part),
          part,
          style.id,
          pkg.limits.maxXmlPartBytes
        ),
        part,
        {
          id: style.id,
          type: style.type,
          target: relativeOoxmlTarget(pkg.mainPart, 'xl/styles.xml'),
        },
        pkg.limits.maxXmlPartBytes
      )
    );
    replacements.set(
      '[Content_Types].xml',
      ensureOoxmlContentType(
        pkg.requirePart('[Content_Types].xml'),
        {
          kind: 'override',
          partName: 'xl/styles.xml',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
        },
        pkg.limits.maxXmlPartBytes
      )
    );
  }
  const changed = replacements.size + additions.size > 0;
  if (
    changed &&
    pkg.listParts().some(part => part.path.startsWith('_xmlsignatures/'))
  )
    throw new XlsxCompatibilityError(
      'Signed workbooks cannot be repaired without invalidating signatures'
    );
  return {
    bytes: changed ? pkg.write(replacements, { additions }) : input.slice(),
    changed,
    version: XLSX_COMPATIBILITY_EXPORT_VERSION,
    repairedParts: [...replacements.keys(), ...additions.keys()],
  };
}
