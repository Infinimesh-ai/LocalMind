import { createHash, randomUUID } from 'node:crypto';

import { officeDownloadFileName } from '@localmind/office';
import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Prisma } from '@prisma/client';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';

import { BadRequest, readBufferWithLimit, ResourceConflict } from '../../base';
import { Models } from '../../models';
import {
  PROJECT_BLOB_MAX_BYTES,
  type ProjectActor,
  projectResourceHash,
} from '../../models/project-resource';
import type { ProjectEditLeaseProof } from '../../models/project-resource-edit-lease';
import {
  createDocWithMarkdown,
  parseYDocFromBinary,
  parseYDocToMarkdown,
  updateDocWithMarkdown,
} from '../../native';
import {
  inspectDocumentCopySnapshot,
  retitleDocumentCopySnapshot,
} from '../doc/copy-snapshot';
import {
  decodeNativeText,
  encodeNativeText,
  nativeFileSearchText,
} from '../office/file-content';
import {
  OFFICE_FORMATS,
  officePackageSearchText,
  readNativeOfficeState,
} from '../office/formats';
import { StorageRuntimeProvider } from '../storage-runtime';

declare global {
  interface Events {
    'project.resource.changed': { projectId: string; resourceId: string };
  }
}

@Injectable()
export class ProjectBlobStorage {
  constructor(
    private readonly models: Models,
    private readonly runtime: StorageRuntimeProvider
  ) {}

  async put(
    input: ProjectActor & {
      bytes: Buffer;
      mimeType: string;
      mimeIdentity?: boolean;
    }
  ) {
    await this.models.projectResource.assertMember(input);
    if (
      input.bytes.length > PROJECT_BLOB_MAX_BYTES ||
      !input.mimeType ||
      input.mimeType.length > 256
    )
      throw new BadRequest('Project Blob exceeds its bounds');
    const fingerprint = createHash('sha256').update(input.bytes).digest('hex');
    const key = `sha256-${fingerprint}${input.mimeIdentity ? '-' + createHash('sha256').update(input.mimeType).digest('hex').slice(0, 16) : ''}`;
    return this.models.projectResource.storeBlob(
      {
        ...input,
        key,
        fingerprint,
        byteSize: input.bytes.length,
      },
      async () => {
        const metadata = await this.runtime.putObject(
          'blob',
          this.objectKey(input.projectId, key),
          input.bytes,
          {
            contentType: input.mimeType,
            contentLength: input.bytes.length,
          }
        );
        if (
          metadata.contentLength !== input.bytes.length ||
          metadata.contentType !== input.mimeType
        )
          throw new BadRequest(
            'Project Blob storage did not preserve its evidence'
          );
      }
    );
  }

  async read(input: ProjectActor & { key: string }) {
    const blob = await this.models.projectResource.getBlob(input);
    const stored = await this.runtime.getObject(
      'blob',
      this.objectKey(input.projectId, blob.key)
    );
    if (!stored.body)
      throw new BadRequest('Project Blob bytes are unavailable');
    if (
      stored.metadata?.contentLength !== blob.byteSize ||
      stored.metadata.contentType !== blob.mimeType
    ) {
      stored.body.destroy();
      throw new BadRequest('Project Blob metadata does not match');
    }
    const bytes = await readBufferWithLimit(
      stored.body,
      PROJECT_BLOB_MAX_BYTES
    );
    if (
      bytes.length !== blob.byteSize ||
      createHash('sha256').update(bytes).digest('hex') !== blob.fingerprint
    )
      throw new BadRequest('Project Blob content does not match');
    await this.models.projectResource.assertMember(input);
    return { blob, bytes };
  }

  async deletePendingSessionBlob(input: {
    deletionId: string;
    projectId: string;
    key: string;
  }) {
    await this.runtime.deleteObject(
      'blob',
      this.objectKey(input.projectId, input.key)
    );
    await this.models.projectResource.completePendingSessionBlobDeletion(input);
  }

  private objectKey(projectId: string, key: string) {
    // An explicit namespace prevents collisions with Workspace Blob paths.
    return `projects/${encodeURIComponent(projectId)}/${key}`;
  }
}

