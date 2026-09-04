import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { Prisma } from '@prisma/client';

import { BaseModel } from './base';

export type CreateBlobInput = Prisma.BlobUncheckedCreateInput;

/**
 * Blob Model
 */
@Injectable()
export class BlobModel extends BaseModel {
  async upsert(blob: CreateBlobInput) {
    const result = await this.db.blob.upsert({
      where: {
        workspaceId_key: {
          workspaceId: blob.workspaceId,
          key: blob.key,
        },
      },
      update: {
        mime: blob.mime,
        size: blob.size,
        status: blob.status,
        uploadId: blob.uploadId,
      },
      create: {
        workspaceId: blob.workspaceId,
        key: blob.key,
        mime: blob.mime,
        size: blob.size,
        status: blob.status,
        uploadId: blob.uploadId,
      },
    });
    await this.markQuotaStateStale(blob.workspaceId);
    return result;
  }

  @Transactional()
  async delete(workspaceId: string, key: string, permanently = false) {
    await this.lockForDelete(workspaceId, key);
    if (permanently) {
      await this.db.blob.deleteMany({
        where: {
          workspaceId,
          key,
        },
      });
      await this.markQuotaStateStale(workspaceId);
      this.logger.log(`deleted blob ${workspaceId}/${key} permanently`);
      return;
    }

    await this.db.blob.update({
      where: {
        workspaceId_key: {
          workspaceId,
          key,
        },
      },
      data: {
        deletedAt: new Date(),
      },
    });
    await this.markQuotaStateStale(workspaceId);
  }

  async lockForDelete(workspaceId: string, key: string) {
    await this.db.$queryRaw<Array<{ key: string }>>`
      SELECT "key"
      FROM "blobs"
      WHERE "workspace_id" = ${workspaceId}
        AND "key" = ${key}
      FOR UPDATE
    `;
    const [reference] = await this.db.$queryRaw<Array<{ referenced: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "office_artifacts"
        WHERE "workspace_id" = ${workspaceId}
          AND "source_blob_key" = ${key}
        UNION ALL
        SELECT 1
        FROM "office_revisions"
        WHERE "workspace_id" = ${workspaceId}
          AND (
            "package_blob_key" = ${key} OR
            "state_blob_key" = ${key}
          )
        UNION ALL
        SELECT 1
        FROM "office_command_requests"
        WHERE "workspace_id" = ${workspaceId}
          AND "command_blob_key" = ${key}
      ) AS "referenced"
    `;
    if (reference?.referenced) {
      throw new Error(`Office blob is still referenced: ${workspaceId}/${key}`);
    }
  }

  async get(workspaceId: string, key: string) {
    return await this.db.blob.findUnique({
      where: {
        workspaceId_key: {
          workspaceId,
          key,
        },
      },
    });
  }

  async restore(workspaceId: string, key: string) {
    const restored = await this.db.blob.updateMany({
      where: { workspaceId, key, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (restored.count) {
      await this.markQuotaStateStale(workspaceId);
    }
    return restored.count > 0;
  }

  async list(
    workspaceId: string,
    options?: { where: Prisma.BlobWhereInput; select?: Prisma.BlobSelect }
  ) {
    return await this.db.blob.findMany({
      where: {
        ...options?.where,
        workspaceId,
        deletedAt: null,
        status: 'completed',
      },
      select: options?.select,
    });
  }

  async hasAny(workspaceId: string) {
    const count = await this.db.blob.count({
      where: {
        workspaceId,
        deletedAt: null,
      },
    });
    return count > 0;
  }

  async totalSize(workspaceId: string) {
    const sum = await this.db.blob.aggregate({
      where: {
        workspaceId,
        deletedAt: null,
      },
      _sum: {
        size: true,
      },
    });

    return sum._sum.size ?? 0;
  }

  private async markQuotaStateStale(workspaceId: string) {
    await this.db.effectiveWorkspaceQuotaState.updateMany({
      where: { workspaceId },
      data: { stale: true },
    });
  }
}
