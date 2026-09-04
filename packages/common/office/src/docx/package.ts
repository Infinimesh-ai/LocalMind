import { Unzip, UnzipInflate, unzipSync, type Zippable, zipSync } from 'fflate';

import {
  type DocxContentTypes,
  getDocxPartContentType,
  parseDocxContentTypes,
} from './content-types';
import { normalizeOpcPartName, relationshipPartName } from './path';
import {
  type DocxRelationship,
  parseDocxRelationships,
  relationshipTypeName,
} from './relationships';

export const DOCX_DOCUMENT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
export const OPC_RELATIONSHIPS_CONTENT_TYPE =
  'application/vnd.openxmlformats-package.relationships+xml';

export type DocxPackageLimits = {
  maxPackageBytes: number;
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
  maxXmlPartBytes: number;
};

export const DEFAULT_DOCX_PACKAGE_LIMITS: Readonly<DocxPackageLimits> = {
  maxPackageBytes: 128 * 1024 * 1024,
  maxEntries: 4096,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxEntryUncompressedBytes: 128 * 1024 * 1024,
  maxXmlPartBytes: 32 * 1024 * 1024,
};

export type DocxPackageOptions = Partial<DocxPackageLimits>;

export type DocxPackageWriteOptions = {
  additions?: ReadonlyMap<string, Uint8Array>;
  removals?: ReadonlySet<string>;
};

export type DocxPackagePart = {
  path: string;
  byteSize: number;
  contentType?: string;
  kind: 'xml' | 'relationships' | 'binary';
};

type ZipEntry = {
  path: string;
  directory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  compression: number;
};

export class DocxPackageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocxPackageError';
  }
}

function normalizeLimits(options: DocxPackageOptions): DocxPackageLimits {
  const limits = { ...DEFAULT_DOCX_PACKAGE_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new DocxPackageError(
        `DOCX package limit must be positive: ${name}`
      );
    }
  }
  return limits;
}

function wrapPackageError(error: unknown, context: string): never {
  if (error instanceof DocxPackageError) throw error;
  const cause = error instanceof Error ? error : new Error(String(error));
  throw new DocxPackageError(`${context}: ${cause.message}`, { cause });
}

function preflightZip(data: Uint8Array, limits: DocxPackageLimits) {
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let totalUncompressedBytes = 0;
  try {
    unzipSync(data, {
      filter(file) {
        if (entries.length >= limits.maxEntries) {
          throw new DocxPackageError('DOCX package contains too many entries');
        }
        const directory = file.name.endsWith('/');
        const path = normalizeOpcPartName(file.name, {
          allowDirectory: directory,
        });
        if (seen.has(path)) {
          throw new DocxPackageError(`DOCX package repeats a path: ${path}`);
        }
        seen.add(path);

        if (file.compression !== 0 && file.compression !== 8) {
          throw new DocxPackageError(
            `DOCX package uses unsupported ZIP compression: ${path}`
          );
        }
        if (
          !Number.isSafeInteger(file.size) ||
          !Number.isSafeInteger(file.originalSize) ||
          file.originalSize < 0
        ) {
          throw new DocxPackageError(
            `DOCX package has invalid entry sizes: ${path}`
          );
        }
        if (file.originalSize > limits.maxEntryUncompressedBytes) {
          throw new DocxPackageError(
            `DOCX package entry is too large: ${path}`
          );
        }
        totalUncompressedBytes += file.originalSize;
        if (
          !Number.isSafeInteger(totalUncompressedBytes) ||
          totalUncompressedBytes > limits.maxTotalUncompressedBytes
        ) {
          throw new DocxPackageError(
            'DOCX package exceeds the total uncompressed byte limit'
          );
        }
        entries.push({
          path,
          directory,
          compressedSize: file.size,
          uncompressedSize: file.originalSize,
          compression: file.compression,
        });
        return false;
      },
    });
  } catch (error) {
    wrapPackageError(error, 'Invalid DOCX ZIP directory');
  }
  return entries;
}