@Injectable()
export class ProjectResourceService {
  constructor(
    private readonly models: Models,
    private readonly blobs: ProjectBlobStorage
  ) {}

  async createDocument(
    input: ProjectActor & {
      title: string;
      markdown: string;
      parentId?: string | null;
      requestKey: string;
      kind?: 'page' | 'edgeless';
      origin?: 'user' | 'ai';
      sourceSessionId?: string;
    }
  ) {
    await this.models.projectResource.assertMember(input);
    if (Buffer.byteLength(input.markdown) > 1024 * 1024)
      throw new BadRequest('Project document content exceeds its bounds');
    const kind = input.kind ?? 'page';
    const requestHash = projectResourceHash({
      kind,
      title: input.title,
      markdown: input.markdown,
      parentId: input.parentId ?? null,
      origin: input.origin ?? 'user',
    });
    const previous = await this.withWriteSources(input, () =>
      this.models.projectResource.findCreation({
        ...input,
        requestHash,
      })
    );
    if (previous) return previous;
    const resourceId = randomUUID();
    const bytes = Buffer.from(
      createDocWithMarkdown(input.title, input.markdown, resourceId)
    );
    const resource = await this.withWriteSources(input, async () => {
      const blob = await this.blobs.put({
        ...input,
        bytes,
        mimeType: 'application/vnd.localmind.yjs',
      });
      return this.models.projectResource.create({
        ...input,
        kind,
        resourceId,
        blobKey: blob.key,
        searchText: parseYDocToMarkdown(bytes, resourceId, true).markdown.slice(
          0,
          250000
        ),
        requestHash,
      });
    });
    return resource;
  }

  async readDocument(
    input: ProjectActor & { resourceId: string; sequence?: number }
  ) {
    const resource = await this.models.projectResource.get(input);
    if (resource.kind !== 'page' && resource.kind !== 'edgeless')
      throw new BadRequest('This Project resource requires its native editor');
    const revision = await this.models.projectResource.revision(input);
    const { bytes } = await this.blobs.read({
      ...input,
      key: revision.blobKey,
    });
    await this.models.projectResource.get(input);
    return { resource, revision, bytes };
  }

  async createFile(
    input: ProjectActor & {
      origin?: 'user' | 'ai';
      sourceSessionId?: string;
      title: string;
      blobKey: string;
      parentId?: string | null;
      requestKey: string;
    }
  ) {
    return this.withWriteSources(input, async () => {
      const stored = await this.blobs.read({
        ...input,
        key: input.blobKey,
      });
      const file = await this.models.projectResource.create({
        ...input,
        kind: 'file',
        searchText: nativeFileSearchText(stored.bytes, input.title),
      });
      return file;
    });
  }

  async readFile(
    input: ProjectActor & { resourceId: string; sequence?: number }
  ) {
    const resource = await this.models.projectResource.get(input);
    if (resource.kind !== 'file') throw new BadRequest('Choose a Project file');
    const revision = await this.models.projectResource.revision(input);
    const stored = await this.blobs.read({ ...input, key: revision.blobKey });
    await this.models.projectResource.get(input);
    return { ...stored, resource, revision };
  }

  async readTextFile(
    input: ProjectActor & { resourceId: string; sequence?: number }
  ) {
    const result = await this.readFile(input);
    return {
      ...result,
      text: decodeNativeText(result.bytes, result.resource.title),
    };
  }

