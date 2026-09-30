import { createHash } from 'node:crypto';

import {
  createNativeFile,
  NativeFileContentSchema,
  officeDownloadFileName,
} from '@localmind/office';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  BadRequest,
  NotFound,
  readBufferWithLimit,
  ResourceConflict,
} from '../../base';
import { Models } from '../../models';
import {
  nativeOperationHash,
  type WorkspaceNativeIdentity,
} from '../../models/workspace-native-resource';
import {
  WorkspaceNativeResourceAccess,
  WorkspaceOrganizationService,
  WorkspaceResourceService,
} from '../doc';
import { ResourceError } from '../doc/resource-types';
import { PermissionAccess } from '../permission';
import { OfficeArtifactService } from './artifact-service';
import {
  decodeNativeText,
  encodeNativeText,
  NATIVE_FILE_MAX_BYTES,
  nativeFileSearchText,
} from './file-content';
import {
  OFFICE_FORMATS,
  officePackageSearchText,
  readNativeOfficeState,
} from './formats';
import { OfficeImportService } from './import-service';
import { OfficeResourceStorage } from './resource-storage';

export const nativeTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(480)
  .refine(
    value =>
      [...value].every(
        character =>
          character.charCodeAt(0) >= 32 &&
          character !== '/' &&
          character !== '\\'
      ),
    'Invalid file name'
  );
export const nativeRequestKeySchema = z.string().min(1).max(256);
const resourceResultSchema = z.object({
  id: z.string(),
  kind: z.enum(['file', 'office']),
  workspaceId: z.string(),
  title: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number(),
  metadataVersion: z.number(),
  contentVersion: z.number(),
  revisionId: z.string(),
  canEdit: z.boolean().optional(),
  canManage: z.boolean().optional(),
  canRename: z.boolean().optional(),
  canMove: z.boolean().optional(),
  canCopy: z.boolean().optional(),
  canTrash: z.boolean().optional(),
  canRestore: z.boolean().optional(),
  canDeletePermanently: z.boolean().optional(),
  atRoot: z.boolean().optional(),
  folderIds: z.array(z.string()).optional(),
  folderPaths: z.array(z.string()).optional(),
  searchStatus: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  trashedAt: z.coerce.date().nullable(),
  deletedAt: z.coerce.date().nullable(),
});
function resourceReceipt(resource: z.infer<typeof resourceResultSchema>) {
  return {
    ...resource,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
    trashedAt: resource.trashedAt?.toISOString() ?? null,
    deletedAt: resource.deletedAt?.toISOString() ?? null,
  };
}
type Actor = { workspaceId: string; actorId: string };
type Identity = WorkspaceNativeIdentity & { actorId: string };
type Record = Awaited<ReturnType<Models['workspaceNativeResource']['get']>>;

