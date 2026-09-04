import { normalizeOpcPartName } from './path';
import {
  findFirstElement,
  getAttribute,
  getElementChildren,
  parseOrderedXml,
} from './xml';

export type DocxContentTypes = {
  defaults: Readonly<Record<string, string>>;
  overrides: Readonly<Record<string, string>>;
};

export function parseDocxContentTypes(
  bytes: Uint8Array,
  maxXmlPartBytes: number
): DocxContentTypes {
  const nodes = parseOrderedXml(bytes, '[Content_Types].xml', maxXmlPartBytes);
  const root = findFirstElement(nodes, 'Types');
  if (!root) throw new Error('DOCX package is missing the Types XML root');

  const defaults: Record<string, string> = {};
  const overrides: Record<string, string> = {};
  for (const child of getElementChildren(root, 'Types')) {
    if ('Default' in child) {
      const extension = getAttribute(child, 'Extension')?.toLowerCase();
      const contentType = getAttribute(child, 'ContentType');
      if (!extension || !contentType || defaults[extension]) {
        throw new Error('DOCX package has an invalid default content type');
      }
      defaults[extension] = contentType;
    } else if ('Override' in child) {
      const partName = getAttribute(child, 'PartName');
      const contentType = getAttribute(child, 'ContentType');
      if (!partName || !contentType) {
        throw new Error('DOCX package has an invalid override content type');
      }
      const normalized = normalizeOpcPartName(partName, {
        allowLeadingSlash: true,
      });
      if (overrides[normalized]) {
        throw new Error(`DOCX package repeats a content type: ${normalized}`);
      }
      overrides[normalized] = contentType;
    }
  }
  return { defaults, overrides };
}

export function getDocxPartContentType(
  contentTypes: DocxContentTypes,
  partName: string
) {
  const normalized = normalizeOpcPartName(partName);
  const override = contentTypes.overrides[normalized];
  if (override) return override;
  const dot = normalized.lastIndexOf('.');
  if (dot === -1) return undefined;
  return contentTypes.defaults[normalized.slice(dot + 1).toLowerCase()];
}