  async saveFile(
    input: ProjectActor & {
      resourceId: string;
      expectedContentVersion: number;
      requestKey: string;
      editLease?: ProjectEditLeaseProof;
      sourceSessionId?: string;
      origin?: 'user' | 'ai';
      readContentVersion?: number;
    } & ({ text: string } | { blobKey: string })
  ) {
    return this.withWriteSources(input, async () => {
      const resource = await this.models.projectResource.get(input);
      if (resource.kind !== 'file')
        throw new BadRequest('Choose a Project file');
      if (
        input.origin === 'ai' &&
        input.readContentVersion !== input.expectedContentVersion
      )
        throw new BadRequest(
          'Read the complete current Project file before editing'
        );
      const requestHash = projectResourceHash({
        content:
          'text' in input ? { text: input.text } : { blobKey: input.blobKey },
        expectedContentVersion: input.expectedContentVersion,
        origin: input.origin ?? 'user',
      });
      const previous = await this.models.projectResource.findRevisionRequest({
        ...input,
        requestHash,
      });
      if (previous) return previous;
      const current = await this.readFile(input);
      if (current.revision.sequence !== input.expectedContentVersion)
        throw new ResourceConflict(
          'Project content changed; reload and compare before saving'
        );
      await this.models.projectResourceEditLease.assertHeld(input);
      // Validate the existing encoding before allowing a text replacement.
      if ('text' in input) decodeNativeText(current.bytes, resource.title);
      const stored =
        'text' in input
          ? {
              bytes: encodeNativeText(input.text, resource.title),
              mimeType: current.blob.mimeType,
            }
          : await this.blobs
              .read({ ...input, key: input.blobKey })
              .then(value => ({
                bytes: value.bytes,
                mimeType: value.blob.mimeType,
              }));
      const blob = await this.blobs.put({
        ...input,
        ...stored,
        mimeIdentity: true,
      });
      return this.models.projectResource.appendRevision({
        ...input,
        blobKey: blob.key,
        requestHash,
        origin: input.origin ?? 'user',
        searchText: nativeFileSearchText(stored.bytes, resource.title),
      });
    });
  }

  async history(
    input: ProjectActor & {
      resourceId: string;
      before?: number;
      limit?: number;
    }
  ) {
    const resource = await this.models.projectResource.get(input);
    if (!resource.officeArtifactId)
      return (await this.models.projectResource.revisions(input)).map(r => ({
        id: r.id,
        sequence: r.sequence,
        createdAt: r.createdAt,
        actorId: r.createdBy,
      }));
    return (
      await this.models.officeArtifact.listRevisions(
        { projectId: input.projectId },
        resource.officeArtifactId,
        input.limit,
        input.before
      )
    ).map(r => ({
      id: r.id,
      sequence: r.sequence,
      createdAt: r.createdAt,
      actorId: r.createdBy,
    }));
  }

