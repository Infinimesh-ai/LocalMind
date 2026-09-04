const MAX_OPC_PART_NAME_LENGTH = 2048;

export function normalizeOpcPartName(
  input: string,
  options: { allowLeadingSlash?: boolean; allowDirectory?: boolean } = {}
) {
  if (
    !input ||
    input.length > MAX_OPC_PART_NAME_LENGTH ||
    input.includes('\0') ||
    input.includes('\\')
  ) {
    throw new Error(`Invalid OPC part name: ${input}`);
  }

  let name = input;
  if (options.allowLeadingSlash && name.startsWith('/')) {
    name = name.slice(1);
  }
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`Invalid OPC part name: ${input}`);
  }

  if (options.allowDirectory && name.endsWith('/')) {
    name = name.slice(0, -1);
  }
  const segments = name.split('/');
  if (
    !name ||
    segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid OPC part name: ${input}`);
  }
  return segments.join('/');
}

export function relationshipPartName(sourcePart: string | null) {
  if (!sourcePart) return '_rels/.rels';
  const normalized = normalizeOpcPartName(sourcePart);
  const slash = normalized.lastIndexOf('/');
  const directory = slash === -1 ? '' : normalized.slice(0, slash + 1);
  const fileName = slash === -1 ? normalized : normalized.slice(slash + 1);
  return `${directory}_rels/${fileName}.rels`;
}

export function sourcePartNameFromRelationshipPart(
  relationshipPart: string
): string | null {
  const normalized = normalizeOpcPartName(relationshipPart);
  if (normalized === '_rels/.rels') return null;

  if (normalized.startsWith('_rels/') && normalized.endsWith('.rels')) {
    const fileName = normalized.slice('_rels/'.length, -'.rels'.length);
    if (!fileName || fileName.includes('/')) {
      throw new Error(
        `Invalid OPC relationship part name: ${relationshipPart}`
      );
    }
    return normalizeOpcPartName(fileName);
  }

  const marker = '/_rels/';
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1 || !normalized.endsWith('.rels')) {
    throw new Error(`Invalid OPC relationship part name: ${relationshipPart}`);
  }
  const directory = normalized.slice(0, markerIndex);
  const fileName = normalized.slice(markerIndex + marker.length, -5);
  return normalizeOpcPartName(
    directory ? `${directory}/${fileName}` : fileName
  );
}

export function resolveRelationshipTarget(
  sourcePart: string | null,
  target: string
) {
  const targetPath = target.split(/[?#]/, 1)[0];
  if (
    !targetPath ||
    targetPath.includes('\\') ||
    /^[A-Za-z][\w+.-]*:/.test(targetPath)
  ) {
    throw new Error(`Invalid internal OPC relationship target: ${target}`);
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(targetPath);
  } catch {
    throw new Error(`Invalid encoded OPC relationship target: ${target}`);
  }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) {
    throw new Error(`Invalid internal OPC relationship target: ${target}`);
  }

  const absolute = decoded.startsWith('/');
  const baseSegments =
    absolute || !sourcePart
      ? []
      : normalizeOpcPartName(sourcePart).split('/').slice(0, -1);
  const targetSegments = decoded.replace(/^\//, '').split('/');
  for (const segment of targetSegments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!baseSegments.length) {
        throw new Error(
          `OPC relationship target escapes the package: ${target}`
        );
      }
      baseSegments.pop();
      continue;
    }
    baseSegments.push(segment);
  }
  return normalizeOpcPartName(baseSegments.join('/'));
}