function concatenateChunks(chunks: Uint8Array[], byteSize: number) {
  const result = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function extractZip(
  data: Uint8Array,
  inventory: ZipEntry[],
  limits: DocxPackageLimits
) {
  const expected = new Map(inventory.map(entry => [entry.path, entry]));
  const seen = new Set<string>();
  const parts = new Map<string, Uint8Array>();
  let totalUncompressedBytes = 0;

  try {
    const unzip = new Unzip(file => {
      const directory = file.name.endsWith('/');
      const path = normalizeOpcPartName(file.name, {
        allowDirectory: directory,
      });
      const expectedEntry = expected.get(path);
      if (
        !expectedEntry ||
        seen.has(path) ||
        expectedEntry.directory !== directory
      ) {
        throw new DocxPackageError(`DOCX ZIP entry inventory changed: ${path}`);
      }
      seen.add(path);

      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        entryBytes += chunk.byteLength;
        totalUncompressedBytes += chunk.byteLength;
        if (entryBytes > limits.maxEntryUncompressedBytes) {
          file.terminate();
          throw new DocxPackageError(
            `DOCX package entry is too large: ${path}`
          );
        }
        if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
          file.terminate();
          throw new DocxPackageError(
            'DOCX package exceeds the total uncompressed byte limit'
          );
        }
        if (!directory && chunk.byteLength) chunks.push(chunk.slice());
        if (!final) return;
        if (entryBytes !== expectedEntry.uncompressedSize) {
          throw new DocxPackageError(
            `DOCX package entry size changed: ${path}`
          );
        }
        if (!directory) {
          parts.set(path, concatenateChunks(chunks, entryBytes));
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    unzip.push(data, true);
  } catch (error) {
    wrapPackageError(error, 'Invalid DOCX ZIP payload');
  }

  if (seen.size !== inventory.length) {
    throw new DocxPackageError('DOCX ZIP payload does not match its directory');
  }
  return parts;
}

export class DocxOpcPackage {
  readonly contentTypes: DocxContentTypes;
  readonly rootRelationships: readonly DocxRelationship[];
  readonly documentPart: string;
  readonly limits: DocxPackageLimits;

  constructor(
    private readonly partBytes: ReadonlyMap<string, Uint8Array>,
    limits: DocxPackageLimits
  ) {
    this.limits = limits;
    const contentTypesBytes = partBytes.get('[Content_Types].xml');
    const rootRelationshipsBytes = partBytes.get('_rels/.rels');
    if (!contentTypesBytes || !rootRelationshipsBytes) {
      throw new DocxPackageError(
        'DOCX package is missing [Content_Types].xml or _rels/.rels'
      );
    }

    try {
      this.contentTypes = parseDocxContentTypes(
        contentTypesBytes,
        limits.maxXmlPartBytes
      );
      this.rootRelationships = parseDocxRelationships(
        rootRelationshipsBytes,
        '_rels/.rels',
        limits.maxXmlPartBytes
      );
    } catch (error) {
      wrapPackageError(error, 'Invalid DOCX package metadata');
    }

    const officeRelationships = this.rootRelationships.filter(
      relationship =>
        relationshipTypeName(relationship.type) === 'officeDocument'
    );
    if (
      officeRelationships.length !== 1 ||
      officeRelationships[0].targetMode !== 'Internal' ||
      !officeRelationships[0].resolvedTarget
    ) {
      throw new DocxPackageError(
        'DOCX package must contain one internal officeDocument relationship'
      );
    }
    this.documentPart = officeRelationships[0].resolvedTarget;
    if (!partBytes.has(this.documentPart)) {
      throw new DocxPackageError(
        `DOCX package is missing its document part: ${this.documentPart}`
      );
    }
    if (this.getContentType(this.documentPart) !== DOCX_DOCUMENT_CONTENT_TYPE) {
      throw new DocxPackageError(
        `DOCX package has an invalid document content type: ${this.documentPart}`
      );
    }
    for (const partName of partBytes.keys()) {
      if (
        partName !== '[Content_Types].xml' &&
        !this.getContentType(partName)
      ) {
        throw new DocxPackageError(
          `DOCX package part has no declared content type: ${partName}`
        );
      }
      if (
        partName.endsWith('.rels') &&
        this.getContentType(partName) !== OPC_RELATIONSHIPS_CONTENT_TYPE
      ) {
        throw new DocxPackageError(
          `DOCX relationship part has an invalid content type: ${partName}`
        );
      }
    }
  }

  hasPart(partName: string) {
    return this.partBytes.has(normalizeOpcPartName(partName));
  }

  readPart(partName: string) {
    const bytes = this.partBytes.get(normalizeOpcPartName(partName));
    return bytes?.slice();
  }

  requirePart(partName: string) {
    const normalized = normalizeOpcPartName(partName);
    const bytes = this.partBytes.get(normalized);
    if (!bytes) {
      throw new DocxPackageError(
        `DOCX package is missing a part: ${normalized}`
      );
    }
    return bytes.slice();
  }

  getContentType(partName: string) {
    return getDocxPartContentType(this.contentTypes, partName);
  }

  getRelationships(sourcePart: string | null) {
    const partName = relationshipPartName(sourcePart);
    const bytes = this.partBytes.get(partName);
    if (!bytes) return [];
    try {
      return parseDocxRelationships(
        bytes,
        partName,
        this.limits.maxXmlPartBytes
      );
    } catch (error) {
      wrapPackageError(
        error,
        `Invalid DOCX relationships for ${sourcePart ?? '/'}`
      );
    }
  }

  listParts(): DocxPackagePart[] {
    return [...this.partBytes.entries()]
      .map(([path, bytes]) => ({
        path,
        byteSize: bytes.byteLength,
        contentType: this.getContentType(path),
        kind: path.endsWith('.rels')
          ? ('relationships' as const)
          : path.endsWith('.xml') || this.getContentType(path)?.endsWith('+xml')
            ? ('xml' as const)
            : ('binary' as const),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  write(
    replacements: ReadonlyMap<string, Uint8Array> = new Map(),
    options: DocxPackageWriteOptions = {}
  ) {
    const normalizedReplacements = new Map<string, Uint8Array>();
    for (const [partName, bytes] of replacements) {
      const normalized = normalizeOpcPartName(partName);
      if (!this.partBytes.has(normalized)) {
        throw new DocxPackageError(
          `DOCX package cannot replace a missing part: ${normalized}`
        );
      }
      normalizedReplacements.set(normalized, bytes.slice());
    }
    const additions = new Map<string, Uint8Array>();
    for (const [partName, bytes] of options.additions ?? []) {
      const normalized = normalizeOpcPartName(partName);
      if (this.partBytes.has(normalized) || additions.has(normalized)) {
        throw new DocxPackageError(
          `DOCX package cannot add an existing part: ${normalized}`
        );
      }
      additions.set(normalized, bytes.slice());
    }
    const removals = new Set<string>();
    for (const partName of options.removals ?? []) {
      const normalized = normalizeOpcPartName(partName);
      if (!this.partBytes.has(normalized)) {
        throw new DocxPackageError(
          `DOCX package cannot remove a missing part: ${normalized}`
        );
      }
      if (
        normalized === '[Content_Types].xml' ||
        normalized === '_rels/.rels' ||
        normalized === this.documentPart
      ) {
        throw new DocxPackageError(
          `DOCX package cannot remove a required part: ${normalized}`
        );
      }
      removals.add(normalized);
    }
    for (const path of normalizedReplacements.keys()) {
      if (removals.has(path)) {
        throw new DocxPackageError(
          `DOCX package cannot replace and remove the same part: ${path}`
        );
      }
    }
    const outputPaths = [
      ...new Set([...this.partBytes.keys(), ...additions.keys()]),
    ]
      .filter(path => !removals.has(path))
      .sort();
    if (outputPaths.length > this.limits.maxEntries) {
      throw new DocxPackageError('DOCX output contains too many entries');
    }

    const zippable = Object.create(null) as Zippable;
    const mtime = new Date(1980, 0, 1, 0, 0, 0);
    let totalUncompressedBytes = 0;
    for (const partName of outputPaths) {
      const bytes =
        normalizedReplacements.get(partName) ??
        additions.get(partName) ??
        this.partBytes.get(partName);
      if (!bytes) continue;
      if (bytes.byteLength > this.limits.maxEntryUncompressedBytes) {
        throw new DocxPackageError(
          `DOCX package entry is too large: ${partName}`
        );
      }
      totalUncompressedBytes += bytes.byteLength;
      if (totalUncompressedBytes > this.limits.maxTotalUncompressedBytes) {
        throw new DocxPackageError(
          'DOCX package exceeds the total uncompressed byte limit'
        );
      }
      zippable[partName] = [bytes, { level: 6, mtime }];
    }

    let output: Uint8Array;
    try {
      output = zipSync(zippable, { level: 6, mtime });
    } catch (error) {
      wrapPackageError(error, 'Failed to write DOCX ZIP payload');
    }
    if (output.byteLength > this.limits.maxPackageBytes) {
      throw new DocxPackageError(
        'DOCX package exceeds its compressed byte limit'
      );
    }
    return output;
  }
}

export function openDocxPackage(
  input: Uint8Array,
  options: DocxPackageOptions = {}
) {
  const limits = normalizeLimits(options);
  if (!input.byteLength || input.byteLength > limits.maxPackageBytes) {
    throw new DocxPackageError(
      'DOCX package exceeds its compressed byte limit'
    );
  }

  const data = input.slice();
  const inventory = preflightZip(data, limits);
  if (!inventory.length) {
    throw new DocxPackageError('DOCX package contains no entries');
  }
  return new DocxOpcPackage(extractZip(data, inventory, limits), limits);
}