  async restoreVersion(
    input: ProjectActor & {
      resourceId: string;
      sequence: number;
      expectedContentVersion: number;
      requestKey: string;
      origin?: 'user' | 'ai';
      sourceSessionId?: string;
      editLease?: ProjectEditLeaseProof;
    }
  ) {
    return this.withWriteSources(input, async () => {
      const resource = await this.models.projectResource.get(input);
      if (resource.kind === 'folder')
        throw new BadRequest('Folders do not have content history');
      const requestHash = projectResourceHash({
        operation: 'restore_version',
        sequence: input.sequence,
        expectedContentVersion: input.expectedContentVersion,
        origin: input.origin ?? 'user',
      });
      if (resource.officeArtifactId) {
        const owner = { projectId: input.projectId };
        const idempotencyKey = `restore:${projectResourceHash([input.actorId, input.requestKey])}`;
        const replay = await this.models.officeArtifact.getRevisionByRequest(
          owner,
          resource.officeArtifactId,
          idempotencyKey
        );
        if (replay) {
          if (replay.idempotencyFingerprint !== `sha256:${requestHash}`)
            throw new ResourceConflict(
              'History request was reused with different content'
            );
          return { id: replay.id, sequence: replay.sequence };
        }
        const current = await this.models.officeArtifact.getCurrentRevision(
          owner,
          resource.officeArtifactId
        );
        if (!current || current.sequence !== input.expectedContentVersion)
          throw new ResourceConflict(
            'Project Office content changed before history restoration'
          );
        await this.models.projectResourceEditLease.assertHeld(input);
        const revision = await this.models.officeArtifact.getRevisionBySequence(
          owner,
          resource.officeArtifactId,
          input.sequence
        );
        if (!revision)
          throw new BadRequest('Office history revision is unavailable');
        const { bytes } = await this.blobs.read({
          ...input,
          key: revision.packageBlobKey,
        });
        const restored = await this.models.officeArtifact.appendRevision({
          projectId: input.projectId,
          actorId: input.actorId,
          artifactId: resource.officeArtifactId,
          expectedParentRevisionId: current.id,
          origin: input.origin ?? 'user',
          idempotencyKey,
          idempotencyFingerprint: `sha256:${requestHash}`,
          package: {
            key: revision.packageBlobKey,
            mimeType: revision.packageMimeType,
            byteSize: revision.packageByteSize,
            fingerprint: revision.packageFingerprint,
          },
          state:
            revision.stateBlobKey &&
            revision.stateByteSize &&
            revision.stateFingerprint
              ? {
                  key: revision.stateBlobKey,
                  byteSize: revision.stateByteSize,
                  fingerprint: revision.stateFingerprint,
                }
              : undefined,
          modelVersion: revision.modelVersion,
          operationSummary: {
            operation: 'restore_version',
            sourceRevisionId: revision.id,
          },
        });
        const format = Object.values(OFFICE_FORMATS).find(
          f => f.kind === resource.kind
        );
        if (!format) throw new BadRequest('Unsupported Office format');
        await this.models.projectResource.updateSearchText({
          ...input,
          sequence: restored.revision.sequence,
          text: await officePackageSearchText(
            await readNativeOfficeState(format, bytes),
            bytes
          ),
        });
        await this.models.projectResourceEditLease.assertHeld(input);
        return {
          id: restored.revision.id,
          sequence: restored.revision.sequence,
        };
      }
      const replay = await this.models.projectResource.findRevisionRequest({
        ...input,
        requestHash,
      });
      if (replay) return replay;
      if (resource.contentVersion !== input.expectedContentVersion)
        throw new ResourceConflict(
          'Project content changed before history restoration'
        );
      await this.models.projectResourceEditLease.assertHeld(input);
      const source = await this.models.projectResource.revision(input);
      if (resource.kind === 'file') {
        const blob = await this.blobs.read({ ...input, key: source.blobKey });
        return this.models.projectResource.appendRevision({
          ...input,
          blobKey: source.blobKey,
          requestHash,
          origin: input.origin ?? 'user',
          searchText: nativeFileSearchText(blob.bytes, resource.title),
        });
      }
      const sourceContent = await this.readDocument(input);
      return this.saveDocument({
        ...input,
        requestHash,
        bytes: retitleDocumentCopySnapshot(
          sourceContent.bytes,
          resource.title,
          resource.id
        ),
      });
    });
  }

