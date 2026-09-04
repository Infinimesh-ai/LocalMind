import {
  diffOfficeSemanticStates,
  type OfficeSemanticKind,
} from '@localmind/office';
import {
  exportDocxStateToPdf,
  openDocxPackage,
  readDocxSemanticState,
} from '@localmind/office/docx';
import { openPptxPackage } from '@localmind/office/pptx';
import { openXlsxPackage } from '@localmind/office/xlsx';
import { Injectable } from '@nestjs/common';
import {
  type OfficeArtifact,
  OfficeArtifactKind,
  type OfficeRevision,
} from '@prisma/client';

import { readBufferWithLimit } from '../../base';
import { Models } from '../../models';
import { PermissionAccess } from '../permission';
import { WorkspaceBlobStorage } from '../storage';
import { officeFingerprint } from './evidence';

const MAX_OFFICE_PACKAGE_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_OFFICE_STATE_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const MAX_OFFICE_PART_DOWNLOAD_BYTES = 64 * 1024 * 1024;

export type OfficeRevisionAssetKind = 'package' | 'state';

@Injectable()
export class OfficeArtifactService {
  constructor(
    private readonly models: Models,
    private readonly storage: WorkspaceBlobStorage,
    private readonly ac: PermissionAccess
  ) {}

  async list(
    workspaceId: string,
    actorId: string,
    limit?: number,
    kind?: OfficeArtifactKind
  ) {
    await this.assertRead(workspaceId, actorId);
    const artifacts = await this.models.officeArtifact.list(
      workspaceId,
      limit,
      kind
    );
    return await Promise.all(
      artifacts.map(async artifact => ({
        artifact,
        revision: await this.models.officeArtifact.getCurrentRevision(
          workspaceId,
          artifact.id
        ),
      }))
    );
  }

  async get(workspaceId: string, actorId: string, artifactId: string) {
    await this.assertRead(workspaceId, actorId);
    const artifact = await this.requireArtifact(workspaceId, artifactId);
    const revision = await this.models.officeArtifact.getCurrentRevision(
      workspaceId,
      artifactId
    );
    if (!revision) {
      throw new Error(
        `Office artifact is missing its current revision: ${artifactId}`
      );
    }
    return { artifact, revision };
  }

  async getRevision(
    workspaceId: string,
    actorId: string,
    artifactId: string,
    revisionId?: string
  ) {
    await this.assertRead(workspaceId, actorId);
    await this.requireArtifact(workspaceId, artifactId);
    const revision = revisionId
      ? await this.models.officeArtifact.getRevision(
          workspaceId,
          artifactId,
          revisionId
        )
      : await this.models.officeArtifact.getCurrentRevision(
          workspaceId,
          artifactId
        );
    if (!revision) {
      throw new Error(
        `Office revision not found: ${revisionId ?? `current:${artifactId}`}`
      );
    }
    return revision;
  }

  async listRevisions(
    workspaceId: string,
    actorId: string,
    artifactId: string,
    limit?: number
  ) {
    await this.assertRead(workspaceId, actorId);
    await this.requireArtifact(workspaceId, artifactId);
    return await this.models.officeArtifact.listRevisions(
      workspaceId,
      artifactId,
      limit
    );
  }

  async compareRevisions(
    workspaceId: string,
    actorId: string,
    artifactId: string,
    beforeRevisionId: string,
    afterRevisionId: string
  ) {
    const [before, after] = await Promise.all([
      this.readRevisionAsset(
        workspaceId,
        actorId,
        artifactId,
        beforeRevisionId,
        'state'
      ),
      this.readRevisionAsset(
        workspaceId,
        actorId,
        artifactId,
        afterRevisionId,
        'state'
      ),
    ]);
    if (before.artifact.kind !== after.artifact.kind) {
      throw new Error('Office revisions belong to different resource kinds');
    }
    const parseState = (bytes: Buffer, revisionId: string) => {
      try {
        return JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw new Error(
          `Office semantic state is not valid JSON: ${revisionId}`
        );
      }
    };
    const kind = this.semanticKind(before.artifact.kind);
    const diff = diffOfficeSemanticStates(
      kind,
      parseState(before.bytes, before.revision.id),
      parseState(after.bytes, after.revision.id)
    );
    return {
      artifact: before.artifact,
      beforeRevision: before.revision,
      afterRevision: after.revision,
      diff,
    };
  }

