import { randomUUID } from 'node:crypto';

import { assertOfficePackageMimeType } from '@localmind/office';
import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  OfficeArtifactKind,
  OfficeRevisionOrigin,
  Prisma,
} from '@prisma/client';

import { BaseModel } from './base';

const MAX_TITLE_LENGTH = 512;
const MAX_FILE_NAME_LENGTH = 512;
const MAX_MIME_TYPE_LENGTH = 256;
const MAX_KEY_LENGTH = 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_FINGERPRINT_LENGTH = 128;
const MAX_MODEL_VERSION_LENGTH = 128;
const MAX_COMPATIBILITY_BYTES = 64 * 1024;
const MAX_OPERATION_SUMMARY_BYTES = 32 * 1024;

type RevisionBlobInput = {
  key: string;
  mimeType: string;
  byteSize: number;
  fingerprint: string;
};

type RevisionStateInput = {
  key: string;
  byteSize: number;
  fingerprint: string;
};

export type CreateImportedOfficeArtifactInput = {
  workspaceId: string;
  actorId: string;
  kind: OfficeArtifactKind;
  title: string;
  sourceFileName: string;
  source: RevisionBlobInput;
  importIdempotencyKey: string;
  importFingerprint: string;
  compatibility?: Prisma.InputJsonObject;
  state?: RevisionStateInput;
  modelVersion?: string;
  operationSummary?: Prisma.InputJsonObject;
};

export type AppendOfficeRevisionInput = {
  workspaceId: string;
  artifactId: string;
  actorId: string;
  origin: OfficeRevisionOrigin;
  expectedParentRevisionId: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  package: RevisionBlobInput;
  state?: RevisionStateInput;
  modelVersion?: string;
  operationSummary?: Prisma.InputJsonObject;
};

function requireString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function requirePositiveInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function requireFingerprint(value: string, field: string) {
  const fingerprint = requireString(value, field, MAX_FINGERPRINT_LENGTH);
  if (fingerprint.length < 8) {
    throw new Error(`${field} must contain at least 8 characters`);
  }
  return fingerprint;
}

function normalizeJsonObject(
  value: Prisma.InputJsonObject | undefined,
  field: string,
  maxBytes: number
): Prisma.InputJsonObject {
  if (value === undefined) return {};
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${field} must be an object`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${field} must be JSON serializable`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new Error(`${field} must not exceed ${maxBytes} bytes`);
  }
  return value;
}