@Injectable()
export class WorkspaceNativeResourceService {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly access: WorkspaceNativeResourceAccess,
    private readonly organization: WorkspaceOrganizationService,
    private readonly resources: WorkspaceResourceService,
    private readonly storage: OfficeResourceStorage,
    private readonly imports: OfficeImportService,
    private readonly artifacts: OfficeArtifactService
  ) {}

  describe(resource: Record) {
    return {
      id: resource.resourceId,
      kind: resource.kind,
      workspaceId: resource.workspaceId,
      title: resource.title,
      fileName: resource.officeKind
        ? officeDownloadFileName(resource.title, resource.officeKind)
        : resource.title,
      mimeType: resource.mimeType,
      byteSize: resource.byteSize,
      metadataVersion: resource.metadataVersion,
      contentVersion: resource.contentVersion,
      revisionId: resource.revisionId,
      searchStatus:
        resource.state.searchVersion < resource.contentVersion
          ? 'pending'
          : resource.state.searchText
            ? 'content'
            : 'metadata_only',
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
      trashedAt: resource.state.trashedAt,
      deletedAt: resource.state.deletedAt,
    };
  }

  async get(input: Identity, trash = false) {
    const resource = await this.access.assert(input, { trash });
    const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
    const { locations, paths } =
      await this.organization.nativeResourceLocations(input);
    const rights = await Promise.all(
      locations.map(location =>
        this.models.workspaceDirectoryGrant.rights({
          ...input,
          directoryIds: location.path,
        })
      )
    );
    const canEdit =
      !resource.state.trashedAt &&
      (await acl.can('Workspace.Blobs.Write')) &&
      rights.every(row => row.canWrite);
    const canManage =
      (await acl.can('Workspace.Blobs.Write')) &&
      (await acl.can('Workspace.Sync')) &&
      rights.every(row => row.canWrite && row.canOrganize);
    return {
      ...this.describe(resource),
      canEdit,
      canManage,
      canRename: canManage && !resource.state.trashedAt,
      canMove: canManage && !resource.state.trashedAt,
      canCopy:
        !resource.state.trashedAt &&
        (await acl.can('Workspace.Blobs.Write')) &&
        (await acl.can('Workspace.Sync')),
      canTrash: canManage && !resource.state.trashedAt,
      canRestore: canManage && !!resource.state.trashedAt,
      canDeletePermanently:
        canManage &&
        !!resource.state.trashedAt &&
        (await acl.can('Workspace.Delete')),
      folderPaths: paths,
      folderIds: locations.flatMap(location =>
        location.folderId ? [location.folderId] : []
      ),
      atRoot: locations.some(location => location.folderId === null),
    };
  }

  async list(
    input: Actor & {
      cursor?: string;
      query?: string;
      trash?: boolean;
      limit?: number;
    }
  ) {
    await this.ac
      .user(input.actorId)
      .workspace(input.workspaceId)
      .assert('Workspace.Blobs.Read');
    const limit = z
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(input.limit ?? 50);
    const query = z
      .string()
      .max(256)
      .parse(input.query ?? '');
    const cursor = input.cursor
      ? z
          .object({ scope: z.string(), after: z.string().max(600) })
          .strict()
          .parse(JSON.parse(input.cursor))
      : null;
    const scope = nativeOperationHash([
      input.workspaceId,
      input.actorId,
      query,
      !!input.trash,
    ]);
    if (cursor && cursor.scope !== scope)
      throw new BadRequest('The file cursor belongs to another query');
    const items = [];
    let after = cursor?.after;
    let more = true;
    // Bound scans even when nearly every candidate is hidden by directory ACL.
    for (let page = 0; page < 20 && items.length < limit && more; page++) {
      const candidates = await this.models.workspaceNativeResource.candidates({
        ...input,
        query,
        afterId: after,
        limit: limit - items.length,
      });
      more = candidates.length === limit - items.length;
      for (const row of candidates) {
        after = `${row.id}:${row.kind}`;
        try {
          items.push(
            await this.get(
              { ...input, resourceId: row.id, kind: row.kind },
              input.trash
            )
          );
        } catch (error) {
          if (!(error instanceof ResourceError) && !(error instanceof NotFound))
            throw error;
        }
      }
    }
    return {
      items,
      nextCursor: more && after ? JSON.stringify({ scope, after }) : null,
    };
  }

  async read(input: Identity & { sequence?: number }) {
    const current = await this.access.assert(input);
    if (current.kind !== 'file')
      throw new BadRequest('Use the Office resource reader');
    const revision =
      input.sequence === undefined
        ? current.state.revision
        : await this.models.workspaceNativeResource.fileRevision({
            ...input,
            sequence: input.sequence,
          });
    const bytes = await this.readBlob(
      input,
      revision.blobKey,
      revision.byteSize,
      revision.fingerprint
    );
    await this.access.assert(input);
    return {
      ...this.describe(current),
      contentVersion: revision.sequence,
      revisionId: revision.id,
      mimeType: revision.mimeType,
      byteSize: revision.byteSize,
      bytes,
    };
  }

  async readText(input: Identity & { sequence?: number }) {
    const { bytes, ...resource } = await this.read(input);
    return { ...resource, text: decodeNativeText(bytes, resource.title) };
  }

  async create(
    input: Actor & {
      title: string;
      requestKey: string;
      resourceId?: string;
      fileOnly?: boolean;
      folderId?: string | null;
      blobKey?: string;
      content?: z.input<typeof NativeFileContentSchema>;
      origin?: 'user' | 'ai' | 'import' | 'copy' | 'publication';
      sourceSessionId?: string;
    }
  ) {
    const title = nativeTitleSchema.parse(input.title);
    nativeRequestKeySchema.parse(input.requestKey);
    if ((input.blobKey === undefined) === (input.content === undefined))
      throw new BadRequest('Choose generated content or an uploaded file');
    const content =
      input.content === undefined
        ? undefined
        : NativeFileContentSchema.parse(input.content);
    const fileName =
      content && !title.toLowerCase().endsWith(`.${content.format}`)
        ? `${title}.${content.format}`
        : title;
    const hash = nativeOperationHash({
      action: 'create',
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.fileOnly ? { fileOnly: true } : {}),
      title: fileName,
      folderId: input.folderId ?? null,
      blobKey: input.blobKey,
      content,
    });
    return this.resources.snapshot(input, async () => {
      const authorize = async () => {
        const acl = this.ac.user(input.actorId).workspace(input.workspaceId);
        await Promise.all([
          acl.assert('Workspace.CreateDoc'),
          acl.assert('Workspace.Blobs.Write'),
        ]);
        await this.organization.assertResourceFolder(
          input.workspaceId,
          input.actorId,
          input.folderId ?? null,
          true
        );
      };
      await authorize();
      const replay = await this.models.workspaceNativeResource.receipt(
        input,
        hash
      );
      if (replay) {
        const resourceId = replay.fileId ?? replay.artifactId;
        if (!resourceId)
          throw new ResourceConflict('Native resource receipt is invalid');
        await this.access.assert({
          ...input,
          kind: replay.fileId ? 'file' : 'office',
          resourceId,
        });
        return resourceResultSchema.parse(replay.result);
      }
      let blobKey = input.blobKey;
      let generatedBytes: Buffer | undefined;
      if (content) {
        const generated = createNativeFile(content);
        generatedBytes = Buffer.from(generated.bytes);
        blobKey = await this.storage.putGenerated(
          input.workspaceId,
          input.actorId,
          Buffer.from(generated.bytes),
          generated.mimeType,
          authorize
        );
      }
      if (!blobKey) throw new BadRequest('File content is required');
      const blob = await this.models.blob.get(input.workspaceId, blobKey);
      if (!blob || blob.deletedAt || blob.status !== 'completed')
        throw new NotFound('Uploaded file is unavailable');
      const office =
        !input.fileOnly && /\.(docx|xlsx|pptx|pdf)$/i.test(fileName);
      let identity: WorkspaceNativeIdentity;
      if (office) {
        const saved = await this.imports.import({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          sourceBlobKey: blobKey,
          generatedBytes,
          sourceFileName: fileName,
          title: fileName,
          parentId: input.folderId,
          generation: input.sourceSessionId
            ? { sessionId: input.sourceSessionId, requestKey: input.requestKey }
            : undefined,
          importIdempotencyKey: `native:${nativeOperationHash([input.actorId, input.requestKey])}`,
        });
        identity = {
          workspaceId: input.workspaceId,
          resourceId: saved.artifact.id,
          kind: 'office',
        };
      } else {
        const bytes =
          generatedBytes ?? (await this.readBlob(input, blobKey, blob.size));
        const fingerprint = createHash('sha256').update(bytes).digest('hex');
        blobKey = await this.storage.putGenerated(
          input.workspaceId,
          input.actorId,
          bytes,
          blob.mime,
          authorize
        );
        const saved = await this.models.workspaceFile.create({
          id: input.resourceId,
          workspaceId: input.workspaceId,
          createdBy: input.actorId,
          sourceSessionId: input.sourceSessionId,
          origin: input.origin ?? 'user',
          fileName,
          mimeType: blob.mime,
          byteSize: bytes.length,
          blobKey,
          fingerprint,
          requestKey: `native:${nativeOperationHash([input.actorId, input.requestKey])}`,
          requestFingerprint: hash,
        });
        identity = {
          workspaceId: input.workspaceId,
          resourceId: saved.id,
          kind: 'file',
        };
        await this.models.workspaceNativeResource.index({
          ...identity,
          sequence: 1,
          text: nativeFileSearchText(bytes, fileName),
        });
      }
      if (input.folderId && identity.kind === 'file')
        await this.organization.placeNewNativeResource({
          ...identity,
          actorId: input.actorId,
          folderId: input.folderId,
          authorize,
        });
      await authorize();
      const result = await this.get({ ...identity, actorId: input.actorId });
      await this.models.workspaceNativeResource.record({
        ...identity,
        actorId: input.actorId,
        requestKey: input.requestKey,
        requestHash: hash,
        action: 'create',
        result: resourceReceipt(
          await this.get({ ...identity, actorId: input.actorId })
        ),
      });
      return result;
    });
  }

  async save(
    input: Identity & {
      expectedContentVersion: number;
      requestKey: string;
      text?: string;
      blobKey?: string;
      sourceSessionId?: string;
      origin?: 'user' | 'ai' | 'import' | 'copy' | 'publication';
    }
  ) {
    nativeRequestKeySchema.parse(input.requestKey);
    if ((input.text === undefined) === (input.blobKey === undefined))
      throw new BadRequest(
        'Choose complete text or an explicit replacement file'
      );
    const hash = nativeOperationHash({
      action: 'save',
      resourceId: input.resourceId,
      expectedContentVersion: input.expectedContentVersion,
      text: input.text,
      blobKey: input.blobKey,
    });
    return this.access.write(input, async () => {
      const current = await this.access.assert(input, { write: true });
      if (current.kind !== 'file')
        throw new BadRequest('Use native Office editing commands');
      const replay = await this.models.workspaceNativeResource.receipt(
        input,
        hash
      );
      if (replay) return resourceResultSchema.parse(replay.result);
      if (current.contentVersion !== input.expectedContentVersion)
        throw new ResourceConflict(
          'File content changed; read and merge before saving'
        );
      let mimeType = current.mimeType;
      let bytes: Buffer;
      let blobKey = input.blobKey;
      if (input.text !== undefined) {
        await this.readText(input);
        bytes = encodeNativeText(input.text, current.title);
        blobKey = await this.storage.putGenerated(
          input.workspaceId,
          input.actorId,
          bytes,
          mimeType,
          async () => {
            await this.access.assert(input, { write: true });
          }
        );
      } else {
        if (!blobKey) throw new BadRequest('Replacement file is required');
        const blob = await this.models.blob.get(input.workspaceId, blobKey);
        if (!blob || blob.deletedAt || blob.status !== 'completed')
          throw new NotFound('Replacement file is unavailable');
        mimeType = blob.mime;
        bytes = await this.readBlob(input, blobKey, blob.size);
        blobKey = await this.storage.putGenerated(
          input.workspaceId,
          input.actorId,
          bytes,
          mimeType,
          async () => {
            await this.access.assert(input, { write: true });
          }
        );
      }
      const result = await this.models.workspaceNativeResource.appendFile({
        ...input,
        blobKey,
        requestHash: hash,
        mimeType,
        byteSize: bytes.length,
        fingerprint: createHash('sha256').update(bytes).digest('hex'),
        searchText: nativeFileSearchText(bytes, current.title),
        origin: input.origin ?? 'user',
      });
      await this.models.workspaceNativeResource.record({
        ...input,
        requestHash: hash,
        action: 'save',
        result: resourceReceipt(this.describe(result)),
      });
      return this.describe(result);
    });
  }

  async change(
    input: Identity & {
      expectedVersion: number;
      requestKey: string;
      action: 'rename' | 'move' | 'trash' | 'restore' | 'delete';
      title?: string;
      folderId?: string | null;
      expectedDirectoryVersion?: string;
    }
  ) {
    nativeRequestKeySchema.parse(input.requestKey);
    const hash = nativeOperationHash({
      action: input.action,
      resourceId: input.resourceId,
      kind: input.kind,
      expectedVersion: input.expectedVersion,
      title: input.title,
      folderId: input.folderId,
      expectedDirectoryVersion: input.expectedDirectoryVersion,
    });
    return this.access.write(
      input,
      async () => {
        const replay = await this.models.workspaceNativeResource.receipt(
          input,
          hash
        );
        if (replay) return resourceResultSchema.parse(replay.result);
        const current = await this.models.workspaceNativeResource.get(input, {
          trash: true,
        });
        if (current.metadataVersion !== input.expectedVersion)
          throw new ResourceConflict(
            'File metadata changed; reload before editing'
          );
        if (
          (input.action === 'rename' || input.action === 'move') &&
          current.state.trashedAt
        )
          throw new BadRequest('Restore the file before editing it');
        if (input.action === 'restore' && !current.state.trashedAt)
          throw new BadRequest('This file is not in trash');
        if (input.action === 'delete')
          await this.ac
            .user(input.actorId)
            .workspace(input.workspaceId)
            .assert('Workspace.Delete');
        const location = await this.organization.nativeResourceLocations(input);
        if (input.action === 'restore' && input.folderId === undefined)
          for (const saved of location.locations)
            await this.organization.assertResourceFolder(
              input.workspaceId,
              input.actorId,
              saved.folderId,
              true
            );
        const result = await this.models.workspaceNativeResource.change({
          ...input,
          ...(input.action === 'trash'
            ? { restoreLocations: location.locations }
            : {}),
          title:
            input.action === 'rename'
              ? nativeTitleSchema.parse(input.title)
              : undefined,
          trash:
            input.action === 'trash'
              ? true
              : input.action === 'restore'
                ? false
                : undefined,
          permanentlyDelete: input.action === 'delete',
          ...(input.action === 'restore' ? { trashSourceId: null } : {}),
        });
        if (
          input.action === 'move' ||
          (input.action === 'restore' && input.folderId !== undefined)
        ) {
          if (!input.expectedDirectoryVersion)
            throw new BadRequest(
              'Read the current directory version before moving'
            );
          await this.organization.moveNativeResource({
            ...input,
            folderId: input.folderId ?? null,
            expectedDirectoryVersion: input.expectedDirectoryVersion,
            authorize: async () => {
              await this.ac
                .user(input.actorId)
                .workspace(input.workspaceId)
                .assert('Workspace.Sync');
            },
          });
        }
        await this.models.workspaceNativeResource.record({
          ...input,
          requestHash: hash,
          action: input.action,
          result: resourceReceipt(this.describe(result)),
        });
        return this.describe(result);
      },
      { trash: true, deleted: true, organize: true }
    );
  }

  async history(input: Identity & { before?: number; limit?: number }) {
    await this.access.assert(input);
    if (input.kind === 'file')
      return (await this.models.workspaceNativeResource.history(input)).map(
        r => ({
          id: r.id,
          sequence: r.sequence,
          createdAt: r.createdAt,
          actorId: r.actorId,
          byteSize: r.byteSize,
        })
      );
    const rows = await this.models.officeArtifact.listRevisions(
      input.workspaceId,
      input.resourceId,
      input.limit,
      input.before
    );
    return rows
      .filter(r => input.before === undefined || r.sequence < input.before)
      .map(r => ({
        id: r.id,
        sequence: r.sequence,
        createdAt: r.createdAt,
        actorId: r.createdBy,
        byteSize: r.packageByteSize,
      }));
  }

  async restoreVersion(
    input: Identity & {
      sequence: number;
      expectedContentVersion: number;
      requestKey: string;
      origin?: 'user' | 'ai';
    }
  ) {
    nativeRequestKeySchema.parse(input.requestKey);
    const hash = nativeOperationHash([
      'restore_version',
      input.kind,
      input.resourceId,
      input.sequence,
      input.expectedContentVersion,
    ]);
    return this.access.write(input, async () => {
      const current = await this.access.assert(input, { write: true });
      const replay = await this.models.workspaceNativeResource.receipt(
        input,
        hash
      );
      if (replay) return resourceResultSchema.parse(replay.result);
      if (current.contentVersion !== input.expectedContentVersion)
        throw new ResourceConflict(
          'File content changed before history restoration'
        );
      if (input.kind === 'file') {
        const revision =
          await this.models.workspaceNativeResource.fileRevision(input);
        const bytes = await this.readBlob(
          input,
          revision.blobKey,
          revision.byteSize,
          revision.fingerprint
        );
        await this.models.workspaceNativeResource.appendFile({
          ...input,
          requestHash: hash,
          blobKey: revision.blobKey,
          mimeType: revision.mimeType,
          byteSize: revision.byteSize,
          fingerprint: revision.fingerprint,
          searchText: nativeFileSearchText(bytes, current.title),
          origin: input.origin ?? 'user',
        });
      } else {
        const revision = await this.models.officeArtifact.getRevisionBySequence(
          input.workspaceId,
          input.resourceId,
          input.sequence
        );
        if (!revision)
          throw new NotFound('Office history revision is unavailable');
        const asset = await this.artifacts.readRevisionAsset(
          input.workspaceId,
          input.actorId,
          input.resourceId,
          revision.id,
          'package'
        );
        const appended = await this.models.officeArtifact.appendRevision({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          artifactId: input.resourceId,
          expectedParentRevisionId: current.revisionId,
          origin: input.origin ?? 'user',
          idempotencyKey: `restore:${nativeOperationHash([input.actorId, input.requestKey])}`,
          idempotencyFingerprint: `sha256:${hash}`,
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
          f => f.kind === current.officeKind
        );
        if (!format) throw new BadRequest('Unsupported Office format');
        await this.models.workspaceNativeResource.index({
          ...input,
          sequence: appended.revision.sequence,
          text: await officePackageSearchText(
            await readNativeOfficeState(format, asset.bytes),
            asset.bytes
          ),
        });
      }
      await this.models.workspaceNativeResource.record({
        ...input,
        requestHash: hash,
        action: 'restore_version',
        result: {
          ...resourceReceipt(await this.get(input)),
          sourceSequence: input.sequence,
        },
      });
      return this.get(input);
    });
  }

  async copy(
    input: Identity & {
      title: string;
      expectedContentVersion: number;
      requestKey: string;
      folderId?: string | null;
    }
  ) {
    nativeRequestKeySchema.parse(input.requestKey);
    nativeTitleSchema.parse(input.title);
    const hash = nativeOperationHash({
      action: 'copy',
      resourceId: input.resourceId,
      kind: input.kind,
      expectedContentVersion: input.expectedContentVersion,
      title: input.title,
      folderId: input.folderId ?? null,
    });
    return this.resources.snapshot(input, async () => {
      await this.models.workspaceNativeResource.lock(input);
      const source = await this.access.assert(input);
      const replay = await this.models.workspaceNativeResource.receipt(
        input,
        hash
      );
      if (replay) {
        const result = resourceResultSchema.parse(replay.result);
        await this.access.assert({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          resourceId: result.id,
          kind: result.kind,
        });
        return result;
      }
      if (source.contentVersion !== input.expectedContentVersion)
        throw new ResourceConflict(
          'Source content changed; reload before copying'
        );
      const result = await this.create({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        title: source.officeKind
          ? officeDownloadFileName(input.title, source.officeKind)
          : input.title,
        requestKey: `copy:${nativeOperationHash([input.actorId, input.requestKey])}`,
        folderId: input.folderId,
        blobKey: source.blobKey,
        fileOnly: source.kind === 'file',
        origin: 'copy',
      });
      await this.models.workspaceNativeResource.record({
        ...input,
        requestHash: hash,
        action: 'copy',
        result: {
          ...resourceReceipt(result),
          sourceVersion: source.contentVersion,
        },
      });
      return result;
    });
  }

  private async readBlob(
    input: Actor,
    key: string,
    size: number,
    fingerprint?: string
  ) {
    if (size > NATIVE_FILE_MAX_BYTES || size < 0)
      throw new BadRequest('Native files must not exceed 32 MiB');
    await this.access.assertBlobRead({ ...input, key });
    const stored = await this.storage.get(
      input.workspaceId,
      input.actorId,
      key
    );
    if (!stored.body) throw new NotFound('File content is unavailable');
    const bytes = await readBufferWithLimit(stored.body, NATIVE_FILE_MAX_BYTES);
    if (
      bytes.length !== size ||
      (fingerprint &&
        createHash('sha256').update(bytes).digest('hex') !== fingerprint)
    )
      throw new ResourceConflict(
        'File bytes do not match their immutable revision'
      );
    return bytes;
  }
}
