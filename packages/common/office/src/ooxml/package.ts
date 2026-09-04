import { Unzip, UnzipInflate, unzipSync, type Zippable, zipSync } from 'fflate';

import {
  type DocxContentTypes,
  getDocxPartContentType,
  parseDocxContentTypes,
} from '../docx/content-types';
import { normalizeOpcPartName, relationshipPartName } from '../docx/path';
import {
  type DocxRelationship,
  parseDocxRelationships,
  relationshipTypeName,
} from '../docx/relationships';

export const OPC_RELATIONSHIPS_CONTENT_TYPE =
  'application/vnd.openxmlformats-package.relationships+xml';

export type OoxmlPackageLimits = {
  maxPackageBytes: number;
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
  maxXmlPartBytes: number;
};

export const DEFAULT_OOXML_PACKAGE_LIMITS: Readonly<OoxmlPackageLimits> = {
  maxPackageBytes: 256 * 1024 * 1024,
  maxEntries: 16_384,
  maxTotalUncompressedBytes: 1024 * 1024 * 1024,
  maxEntryUncompressedBytes: 256 * 1024 * 1024,
  maxXmlPartBytes: 64 * 1024 * 1024,
};

export type OoxmlPackageOptions = Partial<OoxmlPackageLimits> & {
  expectedMainContentType: string;
  format: 'xlsx' | 'pptx';
};

export type OoxmlPackageWriteOptions = {
  additions?: ReadonlyMap<string, Uint8Array>;
  removals?: ReadonlySet<string>;
};

type ZipEntry = {
  path: string;
  directory: boolean;
  uncompressedSize: number;
};

export class OoxmlPackageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OoxmlPackageError';
  }
}

function normalizeLimits(options: OoxmlPackageOptions): OoxmlPackageLimits {
  const limits = { ...DEFAULT_OOXML_PACKAGE_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (name === 'format' || name === 'expectedMainContentType') continue;
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      throw new OoxmlPackageError(
        `OOXML package limit must be positive: ${name}`
      );
    }
  }
  return limits;
}

function wrapError(error: unknown, context: string): never {
  if (error instanceof OoxmlPackageError) throw error;
  const cause = error instanceof Error ? error : new Error(String(error));
  throw new OoxmlPackageError(`${context}: ${cause.message}`, { cause });
}

function inventoryZip(data: Uint8Array, limits: OoxmlPackageLimits) {
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  try {
    unzipSync(data, {
      filter(file) {
        if (entries.length >= limits.maxEntries) {
          throw new OoxmlPackageError(
            'OOXML package contains too many entries'
          );
        }
        const directory = file.name.endsWith('/');
        const path = normalizeOpcPartName(file.name, {
          allowDirectory: directory,
        });
        if (seen.has(path)) {
          throw new OoxmlPackageError(`OOXML package repeats a path: ${path}`);
        }
        seen.add(path);
        if (file.compression !== 0 && file.compression !== 8) {
          throw new OoxmlPackageError(
            `OOXML package uses unsupported ZIP compression: ${path}`
          );
        }
        if (
          !Number.isSafeInteger(file.originalSize) ||
          file.originalSize < 0 ||
          file.originalSize > limits.maxEntryUncompressedBytes
        ) {
          throw new OoxmlPackageError(
            `OOXML package entry is too large: ${path}`
          );
        }
        total += file.originalSize;
        if (
          !Number.isSafeInteger(total) ||
          total > limits.maxTotalUncompressedBytes
        ) {
          throw new OoxmlPackageError(
            'OOXML package exceeds the total uncompressed byte limit'
          );
        }
        entries.push({ path, directory, uncompressedSize: file.originalSize });
        return false;
      },
    });
  } catch (error) {
    wrapError(error, 'Invalid OOXML ZIP directory');
  }
  return entries;
}

