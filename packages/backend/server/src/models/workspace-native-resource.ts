import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BadRequest, NotFound, ResourceConflict } from '../base';
import { BaseModel } from './base';

export type WorkspaceNativeKind = 'file' | 'office';
export type WorkspaceNativeIdentity = {
  workspaceId: string;
  resourceId: string;
  kind: WorkspaceNativeKind;
};
export const nativeOperationHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class WorkspaceNativeResourceModel extends BaseModel {
  @Transactional()
  async deliverChanges(
    deliver: (row: { workspaceId: string }) => Promise<void>
  ) {
    const rows = await this.db.$queryRaw<
      { id: bigint; workspaceId: string }[]
    >`SELECT id, workspace_id AS "workspaceId" FROM workspace_native_outbox ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const workspaceId of new Set(rows.map(row => row.workspaceId)))
      await deliver({ workspaceId });
    if (rows.length)
      await this.db.workspaceNativeOutbox.deleteMany({
        where: { id: { in: rows.map(row => row.id) } },
      });
  }

  async officeIds(workspaceId: string, ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await this.db.workspaceOfficeState.findMany({
      where: { workspaceId, artifactId: { in: ids } },
      select: { artifactId: true },
    });
    return new Set(rows.map(row => row.artifactId));
  }

  async blobResources(workspaceId: string, key: string) {
    return this.db.$queryRaw<{ id: string; kind: WorkspaceNativeKind }[]>`
      SELECT DISTINCT file_id AS id, 'file' AS kind FROM workspace_file_revisions WHERE workspace_id = ${workspaceId} AND blob_key = ${key}
      UNION SELECT DISTINCT artifact_id, 'office' FROM office_revisions WHERE workspace_id = ${workspaceId} AND (package_blob_key = ${key} OR state_blob_key = ${key})
      UNION SELECT id, 'office' FROM office_artifacts WHERE workspace_id = ${workspaceId} AND source_blob_key = ${key}
    `;
  }

  async get(
    input: WorkspaceNativeIdentity,
    options: { trash?: boolean; deleted?: boolean } = {}
  ) {
    if (input.kind === 'file') {
      const state = await this.db.workspaceFileState.findFirst({
        where: { fileId: input.resourceId, workspaceId: input.workspaceId },
        include: { file: true, revision: true },
      });
      if (
        !state ||
        (!options.deleted && state.deletedAt) ||
        (!options.trash && state.trashedAt)
      )
        throw new NotFound('Native file is unavailable');
      return {
        ...input,
        kind: 'file',
        state,
        title: state.title,
        metadataVersion: state.metadataVersion,
        contentVersion: state.contentVersion,
        revisionId: state.revision.id,
        blobKey: state.revision.blobKey,
        fingerprint: state.revision.fingerprint,
        mimeType: state.revision.mimeType,
        byteSize: state.revision.byteSize,
        createdAt: state.file.createdAt,
        updatedAt: state.updatedAt,
        officeKind: null,
      } as const;
    }
    const state = await this.db.workspaceOfficeState.findFirst({
      where: { artifactId: input.resourceId, workspaceId: input.workspaceId },
      include: {
        artifact: {
          include: { revisions: { orderBy: { sequence: 'desc' }, take: 1 } },
        },
      },
    });
    const revision = state?.artifact.revisions[0];
    if (
      !state ||
      !revision ||
      (!options.deleted && state.deletedAt) ||
      (!options.trash && state.trashedAt)
    )
      throw new NotFound('Native Office resource is unavailable');
    return {
      ...input,
      kind: 'office',
      state,
      title: state.artifact.title,
      metadataVersion: state.metadataVersion,
      contentVersion: revision.sequence,
      revisionId: revision.id,
      blobKey: revision.packageBlobKey,
      fingerprint: revision.packageFingerprint,
      mimeType: revision.packageMimeType,
      byteSize: revision.packageByteSize,
      createdAt: state.artifact.createdAt,
      updatedAt: new Date(
        Math.max(state.updatedAt.getTime(), state.artifact.updatedAt.getTime())
      ),
      officeKind: state.artifact.kind,
    } as const;
  }

  @Transactional()
  async lock(input: WorkspaceNativeIdentity) {
    if (input.kind === 'file') {
      await this.db
        .$queryRaw`SELECT file_id FROM workspace_file_states WHERE workspace_id = ${input.workspaceId} AND file_id = ${input.resourceId} FOR UPDATE`;
    } else {
      await this.db
        .$queryRaw`SELECT artifact_id FROM workspace_office_states WHERE workspace_id = ${input.workspaceId} AND artifact_id = ${input.resourceId} FOR UPDATE`;
    }
  }

  async receipt(
    input: { workspaceId: string; actorId: string; requestKey: string },
    hash?: string
  ) {
    const result = await this.db.workspaceNativeOperation.findUnique({
      where: {
        workspaceId_actorId_requestKey: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          requestKey: input.requestKey,
        },
      },
    });
    if (result && hash && result.requestHash !== hash)
      throw new ResourceConflict(
        'This request key was used for a different native resource operation'
      );
    return result;
  }

  async record(
    input: WorkspaceNativeIdentity & {
      actorId: string;
      requestKey: string;
      requestHash: string;
      action: string;
      result: Prisma.InputJsonValue;
    }
  ) {
    return this.db.workspaceNativeOperation.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        ...(input.kind === 'file'
          ? { fileId: input.resourceId }
          : { artifactId: input.resourceId }),
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        action: input.action,
        result: input.result,
      },
    });
  }

  @Transactional()
  async change(
    input: WorkspaceNativeIdentity & {
      expectedVersion: number;
      title?: string;
      trash?: boolean;
      permanentlyDelete?: boolean;
      restoreLocations?: Prisma.InputJsonArray;
      trashSourceId?: string | null;
    }
  ) {
    await this.lock(input);
    const current = await this.get(input, { trash: true });
    if (current.metadataVersion !== input.expectedVersion)
      throw new ResourceConflict(
        'Native resource metadata changed; reload before editing'
      );
    if (input.permanentlyDelete && !current.state.trashedAt)
      throw new BadRequest(
        'Move the native resource to trash before permanently deleting it'
      );
    const data = {
      metadataVersion: { increment: 1 },
      ...(input.trash === undefined
        ? {}
        : { trashedAt: input.trash ? new Date() : null }),
      ...(input.permanentlyDelete ? { deletedAt: new Date() } : {}),
      ...(input.restoreLocations === undefined
        ? {}
        : { restoreLocations: input.restoreLocations }),
      ...(input.trashSourceId === undefined
        ? {}
        : { trashSourceId: input.trashSourceId }),
    };
    if (input.kind === 'file')
      await this.db.workspaceFileState.update({
        where: { fileId: input.resourceId },
        data: {
          ...data,
          ...(input.title === undefined ? {} : { title: input.title }),
        },
      });
    else {
      await this.db.workspaceOfficeState.update({
        where: { artifactId: input.resourceId },
        data,
      });
      if (input.title !== undefined)
        await this.db.officeArtifact.update({
          where: { id: input.resourceId },
          data: { title: input.title },
        });
    }
    return this.get(input, { trash: true, deleted: true });
  }

  @Transactional()
  async appendFile(
    input: WorkspaceNativeIdentity & {
      actorId: string;
      expectedContentVersion: number;
      requestKey: string;
      requestHash: string;
      blobKey: string;
      mimeType: string;
      byteSize: number;
      fingerprint: string;
      searchText: string;
      origin: string;
      sourceSessionId?: string | null;
    }
  ) {
    await this.lock(input);
    const current = await this.get(input);
    if (current.kind !== 'file')
      throw new BadRequest('Choose a native text or binary file');
    if (current.contentVersion !== input.expectedContentVersion)
      throw new ResourceConflict(
        'Native file content changed; read and merge before saving'
      );
    const revision = await this.db.workspaceFileRevision.create({
      data: {
        workspaceId: input.workspaceId,
        fileId: input.resourceId,
        sequence: current.contentVersion + 1,
        parentRevisionId: current.revisionId,
        actorId: input.actorId,
        blobKey: input.blobKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        fingerprint: input.fingerprint,
        origin: input.origin,
        sourceSessionId: input.sourceSessionId,
        requestKey: input.requestKey,
        requestHash: input.requestHash,
      },
    });
    await this.db.workspaceFileState.update({
      where: { fileId: input.resourceId },
      data: {
        contentVersion: revision.sequence,
        searchText: input.searchText,
        searchVersion: revision.sequence,
      },
    });
    return this.get(input);
  }

  async history(
    input: WorkspaceNativeIdentity & { before?: number; limit?: number }
  ) {
    await this.get(input);
    const take = input.limit ?? 25;
    if (!Number.isInteger(take) || take < 1 || take > 100)
      throw new BadRequest('Invalid history page size');
    return this.db.workspaceFileRevision.findMany({
      where: {
        workspaceId: input.workspaceId,
        fileId: input.resourceId,
        ...(input.before === undefined
          ? {}
          : { sequence: { lt: input.before } }),
      },
      orderBy: { sequence: 'desc' },
      take,
    });
  }

  async fileRevision(input: WorkspaceNativeIdentity & { sequence: number }) {
    await this.get(input);
    return this.db.workspaceFileRevision.findFirstOrThrow({
      where: {
        fileId: input.resourceId,
        workspaceId: input.workspaceId,
        sequence: input.sequence,
      },
    });
  }

  async candidates(input: {
    workspaceId: string;
    query?: string;
    trash?: boolean;
    afterId?: string;
    limit: number;
  }) {
    // Identity ordering is stable when content changes; current ACL is applied by the service.
    const search = `%${(input.query ?? '').replace(/[\\%_]/g, '\\$&')}%`;
    return this.db.$queryRaw<
      { id: string; kind: WorkspaceNativeKind }[]
    >(Prisma.sql`
      SELECT id, kind FROM (
        SELECT file_id AS id, 'file' AS kind, title, search_text, trashed_at, deleted_at
        FROM workspace_file_states WHERE workspace_id = ${input.workspaceId}
        UNION ALL
        SELECT state.artifact_id, 'office', artifact.title, state.search_text, state.trashed_at, state.deleted_at
        FROM workspace_office_states state JOIN office_artifacts artifact ON artifact.id = state.artifact_id
        WHERE state.workspace_id = ${input.workspaceId}
      ) resources WHERE deleted_at IS NULL
      AND (trashed_at IS NOT NULL) = ${input.trash ?? false}
      AND (title ILIKE ${search} OR search_text ILIKE ${search})
      AND (id || ':' || kind) > ${input.afterId ?? ''}
      ORDER BY id || ':' || kind LIMIT ${input.limit}
    `);
  }

  async pendingIndexes(after = '') {
    return this.db.$queryRaw<
      {
        resourceId: string;
        workspaceId: string;
        kind: WorkspaceNativeKind;
        actorId: string;
        cursor: string;
      }[]
    >`
      SELECT pending.id AS "resourceId", pending.workspace_id AS "workspaceId", pending.kind,
        member.user_id AS "actorId", (pending.workspace_id || ':' || pending.id || ':' || pending.kind) AS cursor
      FROM (
        SELECT file_id AS id, workspace_id, 'file' AS kind FROM workspace_file_states
        WHERE deleted_at IS NULL AND trashed_at IS NULL AND search_version < content_version
        UNION ALL
        SELECT state.artifact_id, state.workspace_id, 'office' FROM workspace_office_states state
        JOIN office_artifacts artifact ON artifact.id = state.artifact_id
        WHERE state.deleted_at IS NULL AND state.trashed_at IS NULL AND state.search_version < artifact.revision_counter
      ) pending JOIN LATERAL (
        SELECT user_id FROM workspace_members WHERE workspace_id = pending.workspace_id AND state = 'active' AND role = 'owner'
        ORDER BY user_id LIMIT 1
      ) member ON true
      WHERE (pending.workspace_id || ':' || pending.id || ':' || pending.kind) COLLATE "C" > ${after}
      ORDER BY (pending.workspace_id || ':' || pending.id || ':' || pending.kind) COLLATE "C" LIMIT 20
    `;
  }

  async index(
    input: WorkspaceNativeIdentity & { sequence: number; text: string }
  ) {
    if (input.kind === 'file')
      return this.db.workspaceFileState.updateMany({
        where: {
          fileId: input.resourceId,
          workspaceId: input.workspaceId,
          contentVersion: input.sequence,
          deletedAt: null,
        },
        data: {
          searchText: input.text.slice(0, 250000),
          searchVersion: input.sequence,
        },
      });
    return this.db.workspaceOfficeState.updateMany({
      where: {
        artifactId: input.resourceId,
        workspaceId: input.workspaceId,
        artifact: { revisionCounter: input.sequence },
        deletedAt: null,
      },
      data: {
        searchText: input.text.slice(0, 250000),
        searchVersion: input.sequence,
      },
    });
  }
}