  async copy(
    input: ProjectActor & {
      resourceId: string;
      title: string;
      parentId?: string | null;
      expectedContentVersion: number;
      requestKey: string;
      origin?: 'user' | 'ai';
      sourceSessionId?: string;
    }
  ) {
    return this.withWriteSources(input, async () => {
      const source = await this.models.projectResource.get(input);
      if (source.kind === 'folder')
        throw new BadRequest('Recursive folder copying is not supported');
      const requestHash = projectResourceHash({
        operation: 'copy',
        sourceId: source.id,
        expectedContentVersion: input.expectedContentVersion,
        title: input.title,
        parentId: input.parentId ?? null,
      });
      const replay = await this.models.projectResource.findCreation({
        ...input,
        requestHash,
      });
      if (replay) return replay;
      if (source.officeArtifactId) {
        const owner = { projectId: input.projectId };
        const artifact = await this.models.officeArtifact.get(
          owner,
          source.officeArtifactId
        );
        const current = await this.models.officeArtifact.getCurrentRevision(
          owner,
          source.officeArtifactId
        );
        if (
          !artifact ||
          !current ||
          current.sequence !== input.expectedContentVersion
        )
          throw new ResourceConflict(
            'Source Office content changed before copying'
          );
        await this.blobs.read({ ...input, key: current.packageBlobKey });
        const copied = await this.models.officeArtifact.createOrReuseImported({
          projectId: input.projectId,
          actorId: input.actorId,
          kind: artifact.kind,
          title: input.title,
          sourceFileName: officeDownloadFileName(input.title, artifact.kind),
          source: {
            key: current.packageBlobKey,
            mimeType: current.packageMimeType,
            byteSize: current.packageByteSize,
            fingerprint: current.packageFingerprint,
          },
          state:
            current.stateBlobKey &&
            current.stateByteSize &&
            current.stateFingerprint
              ? {
                  key: current.stateBlobKey,
                  byteSize: current.stateByteSize,
                  fingerprint: current.stateFingerprint,
                }
              : undefined,
          modelVersion: current.modelVersion,
          compatibility: artifact.compatibility as Prisma.InputJsonObject,
          importIdempotencyKey: `copy:${projectResourceHash([input.actorId, input.requestKey])}`,
          importFingerprint: `sha256:${requestHash}`,
          operationSummary: {
            operation: 'copy',
            sourceResourceId: source.id,
            sourceRevisionId: current.id,
          },
        });
        return this.models.projectResource.create({
          ...input,
          resourceId: copied.artifact.id,
          officeArtifactId: copied.artifact.id,
          kind: artifact.kind,
          requestHash,
        });
      }
      if (source.contentVersion !== input.expectedContentVersion)
        throw new ResourceConflict('Source content changed before copying');
      const revision = await this.models.projectResource.revision(input);
      const resourceId = randomUUID();
      if (source.kind === 'file') {
        const { bytes } = await this.blobs.read({
          ...input,
          key: revision.blobKey,
        });
        return this.models.projectResource.create({
          ...input,
          resourceId,
          kind: 'file',
          blobKey: revision.blobKey,
          requestHash,
          searchText: nativeFileSearchText(bytes, input.title),
        });
      }
      const current = await this.readDocument(input);
      const bytes = retitleDocumentCopySnapshot(
        current.bytes,
        input.title,
        resourceId
      );
      const inspected = inspectDocumentCopySnapshot(bytes);
      for (const key of inspected.blobIds)
        await this.models.projectResource.getBlob({ ...input, key });
      const blob = await this.blobs.put({
        ...input,
        bytes,
        mimeType: 'application/vnd.localmind.yjs',
      });
      return this.models.projectResource.create({
        ...input,
        resourceId,
        kind: source.kind,
        blobKey: blob.key,
        requestHash,
        attachmentKeys: inspected.blobIds,
        searchText: parseYDocToMarkdown(bytes, resourceId, true).markdown.slice(
          0,
          250000
        ),
      });
    });
  }

  async saveDocument(
    input: ProjectActor & {
      resourceId: string;
      bytes: Buffer;
      expectedContentVersion: number;
      requestKey: string;
      origin?: 'user' | 'ai';
      sourceSessionId?: string;
      requestHash?: string;
      editLease?: ProjectEditLeaseProof;
    }
  ) {
    return this.withWriteSources(input, async () => {
      const resource = await this.models.projectResource.get(input);
      if (resource.kind !== 'page' && resource.kind !== 'edgeless')
        throw new BadRequest(
          'This Project resource requires its native editor'
        );
      const inspected = inspectDocumentCopySnapshot(input.bytes);
      const requestHash =
        input.requestHash ??
        projectResourceHash({
          snapshot: createHash('sha256').update(inspected.binary).digest('hex'),
          expectedContentVersion: input.expectedContentVersion,
          origin: input.origin ?? 'user',
        });
      const previous = await this.models.projectResource.findRevisionRequest({
        ...input,
        requestHash,
      });
      if (previous) return previous;
      const parsed = parseYDocFromBinary(inspected.binary, resource.id);
      for (const id of new Set(
        parsed.blocks.flatMap(block => block.refDocId ?? [])
      )) {
        await this.models.projectResource.get({ ...input, resourceId: id });
      }
      for (const key of inspected.blobIds)
        await this.models.projectResource.getBlob({ ...input, key });
      const blob = await this.blobs.put({
        ...input,
        bytes: inspected.binary,
        mimeType: 'application/vnd.localmind.yjs',
      });
      const revision = await this.models.projectResource.appendRevision({
        ...input,
        blobKey: blob.key,
        origin: input.origin ?? 'user',
        requestHash,
        attachmentKeys: inspected.blobIds,
        searchText: parseYDocToMarkdown(
          inspected.binary,
          resource.id,
          true
        ).markdown.slice(0, 250000),
      });
      if (parsed.title && parsed.title !== resource.title)
        await this.models.projectResource.change({
          ...input,
          expectedVersion: resource.version,
          title: parsed.title,
        });
      return revision;
    });
  }