function concat(chunks: Uint8Array[], byteSize: number) {
  const bytes = new Uint8Array(byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function extractZip(
  data: Uint8Array,
  inventory: readonly ZipEntry[],
  limits: OoxmlPackageLimits
) {
  const expected = new Map(inventory.map(entry => [entry.path, entry]));
  const seen = new Set<string>();
  const parts = new Map<string, Uint8Array>();
  let total = 0;
  try {
    const unzip = new Unzip(file => {
      const directory = file.name.endsWith('/');
      const path = normalizeOpcPartName(file.name, {
        allowDirectory: directory,
      });
      const entry = expected.get(path);
      if (!entry || seen.has(path) || entry.directory !== directory) {
        throw new OoxmlPackageError(
          `OOXML ZIP entry inventory changed: ${path}`
        );
      }
      seen.add(path);
      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        entryBytes += chunk.byteLength;
        total += chunk.byteLength;
        if (entryBytes > limits.maxEntryUncompressedBytes) {
          file.terminate();
          throw new OoxmlPackageError(
            `OOXML package entry is too large: ${path}`
          );
        }
        if (total > limits.maxTotalUncompressedBytes) {
          file.terminate();
          throw new OoxmlPackageError(
            'OOXML package exceeds the total uncompressed byte limit'
          );
        }
        if (!directory && chunk.byteLength) chunks.push(chunk.slice());
        if (!final) return;
        if (entryBytes !== entry.uncompressedSize) {
          throw new OoxmlPackageError(
            `OOXML package entry size changed: ${path}`
          );
        }
        if (!directory) parts.set(path, concat(chunks, entryBytes));
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    unzip.push(data, true);
  } catch (error) {
    wrapError(error, 'Invalid OOXML ZIP payload');
  }
  if (seen.size !== inventory.length) {
    throw new OoxmlPackageError(
      'OOXML ZIP payload does not match its directory'
    );
  }
  return parts;
}

export class OoxmlOpcPackage {
  readonly contentTypes: DocxContentTypes;
  readonly rootRelationships: readonly DocxRelationship[];
  readonly mainPart: string;

  constructor(
    private readonly partBytes: ReadonlyMap<string, Uint8Array>,
    readonly limits: OoxmlPackageLimits,
    readonly format: 'xlsx' | 'pptx',
    expectedMainContentType: string
  ) {
    const contentTypesBytes = partBytes.get('[Content_Types].xml');
    const rootRelationshipsBytes = partBytes.get('_rels/.rels');
    if (!contentTypesBytes || !rootRelationshipsBytes) {
      throw new OoxmlPackageError(
        'OOXML package is missing [Content_Types].xml or _rels/.rels'
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
      wrapError(error, 'Invalid OOXML package metadata');
    }
    const officeDocuments = this.rootRelationships.filter(
      relationship =>
        relationshipTypeName(relationship.type) === 'officeDocument'
    );
    if (
      officeDocuments.length !== 1 ||
      officeDocuments[0].targetMode !== 'Internal' ||
      !officeDocuments[0].resolvedTarget
    ) {
      throw new OoxmlPackageError(
        'OOXML package must contain one internal officeDocument relationship'
      );
    }
    this.mainPart = officeDocuments[0].resolvedTarget;
    if (!partBytes.has(this.mainPart)) {
      throw new OoxmlPackageError(
        `OOXML package is missing its main part: ${this.mainPart}`
      );
    }
    if (this.getContentType(this.mainPart) !== expectedMainContentType) {
      throw new OoxmlPackageError(
        `OOXML package has an invalid main content type: ${this.mainPart}`
      );
    }
    for (const path of partBytes.keys()) {
      if (path !== '[Content_Types].xml' && !this.getContentType(path)) {
        throw new OoxmlPackageError(
          `OOXML package part has no declared content type: ${path}`
        );
      }
      if (
        path.endsWith('.rels') &&
        this.getContentType(path) !== OPC_RELATIONSHIPS_CONTENT_TYPE
      ) {
        throw new OoxmlPackageError(
          `OOXML relationship part has an invalid content type: ${path}`
        );
      }
    }
  }

  hasPart(path: string) {
    return this.partBytes.has(normalizeOpcPartName(path));
  }

  readPart(path: string) {
    return this.partBytes.get(normalizeOpcPartName(path))?.slice();
  }

  requirePart(path: string) {
    const normalized = normalizeOpcPartName(path);
    const bytes = this.partBytes.get(normalized);
    if (!bytes)
      throw new OoxmlPackageError(
        `OOXML package is missing a part: ${normalized}`
      );
    return bytes.slice();
  }

  getContentType(path: string) {
    return getDocxPartContentType(this.contentTypes, path);
  }

  getRelationships(sourcePart: string | null) {
    const part = relationshipPartName(sourcePart);
    const bytes = this.partBytes.get(part);
    if (!bytes) return [];
    try {
      return parseDocxRelationships(bytes, part, this.limits.maxXmlPartBytes);
    } catch (error) {
      wrapError(error, `Invalid OOXML relationships for ${sourcePart ?? '/'}`);
    }
  }

  listParts() {
    return [...this.partBytes.entries()]
      .map(([path, bytes]) => ({
        path,
        byteSize: bytes.byteLength,
        contentType: this.getContentType(path),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  write(
    replacements: ReadonlyMap<string, Uint8Array> = new Map(),
    options: OoxmlPackageWriteOptions = {}
  ) {
    const normalized = new Map<string, Uint8Array>();
    for (const [path, bytes] of replacements) {
      const part = normalizeOpcPartName(path);
      if (!this.partBytes.has(part)) {
        throw new OoxmlPackageError(
          `OOXML package cannot replace a missing part: ${part}`
        );
      }
      normalized.set(part, bytes.slice());
    }
    const additions = new Map<string, Uint8Array>();
    for (const [path, bytes] of options.additions ?? []) {
      const part = normalizeOpcPartName(path);
      if (this.partBytes.has(part) || additions.has(part)) {
        throw new OoxmlPackageError(
          `OOXML package cannot add an existing part: ${part}`
        );
      }
      additions.set(part, bytes.slice());
    }
    const removals = new Set<string>();
    for (const path of options.removals ?? []) {
      const part = normalizeOpcPartName(path);
      if (!this.partBytes.has(part)) {
        throw new OoxmlPackageError(
          `OOXML package cannot remove a missing part: ${part}`
        );
      }
      if (
        part === '[Content_Types].xml' ||
        part === '_rels/.rels' ||
        part === this.mainPart
      ) {
        throw new OoxmlPackageError(
          `OOXML package cannot remove a required part: ${part}`
        );
      }
      removals.add(part);
    }
    for (const path of normalized.keys()) {
      if (removals.has(path)) {
        throw new OoxmlPackageError(
          `OOXML package cannot replace and remove the same part: ${path}`
        );
      }
    }
    const outputPaths = [
      ...new Set([...this.partBytes.keys(), ...additions.keys()]),
    ]
      .filter(path => !removals.has(path))
      .sort();
    if (outputPaths.length > this.limits.maxEntries) {
      throw new OoxmlPackageError('OOXML output contains too many entries');
    }
    const zippable = Object.create(null) as Zippable;
    const mtime = new Date(1980, 0, 1, 0, 0, 0);
    let total = 0;
    for (const path of outputPaths) {
      const bytes =
        normalized.get(path) ?? additions.get(path) ?? this.partBytes.get(path);
      if (!bytes) continue;
      total += bytes.byteLength;
      if (
        bytes.byteLength > this.limits.maxEntryUncompressedBytes ||
        total > this.limits.maxTotalUncompressedBytes
      ) {
        throw new OoxmlPackageError('OOXML output exceeds its byte limits');
      }
      zippable[path] = [bytes, { level: 6, mtime }];
    }
    const output = zipSync(zippable, { level: 6, mtime });
    if (output.byteLength > this.limits.maxPackageBytes) {
      throw new OoxmlPackageError(
        'OOXML output exceeds its compressed byte limit'
      );
    }
    return output;
  }
}

export function openOoxmlPackage(
  input: Uint8Array,
  options: OoxmlPackageOptions
) {
  const limits = normalizeLimits(options);
  if (!input.byteLength || input.byteLength > limits.maxPackageBytes) {
    throw new OoxmlPackageError(
      'OOXML package exceeds its compressed byte limit'
    );
  }
  const data = input.slice();
  const inventory = inventoryZip(data, limits);
  if (!inventory.length)
    throw new OoxmlPackageError('OOXML package contains no entries');
  return new OoxmlOpcPackage(
    extractZip(data, inventory, limits),
    limits,
    options.format,
    options.expectedMainContentType
  );
}
