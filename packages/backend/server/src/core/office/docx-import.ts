import { OFFICE_PACKAGE_MIME_TYPE } from '@localmind/office';
import {
  DEFAULT_DOCX_PACKAGE_LIMITS,
  DOCX_MODEL_VERSION,
  openDocxPackage,
  readDocxSemanticState,
} from '@localmind/office/docx';
import { Injectable } from '@nestjs/common';
import { OfficeArtifactKind, type Prisma } from '@prisma/client';

import { readBufferWithLimit } from '../../base';
import { Models } from '../../models';
import { PermissionAccess } from '../permission';
import { WorkspaceBlobStorage } from '../storage';
import { officeFingerprint, officeJsonFingerprint } from './evidence';

export const OFFICE_DOCX_STATE_MIME_TYPE =
  'application/vnd.localmind.office.docx-state+json';
export const OFFICE_DOCX_STATE_MAX_BYTES = 128 * 1024 * 1024;
const MAX_IMPORT_FIELD_LENGTH = 1024;

export type ImportOfficeDocxInput = {
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
export class OfficeDocxImportService {
  constructor(
    private readonly models: Models,
    private readonly storage: WorkspaceBlobStorage,
    private readonly ac: PermissionAccess
  ) {}

  async import(input: ImportOfficeDocxInput) {
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
    if (!sourceFileName.toLowerCase().endsWith('.docx')) {
      throw new Error('DOCX import source file name must end with .docx');
    }
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
      throw new Error(`DOCX source blob is not available: ${sourceBlobKey}`);
    }
    if (sourceBlob.mime !== OFFICE_PACKAGE_MIME_TYPE.document) {
      throw new Error(
        `DOCX source blob has an invalid MIME type: ${sourceBlobKey}`
      );
    }
    if (
      sourceBlob.size <= 0 ||
      sourceBlob.size > DEFAULT_DOCX_PACKAGE_LIMITS.maxPackageBytes
    ) {
      throw new Error(
        `DOCX source blob has an invalid byte size: ${sourceBlobKey}`
      );
    }

    const stored = await this.storage.get(workspaceId, sourceBlobKey);
    if (!stored.body) {
      throw new Error(`DOCX source bytes are not available: ${sourceBlobKey}`);
    }
    if (
      stored.metadata &&
      (stored.metadata.contentLength !== sourceBlob.size ||
        stored.metadata.contentType !== sourceBlob.mime)
    ) {
      stored.body.destroy();
      throw new Error(
        `DOCX source object metadata does not match: ${sourceBlobKey}`
      );
    }

    let sourceBytes: Buffer;
    try {
      sourceBytes = await readBufferWithLimit(
        stored.body,
        DEFAULT_DOCX_PACKAGE_LIMITS.maxPackageBytes
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read DOCX source blob: ${message}`);
    }
    if (sourceBytes.byteLength !== sourceBlob.size) {
      throw new Error(
        `DOCX source blob byte size does not match: ${sourceBlobKey}`
      );
    }

    const sourceFingerprint = officeFingerprint(sourceBytes);
    const pkg = openDocxPackage(sourceBytes);
    const semanticState = readDocxSemanticState(pkg);
    const packageBlobKey = `office/package/docx/${sourceFingerprint.slice('sha256:'.length)}.docx`;
    await this.storage.put(workspaceId, packageBlobKey, sourceBytes, {
      contentType: OFFICE_PACKAGE_MIME_TYPE.document,
      contentLength: sourceBytes.byteLength,
    });
    const stateBytes = Buffer.from(JSON.stringify(semanticState), 'utf8');
    if (
      !stateBytes.byteLength ||
      stateBytes.byteLength > OFFICE_DOCX_STATE_MAX_BYTES
    ) {
      throw new Error('DOCX semantic state exceeds its byte limit');
    }
    const stateFingerprint = officeFingerprint(stateBytes);
    const stateBlobKey = `office/state/docx/${stateFingerprint.slice('sha256:'.length)}.json`;
    await this.storage.put(workspaceId, stateBlobKey, stateBytes, {
      contentType: OFFICE_DOCX_STATE_MIME_TYPE,
      contentLength: stateBytes.byteLength,
    });

    const compatibility = {
      engine: 'localmind-native-docx',
      format: 'docx',
      preservationLevel: 'L0',
      documentPart: semanticState.documentPart,
      stats: semanticState.stats,
      unsupportedBodyElements:
        semanticState.compatibility.unsupportedBodyElements,
    } satisfies Prisma.InputJsonObject;
    const operationSummary = {
      type: 'import',
      engine: 'localmind-native-docx',
      modelVersion: DOCX_MODEL_VERSION,
      stats: semanticState.stats,
    } satisfies Prisma.InputJsonObject;
    const trustedImportFingerprint = officeJsonFingerprint({
      version: 'localmind-office-docx-import/v1',
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
      modelVersion: DOCX_MODEL_VERSION,
    });

    const result = await this.models.officeArtifact.createOrReuseImported({
      workspaceId,
      actorId,
      kind: OfficeArtifactKind.document,
      title,
      sourceFileName,
      source: {
        key: packageBlobKey,
        mimeType: sourceBlob.mime,
        byteSize: sourceBytes.byteLength,
        fingerprint: sourceFingerprint,
      },
      state: {
        key: stateBlobKey,
        byteSize: stateBytes.byteLength,
        fingerprint: stateFingerprint,
      },
      modelVersion: DOCX_MODEL_VERSION,
      importIdempotencyKey,
      importFingerprint: trustedImportFingerprint,
      compatibility,
      operationSummary,
    });

    return {
      ...result,
      sourceFingerprint,
      packageBlobKey,
      stateBlobKey,
      stateFingerprint,
      stats: semanticState.stats,
    };
  }
}
