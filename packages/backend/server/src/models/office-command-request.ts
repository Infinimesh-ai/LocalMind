import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { type OfficeCommandRequest, Prisma } from '@prisma/client';

import { BaseModel } from './base';

export const OFFICE_COMMAND_BLOB_MIME =
  'application/vnd.localmind.office-command+json';

const MAX_ID_LENGTH = 512;
const MAX_KEY_LENGTH = 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_FINGERPRINT_LENGTH = 128;
export const OFFICE_COMMAND_MAX_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_SUMMARY_BYTES = 32 * 1024;

export type CreateOfficeCommandRequestInput = {
  workspaceId: string;
  artifactId: string;
  expectedRevisionId: string;
  actorId: string;
  idempotencyKey: string;
  commandBlobKey: string;
  commandByteSize: number;
  commandFingerprint: string;
  previewPackageFingerprint: string;
  previewStateFingerprint: string;
  previewSummary: Prisma.InputJsonObject;
};

type ReusableOfficeCommandRequestEvidence = Omit<
  CreateOfficeCommandRequestInput,
  'actorId'
> & {
  requestedBy: string;
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

function requireFingerprint(value: unknown, field: string) {
  const fingerprint = requireString(value, field, MAX_FINGERPRINT_LENGTH);
  if (fingerprint.length < 8) {
    throw new Error(`${field} must contain at least 8 characters`);
  }
  return fingerprint;
}

function requireCommandByteSize(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > OFFICE_COMMAND_MAX_BYTES
  ) {
    throw new Error(
      `command byte size must be an integer between 1 and ${OFFICE_COMMAND_MAX_BYTES}`
    );
  }
  return value;
}

function normalizePreviewSummary(value: Prisma.InputJsonObject) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('preview summary must be an object');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PREVIEW_SUMMARY_BYTES) {
    throw new Error(
      `preview summary must not exceed ${MAX_PREVIEW_SUMMARY_BYTES} bytes`
    );
  }
  return value;
}

@Injectable()
export class OfficeCommandRequestModel extends BaseModel {
  @Transactional()
  async createOrReuse(input: CreateOfficeCommandRequestInput) {
    const workspaceId = requireString(
      input.workspaceId,
      'workspace id',
      MAX_ID_LENGTH
    );
    const artifactId = requireString(
      input.artifactId,
      'artifact id',
      MAX_ID_LENGTH
    );
    const expectedRevisionId = requireString(
      input.expectedRevisionId,
      'expected revision id',
      MAX_ID_LENGTH
    );
    const requestedBy = requireString(
      input.actorId,
      'request actor id',
      MAX_ID_LENGTH
    );
    const idempotencyKey = requireString(
      input.idempotencyKey,
      'command request idempotency key',
      MAX_IDEMPOTENCY_KEY_LENGTH
    );
    const commandBlobKey = requireString(
      input.commandBlobKey,
      'command blob key',
      MAX_KEY_LENGTH
    );
    const commandByteSize = requireCommandByteSize(input.commandByteSize);
    const commandFingerprint = requireFingerprint(
      input.commandFingerprint,
      'command fingerprint'
    );
    const previewPackageFingerprint = requireFingerprint(
      input.previewPackageFingerprint,
      'preview package fingerprint'
    );
    const previewStateFingerprint = requireFingerprint(
      input.previewStateFingerprint,
      'preview state fingerprint'
    );
    const previewSummary = normalizePreviewSummary(input.previewSummary);

    const existing = await this.db.officeCommandRequest.findUnique({
      where: {
        artifactId_idempotencyKey: { artifactId, idempotencyKey },
      },
    });
    if (existing) {
      return this.reuse(existing, {
        workspaceId,
        artifactId,
        expectedRevisionId,
        requestedBy,
        idempotencyKey,
        commandBlobKey,
        commandByteSize,
        commandFingerprint,
        previewPackageFingerprint,
        previewStateFingerprint,
        previewSummary,
      });
    }

    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`office-artifact:${workspaceId}:${artifactId}`}, 0))`;

    const artifact = await this.db.officeArtifact.findFirst({
      where: { id: artifactId, workspaceId },
    });
    if (!artifact) {
      throw new Error(`Office artifact not found: ${artifactId}`);
    }
    const revision = await this.db.officeRevision.findUnique({
      where: {
        artifactId_sequence: {
          artifactId,
          sequence: artifact.revisionCounter,
        },
      },
    });
    if (!revision || revision.id !== expectedRevisionId) {
      throw new Error(
        `Office artifact revision conflict: expected ${expectedRevisionId}`
      );
    }
    await this.requireCommandBlob({
      workspaceId,
      key: commandBlobKey,
      byteSize: commandByteSize,
    });

    const inserted = await this.db.officeCommandRequest.createMany({
      data: [
        {
          workspaceId,
          artifactId,
          expectedRevisionId,
          requestedBy,
          idempotencyKey,
          commandBlobKey,
          commandByteSize,
          commandFingerprint,
          previewPackageFingerprint,
          previewStateFingerprint,
          previewSummary,
        },
      ],
      skipDuplicates: true,
    });
    const request = await this.db.officeCommandRequest.findUnique({
      where: {
        artifactId_idempotencyKey: { artifactId, idempotencyKey },
      },
    });
    if (!request) {
      throw new Error(
        `Office command request could not be reconciled: ${idempotencyKey}`
      );
    }
    if (!inserted.count) {
      return this.reuse(request, {
        workspaceId,
        artifactId,
        expectedRevisionId,
        requestedBy,
        idempotencyKey,
        commandBlobKey,
        commandByteSize,
        commandFingerprint,
        previewPackageFingerprint,
        previewStateFingerprint,
        previewSummary,
      });
    }
    return { created: true, request };
  }

  async get(workspaceId: string, id: string) {
    return await this.db.officeCommandRequest.findFirst({
      where: { id, workspaceId },
    });
  }

  private reuse(
    existing: OfficeCommandRequest,
    expected: ReusableOfficeCommandRequestEvidence
  ) {
    const comparable = [
      'workspaceId',
      'artifactId',
      'expectedRevisionId',
      'requestedBy',
      'idempotencyKey',
      'commandBlobKey',
      'commandByteSize',
      'commandFingerprint',
      'previewPackageFingerprint',
      'previewStateFingerprint',
    ] as const;
    const differs = comparable.some(key => existing[key] !== expected[key]);
    if (
      differs ||
      JSON.stringify(existing.previewSummary) !==
        JSON.stringify(expected.previewSummary)
    ) {
      throw new Error(
        `Office command request idempotency conflict: ${expected.idempotencyKey}`
      );
    }
    return { created: false, request: existing };
  }

  private async requireCommandBlob(input: {
    workspaceId: string;
    key: string;
    byteSize: number;
  }) {
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
      WHERE "workspace_id" = ${input.workspaceId}
        AND "key" = ${input.key}
      FOR UPDATE
    `;
    if (!blob || blob.deletedAt || blob.status !== 'completed') {
      throw new Error(`Office command blob is not available: ${input.key}`);
    }
    if (blob.mime !== OFFICE_COMMAND_BLOB_MIME) {
      throw new Error(
        `Office command blob MIME type does not match: ${input.key}`
      );
    }
    if (blob.size !== input.byteSize) {
      throw new Error(`Office command blob size does not match: ${input.key}`);
    }
  }
}