  async updateMarkdown(
    input: ProjectActor & {
      resourceId: string;
      markdown: string;
      expectedContentVersion: number;
      requestKey: string;
      origin: 'user' | 'ai';
      sourceSessionId?: string;
      readContentVersion?: number;
      editLease?: ProjectEditLeaseProof;
    }
  ) {
    if (Buffer.byteLength(input.markdown) > 1024 * 1024)
      throw new BadRequest('Project document content exceeds its bounds');
    const requestHash = projectResourceHash({
      markdown: input.markdown,
      expectedContentVersion: input.expectedContentVersion,
      origin: input.origin,
    });
    const previous = await this.withWriteSources(input, () =>
      this.models.projectResource.findRevisionRequest({ ...input, requestHash })
    );
    if (previous) return previous;
    if (
      input.origin === 'ai' &&
      input.readContentVersion !== input.expectedContentVersion
    )
      throw new BadRequest('Read the current Project document before editing.');
    const current = await this.readDocument(input);
    if (current.revision.sequence !== input.expectedContentVersion)
      throw new BadRequest(
        'Project content changed; reload and compare before saving'
      );
    const delta = updateDocWithMarkdown(
      current.bytes,
      input.markdown,
      input.resourceId
    );
    const doc = new Doc();
    try {
      applyUpdate(doc, current.bytes);
      applyUpdate(doc, delta);
      return await this.saveDocument({
        ...input,
        bytes: Buffer.from(encodeStateAsUpdate(doc)),
        requestHash,
      });
    } finally {
      doc.destroy();
    }
  }

  @Transactional()
  async createFolder(
    input: ProjectActor & {
      parentId?: string | null;
      title: string;
      requestKey: string;
      origin?: 'user' | 'ai';
      sourceSessionId?: string;
    }
  ) {
    const folder = await this.withWriteSources(input, () =>
      this.models.projectResource.create({ ...input, kind: 'folder' })
    );
    return folder;
  }

  async change(
    input: Parameters<Models['projectResource']['change']>[0] & {
      origin?: 'user' | 'ai';
      sourceSessionId?: string;
      editLease?: ProjectEditLeaseProof;
    }
  ) {
    return this.withWriteSources(input, async () => {
      const previous =
        await this.models.projectResource.findChangeRequest(input);
      if (previous) return previous;
      const node = await this.models.projectResource.get({
        ...input,
        includeTrash: input.trash === false,
      });
      if (input.origin === 'ai' || (input.title && input.title !== node.title))
        await this.models.projectResourceEditLease.assertHeld(input);
      if (
        input.title &&
        input.title !== node.title &&
        (node.kind === 'page' || node.kind === 'edgeless')
      ) {
        const current = await this.readDocument(input);
        const bytes = retitleDocumentCopySnapshot(
          current.bytes,
          input.title,
          node.id
        );
        const blob = await this.blobs.put({
          ...input,
          bytes,
          mimeType: 'application/vnd.localmind.yjs',
        });
        await this.models.projectResource.appendRevision({
          ...input,
          blobKey: blob.key,
          expectedContentVersion: current.revision.sequence,
          requestKey: `rename:${projectResourceHash(input.requestKey ?? randomUUID())}`,
          origin: input.origin ?? 'user',
          attachmentKeys: inspectDocumentCopySnapshot(bytes).blobIds,
          searchText: parseYDocToMarkdown(bytes, node.id, true).markdown.slice(
            0,
            250000
          ),
        });
      }
      const changed = await this.models.projectResource.change(input);
      return changed;
    });
  }

  private async withWriteSources<T>(
    input: ProjectActor & { origin?: 'user' | 'ai'; sourceSessionId?: string },
    execute: () => Promise<T>
  ) {
    if (input.origin === 'ai') {
      if (!input.sourceSessionId)
        throw new BadRequest(
          'Project AI writes require their source conversation'
        );
      return this.models.copilotContext.withProjectSourcesShared(
        {
          ...input,
          sessionId: input.sourceSessionId,
          sink: {
            type: 'tool_write',
            projectId: input.projectId,
            id: input.projectId,
            phase: 'execute',
          },
        },
        () => this.models.projectResource.withMember(input, execute, true)
      );
    }
    return this.models.projectResource.withMember(input, execute, true);
  }
}