@Injectable()
export class OfficeArtifactModel extends BaseModel {
  @Transactional()
  async createOrReuseImported(input: CreateImportedOfficeArtifactInput) {
    const workspaceId = requireString(input.workspaceId, 'workspace id', 512);
    const actorId = requireString(input.actorId, 'actor id', 512);
    const title = requireString(input.title, 'title', MAX_TITLE_LENGTH);
    const sourceFileName = requireString(
      input.sourceFileName,
      'source file name',
      MAX_FILE_NAME_LENGTH
    );
    const source = this.normalizePackage(input.source, 'source');
    assertOfficePackageMimeType(input.kind, source.mimeType);
    const importIdempotencyKey = requireString(
      input.importIdempotencyKey,
      'import idempotency key',
      MAX_IDEMPOTENCY_KEY_LENGTH
    );
    const importFingerprint = requireFingerprint(
      input.importFingerprint,
      'import fingerprint'
    );
    const compatibility = normalizeJsonObject(
      input.compatibility,
      'compatibility',
      MAX_COMPATIBILITY_BYTES
    );
    const state = input.state ? this.normalizeState(input.state) : undefined;
    const modelVersion = requireString(
      input.modelVersion ?? 'localmind-office-model/v1',
      'model version',
      MAX_MODEL_VERSION_LENGTH
    );
    const operationSummary = normalizeJsonObject(
      input.operationSummary ?? { type: 'import' },
      'operation summary',
      MAX_OPERATION_SUMMARY_BYTES
    );

    const existing = await this.db.officeArtifact.findUnique({
      where: {
        workspaceId_importIdempotencyKey: {
          workspaceId,
          importIdempotencyKey,
        },
      },
      include: {
        revisions: { where: { sequence: 1 }, take: 1 },
      },
    });
    if (existing) {
      return this.reuseImportedArtifact(
        existing,
        importFingerprint,
        importIdempotencyKey
      );
    }

    await this.requireAvailableBlob(workspaceId, source, 'source');
    if (state) {
      await this.requireAvailableBlob(
        workspaceId,
        { ...state, mimeType: 'application/octet-stream' },
        'state',
        false
      );
    }

    const artifactId = randomUUID();
    const inserted = await this.db.officeArtifact.createMany({
      data: [
        {
          id: artifactId,
          workspaceId,
          kind: input.kind,
          title,
          sourceFileName,
          sourceMimeType: source.mimeType,
          sourceBlobKey: source.key,
          sourceByteSize: source.byteSize,
          sourceFingerprint: source.fingerprint,
          importIdempotencyKey,
          importFingerprint,
          compatibility,
          createdBy: actorId,
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      const raced = await this.db.officeArtifact.findUnique({
        where: {
          workspaceId_importIdempotencyKey: {
            workspaceId,
            importIdempotencyKey,
          },
        },
        include: {
          revisions: { where: { sequence: 1 }, take: 1 },
        },
      });
      if (!raced) {
        throw new Error(
          `Office artifact import could not be reconciled: ${importIdempotencyKey}`
        );
      }
      return this.reuseImportedArtifact(
        raced,
        importFingerprint,
        importIdempotencyKey
      );
    }

    const revision = await this.db.officeRevision.create({
      data: {
        workspaceId,
        artifactId,
        sequence: 1,
        origin: OfficeRevisionOrigin.import,
        idempotencyKey: importIdempotencyKey,
        idempotencyFingerprint: importFingerprint,
        packageBlobKey: source.key,
        packageMimeType: source.mimeType,
        packageByteSize: source.byteSize,
        packageFingerprint: source.fingerprint,
        stateBlobKey: state?.key,
        stateByteSize: state?.byteSize,
        stateFingerprint: state?.fingerprint,
        modelVersion,
        operationSummary,
        createdBy: actorId,
      },
    });
    const artifact = await this.db.officeArtifact.update({
      where: { id: artifactId },
      data: { revisionCounter: 1 },
    });

    return {
      created: true,
      artifact,
      revision,
    };
  }

  @Transactional()
  async appendRevision(input: AppendOfficeRevisionInput) {
    const workspaceId = requireString(input.workspaceId, 'workspace id', 512);
    const artifactId = requireString(input.artifactId, 'artifact id', 512);
    const actorId = requireString(input.actorId, 'actor id', 512);
    const expectedParentRevisionId = requireString(
      input.expectedParentRevisionId,
      'expected parent revision id',
      512
    );
    const idempotencyKey = requireString(
      input.idempotencyKey,
      'revision idempotency key',
      MAX_IDEMPOTENCY_KEY_LENGTH
    );
    const idempotencyFingerprint = requireFingerprint(
      input.idempotencyFingerprint,
      'revision idempotency fingerprint'
    );
    const packageBlob = this.normalizePackage(input.package, 'package');
    const state = input.state ? this.normalizeState(input.state) : undefined;
    const modelVersion = requireString(
      input.modelVersion ?? 'localmind-office-model/v1',
      'model version',
      MAX_MODEL_VERSION_LENGTH
    );
    const operationSummary = normalizeJsonObject(
      input.operationSummary,
      'operation summary',
      MAX_OPERATION_SUMMARY_BYTES
    );
    if (input.origin === OfficeRevisionOrigin.import) {
      throw new Error('import origin is only valid for the initial revision');
    }

    await this.lockArtifactWriter(workspaceId, artifactId);

    const existing = await this.db.officeRevision.findUnique({
      where: {
        artifactId_idempotencyKey: { artifactId, idempotencyKey },
      },
    });
    if (existing) {
      if (
        existing.workspaceId !== workspaceId ||
        existing.idempotencyFingerprint !== idempotencyFingerprint
      ) {
        throw new Error(
          `Office revision idempotency conflict: ${idempotencyKey}`
        );
      }
      return { created: false, revision: existing };
    }

    const artifact = await this.db.officeArtifact.findUnique({
      where: { id: artifactId },
    });
    if (!artifact || artifact.workspaceId !== workspaceId) {
      throw new Error(`Office artifact not found: ${artifactId}`);
    }
    assertOfficePackageMimeType(artifact.kind, packageBlob.mimeType);
    const parent = await this.db.officeRevision.findUnique({
      where: {
        artifactId_sequence: {
          artifactId,
          sequence: artifact.revisionCounter,
        },
      },
    });
    if (!parent || parent.id !== expectedParentRevisionId) {
      throw new Error(
        `Office artifact revision conflict: expected ${expectedParentRevisionId}`
      );
    }

    await this.requireAvailableBlob(workspaceId, packageBlob, 'package');
    if (state) {
      await this.requireAvailableBlob(
        workspaceId,
        { ...state, mimeType: 'application/octet-stream' },
        'state',
        false
      );
    }

    const sequence = artifact.revisionCounter + 1;
    const revision = await this.db.officeRevision.create({
      data: {
        workspaceId,
        artifactId,
        sequence,
        origin: input.origin,
        parentRevisionId: parent.id,
        idempotencyKey,
        idempotencyFingerprint,
        packageBlobKey: packageBlob.key,
        packageMimeType: packageBlob.mimeType,
        packageByteSize: packageBlob.byteSize,
        packageFingerprint: packageBlob.fingerprint,
        stateBlobKey: state?.key,
        stateByteSize: state?.byteSize,
        stateFingerprint: state?.fingerprint,
        modelVersion,
        operationSummary,
        createdBy: actorId,
      },
    });
    await this.db.officeArtifact.update({
      where: { id: artifactId },
      data: { revisionCounter: sequence },
    });
    return { created: true, revision };
  }

  async get(workspaceId: string, artifactId: string) {
    return await this.db.officeArtifact.findFirst({
      where: { id: artifactId, workspaceId },
    });
  }

  async getCurrentRevision(workspaceId: string, artifactId: string) {
    const artifact = await this.get(workspaceId, artifactId);
    if (!artifact || artifact.revisionCounter === 0) return null;
    return await this.db.officeRevision.findUnique({
      where: {
        artifactId_sequence: {
          artifactId,
          sequence: artifact.revisionCounter,
        },
      },
    });
  }

  async getRevision(
    workspaceId: string,
    artifactId: string,
    revisionId: string
  ) {
    return await this.db.officeRevision.findFirst({
      where: { id: revisionId, artifactId, workspaceId },
    });
  }

  async list(workspaceId: string, limit = 50, kind?: OfficeArtifactKind) {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 50;
    return await this.db.officeArtifact.findMany({
      where: { workspaceId, kind },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(normalizedLimit, 1), 100),
    });
  }

  async listRevisions(workspaceId: string, artifactId: string, limit = 50) {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 50;
    return await this.db.officeRevision.findMany({
      where: { workspaceId, artifactId },
      orderBy: { sequence: 'desc' },
      take: Math.min(Math.max(normalizedLimit, 1), 100),
    });
  }

  private async lockArtifactWriter(workspaceId: string, artifactId: string) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`office-artifact:${workspaceId}:${artifactId}`}, 0))`;
  }

  private reuseImportedArtifact(
    existing: Prisma.OfficeArtifactGetPayload<{
      include: { revisions: true };
    }>,
    importFingerprint: string,
    importIdempotencyKey: string
  ) {
    if (existing.importFingerprint !== importFingerprint) {
      throw new Error(
        `Office artifact import idempotency conflict: ${importIdempotencyKey}`
      );
    }
    const revision = existing.revisions.find(item => item.sequence === 1);
    if (!revision) {
      throw new Error(
        `Office artifact is missing its initial revision: ${existing.id}`
      );
    }
    const { revisions: _revisions, ...artifact } = existing;
    return { created: false, artifact, revision };
  }

  private normalizePackage(input: RevisionBlobInput, field: string) {
    return {
      key: requireString(input.key, `${field} blob key`, MAX_KEY_LENGTH),
      mimeType: requireString(
        input.mimeType,
        `${field} MIME type`,
        MAX_MIME_TYPE_LENGTH
      ),
      byteSize: requirePositiveInteger(input.byteSize, `${field} byte size`),
      fingerprint: requireFingerprint(
        input.fingerprint,
        `${field} fingerprint`
      ),
    };
  }

  private normalizeState(input: RevisionStateInput) {
    return {
      key: requireString(input.key, 'state blob key', MAX_KEY_LENGTH),
      byteSize: requirePositiveInteger(input.byteSize, 'state byte size'),
      fingerprint: requireFingerprint(input.fingerprint, 'state fingerprint'),
    };
  }

  private async requireAvailableBlob(
    workspaceId: string,
    input: { key: string; mimeType: string; byteSize: number },
    field: string,
    requireMimeMatch = true
  ) {
    const [blob] = await this.db.$queryRaw<
      Array<{
        mime: string;
        size: number;
        status: string;
        deletedAt: Date | null;
      }>
    >`
      SELECT
        "mime",
        "size",
        "status"::text AS "status",
        "deleted_at" AS "deletedAt"
      FROM "blobs"
      WHERE "workspace_id" = ${workspaceId}
        AND "key" = ${input.key}
      FOR UPDATE
    `;
    if (!blob || blob.deletedAt || blob.status !== 'completed') {
      throw new Error(`${field} blob is not available: ${input.key}`);
    }
    if (blob.size !== input.byteSize) {
      throw new Error(`${field} blob size does not match: ${input.key}`);
    }
    if (requireMimeMatch && blob.mime !== input.mimeType) {
      throw new Error(`${field} blob MIME type does not match: ${input.key}`);
    }
  }
}