  async readRevisionAsset(
    workspaceId: string,
    actorId: string,
    artifactId: string,
    revisionId: string,
    kind: OfficeRevisionAssetKind
  ) {
    const artifact = await this.getArtifactForAsset(
      workspaceId,
      actorId,
      artifactId
    );
    const revision = await this.getRevision(
      workspaceId,
      actorId,
      artifactId,
      revisionId
    );
    const evidence = this.assetEvidence(revision, kind);
    const stored = await this.storage.get(workspaceId, evidence.key);
    if (!stored.body) {
      throw new Error(
        `Office ${kind} bytes are not available: ${evidence.key}`
      );
    }
    if (
      stored.metadata &&
      (stored.metadata.contentLength !== evidence.byteSize ||
        (evidence.mimeType &&
          stored.metadata.contentType !== evidence.mimeType))
    ) {
      stored.body.destroy();
      throw new Error(
        `Office ${kind} object metadata does not match: ${evidence.key}`
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readBufferWithLimit(stored.body, evidence.maxBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read Office ${kind}: ${message}`);
    }
    if (bytes.byteLength !== evidence.byteSize) {
      throw new Error(
        `Office ${kind} byte size does not match: ${evidence.key}`
      );
    }
    if (officeFingerprint(bytes) !== evidence.fingerprint) {
      throw new Error(
        `Office ${kind} fingerprint does not match: ${evidence.key}`
      );
    }
    return { artifact, revision, bytes, mimeType: evidence.mimeType };
  }

  async readRevisionPackagePart(
    workspaceId: string,
    actorId: string,
    artifactId: string,
    revisionId: string,
    partName: string
  ) {
    const asset = await this.readRevisionAsset(
      workspaceId,
      actorId,
      artifactId,
      revisionId,
      'package'
    );
    const pkg =
      asset.artifact.kind === OfficeArtifactKind.document
        ? openDocxPackage(asset.bytes)
        : asset.artifact.kind === OfficeArtifactKind.workbook
          ? openXlsxPackage(asset.bytes)
          : asset.artifact.kind === OfficeArtifactKind.presentation
            ? openPptxPackage(asset.bytes)
            : null;
    if (!pkg) throw new Error('PDF revisions do not contain package parts');
    const bytes = pkg.readPart(partName);
    if (!bytes) throw new Error(`Office package part not found: ${partName}`);
    if (bytes.byteLength > MAX_OFFICE_PART_DOWNLOAD_BYTES) {
      throw new Error(
        `Office package part exceeds its byte limit: ${partName}`
      );
    }
    return {
      artifact: asset.artifact,
      revision: asset.revision,
      bytes: Buffer.from(bytes),
      mimeType: pkg.getContentType(partName) ?? 'application/octet-stream',
    };
  }

  async exportDocumentRevisionPdf(
    workspaceId: string,
    actorId: string,
    artifactId: string,
    revisionId: string
  ) {
    const asset = await this.readRevisionAsset(
      workspaceId,
      actorId,
      artifactId,
      revisionId,
      'package'
    );
    if (asset.artifact.kind !== OfficeArtifactKind.document) {
      throw new Error('PDF export is available only for LocalMind Docs');
    }
    const pkg = openDocxPackage(asset.bytes);
    const state = readDocxSemanticState(pkg);
    const bytes = Buffer.from(
      await exportDocxStateToPdf(state, {
        title: asset.artifact.title,
        author: asset.artifact.createdBy,
        readPart: partName => pkg.readPart(partName),
      })
    );
    return {
      artifact: asset.artifact,
      revision: asset.revision,
      bytes,
      fingerprint: officeFingerprint(bytes),
      mimeType: 'application/pdf',
    };
  }

  async assertRead(workspaceId: string, actorId: string) {
    await this.ac
      .user(actorId)
      .workspace(workspaceId)
      .assert('Workspace.Blobs.Read');
  }

  private async getArtifactForAsset(
    workspaceId: string,
    actorId: string,
    artifactId: string
  ) {
    await this.assertRead(workspaceId, actorId);
    return await this.requireArtifact(workspaceId, artifactId);
  }

  private async requireArtifact(workspaceId: string, artifactId: string) {
    const artifact = await this.models.officeArtifact.get(
      workspaceId,
      artifactId
    );
    if (!artifact) {
      throw new Error(`Office artifact not found: ${artifactId}`);
    }
    return artifact;
  }

  private assetEvidence(
    revision: OfficeRevision,
    kind: OfficeRevisionAssetKind
  ) {
    if (kind === 'package') {
      return {
        key: revision.packageBlobKey,
        mimeType: revision.packageMimeType,
        byteSize: revision.packageByteSize,
        fingerprint: revision.packageFingerprint,
        maxBytes: MAX_OFFICE_PACKAGE_DOWNLOAD_BYTES,
      };
    }
    if (
      !revision.stateBlobKey ||
      !revision.stateByteSize ||
      !revision.stateFingerprint
    ) {
      throw new Error(`Office revision has no semantic state: ${revision.id}`);
    }
    return {
      key: revision.stateBlobKey,
      mimeType: undefined,
      byteSize: revision.stateByteSize,
      fingerprint: revision.stateFingerprint,
      maxBytes: MAX_OFFICE_STATE_DOWNLOAD_BYTES,
    };
  }

  private semanticKind(kind: OfficeArtifactKind): OfficeSemanticKind {
    switch (kind) {
      case OfficeArtifactKind.document:
        return 'document';
      case OfficeArtifactKind.workbook:
        return 'workbook';
      case OfficeArtifactKind.presentation:
        return 'presentation';
      case OfficeArtifactKind.pdf:
        return 'pdf';
    }
  }
}

export type OfficeArtifactRecord = OfficeArtifact;
export type OfficeRevisionRecord = OfficeRevision;
