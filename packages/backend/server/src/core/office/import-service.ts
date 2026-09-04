import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { readBufferWithLimit } from '../../base';
import { Models } from '../../models';
import { PermissionAccess } from '../permission';
import { WorkspaceBlobStorage } from '../storage';
import { officeFingerprint, officeJsonFingerprint } from './evidence';
import {
  officeCompatibilitySummary,
  officeFormatFromFileName,
  officeStateStats,
  readNativeOfficeState,
} from './formats';

const MAX_IMPORT_FIELD_LENGTH = 1024;

export type ImportOfficeArtifactInput = {
  workspaceId: string;
  actorId: string;
  sourceBlobKey: string;
  title: string;
  sourceFileName: string;
  importIdempotencyKey: string;
};

function requireImportField(value: string, field: string, maxLength: number) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

@Injectable()
export class OfficeImportService {
  constructor(
    private readonly models: Models,
    private readonly storage: WorkspaceBlobStorage,
    private readonly ac: PermissionAccess
  ) {}

  async import(input: ImportOfficeArtifactInput) {
    const workspaceId = requireImportField(
      input.workspaceId,
      'workspace id',
      512
    );
    const actorId = requireImportField(input.actorId, 'actor id', 512);
    const sourceBlobKey = requireImportField(
      input.sourceBlobKey,
      'source blob key',
      MAX_IMPORT_FIELD_LENGTH
    );
    const title = requireImportField(input.title, 'title', 512);
    const sourceFileName = requireImportField(
      input.sourceFileName,
      'source file name',
      512
    );
    const policy = officeFormatFromFileName(sourceFileName);
    const importIdempotencyKey = requireImportField(
      input.importIdempotencyKey,
      'import idempotency key',
      256
    );

    await Promise.all([
      this.ac
        .user(actorId)
        .workspace(workspaceId)
        .assert('Workspace.CreateDoc'),
      this.ac
        .user(actorId)
        .workspace(workspaceId)
        .assert('Workspace.Blobs.Write'),
    ]);

    const sourceBlob = await this.models.blob.get(workspaceId, sourceBlobKey);
    if (
      !sourceBlob ||
      sourceBlob.deletedAt ||
      sourceBlob.status !== 'completed'
    ) {
      throw new Error(
        `${policy.format.toUpperCase()} source blob is not available: ${sourceBlobKey}`
      );
    }
    if (sourceBlob.mime !== policy.mimeType) {
      throw new Error(
        `${policy.format.toUpperCase()} source blob has an invalid MIME type: ${sourceBlobKey}`
      );
    }
    if (sourceBlob.size <= 0 || sourceBlob.size > policy.maxPackageBytes) {
      throw new Error(
        `${policy.format.toUpperCase()} source blob has an invalid byte size: ${sourceBlobKey}`
      );
    }

    const stored = await this.storage.get(workspaceId, sourceBlobKey);
    if (!stored.body) {
      throw new Error(
        `${policy.format.toUpperCase()} source bytes are not available: ${sourceBlobKey}`
      );
    }
    if (
      stored.metadata &&
      (stored.metadata.contentLength !== sourceBlob.size ||
        stored.metadata.contentType !== sourceBlob.mime)
    ) {
      stored.body.destroy();
      throw new Error(
        `${policy.format.toUpperCase()} source object metadata does not match: ${sourceBlobKey}`
      );
    }
    let sourceBytes: Buffer;
    try {
      sourceBytes = await readBufferWithLimit(
        stored.body,
        policy.maxPackageBytes
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to read ${policy.format.toUpperCase()} source blob: ${message}`
      );
    }
    if (sourceBytes.byteLength !== sourceBlob.size) {
      throw new Error(
        `${policy.format.toUpperCase()} source blob byte size does not match: ${sourceBlobKey}`
      );
    }

    const sourceFingerprint = officeFingerprint(sourceBytes);
    const semanticState = await readNativeOfficeState(policy, sourceBytes);
    const hash = sourceFingerprint.slice('sha256:'.length);
    const packageBlobKey = `office/package/${policy.format}/${hash}${policy.extension}`;
    await this.storage.put(workspaceId, packageBlobKey, sourceBytes, {
      contentType: policy.mimeType,
      contentLength: sourceBytes.byteLength,
    });
    const stateBytes = Buffer.from(JSON.stringify(semanticState), 'utf8');
    if (
      !stateBytes.byteLength ||
      stateBytes.byteLength > policy.maxStateBytes
    ) {
      throw new Error(
        `${policy.format.toUpperCase()} semantic state exceeds its byte limit`
      );
    }
    const stateFingerprint = officeFingerprint(stateBytes);
    const stateBlobKey = `office/state/${policy.format}/${stateFingerprint.slice('sha256:'.length)}.json`;
    await this.storage.put(workspaceId, stateBlobKey, stateBytes, {
      contentType: policy.stateMimeType,
      contentLength: stateBytes.byteLength,
    });

    const compatibility = officeCompatibilitySummary(
      policy,
      semanticState
    ) satisfies Prisma.InputJsonObject;
    const operationSummary = {
      type: 'import',
      engine: policy.engine,
      modelVersion: policy.modelVersion,
      stats: officeStateStats(semanticState),
    } satisfies Prisma.InputJsonObject;
    const trustedImportFingerprint = officeJsonFingerprint({
      version: 'localmind-office-import/v1',
      format: policy.format,
      workspaceId,
      actorId,
      title,
      sourceFileName,
      importSourceBlobKey: sourceBlobKey,
      packageBlobKey,
      sourceMimeType: sourceBlob.mime,
      sourceByteSize: sourceBytes.byteLength,
      sourceFingerprint,
      stateFingerprint,
      modelVersion: policy.modelVersion,
    });
    const result = await this.models.officeArtifact.createOrReuseImported({
      workspaceId,
      actorId,
      kind: policy.kind,
      title,
      sourceFileName,
      source: {
        key: packageBlobKey,
        mimeType: policy.mimeType,
        byteSize: sourceBytes.byteLength,
        fingerprint: sourceFingerprint,
      },
      state: {
        key: stateBlobKey,
        byteSize: stateBytes.byteLength,
        fingerprint: stateFingerprint,
      },
      modelVersion: policy.modelVersion,
      importIdempotencyKey,
      importFingerprint: trustedImportFingerprint,
      compatibility,
      operationSummary,
    });
    return {
      ...result,
      format: policy.format,
      sourceFingerprint,
      packageBlobKey,
      stateBlobKey,
      stateFingerprint,
      stats: officeStateStats(semanticState),
    };
  }
}
