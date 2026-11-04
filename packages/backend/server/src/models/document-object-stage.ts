import { Injectable } from '@nestjs/common';
import { Propagation, Transactional } from '@nestjs-cls/transactional';
import type { DocumentObjectStage } from '@prisma/client';

import { ResourceError } from '../core/doc/resource-types';
import { BaseModel } from './base';

/** Physical objects need a journal which survives rollback of their resource transaction. */
@Injectable()
export class DocumentObjectStageModel extends BaseModel {
  @Transactional(Propagation.RequiresNew)
  async remember(input: {
    storageKey: string;
    workspaceId: string;
    docId?: string;
    blobId: string;
    byteSize: number;
  }) {
    await this.db
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`document-object-stage:${input.workspaceId}`}, 0))`;
    const pending = await this.db.$queryRaw<
      { count: bigint; bytes: bigint }[]
    >`SELECT COUNT(*) AS count, COALESCE(SUM(s.byte_size), 0) AS bytes
      FROM document_object_stages s WHERE s.workspace_id = ${input.workspaceId} AND s.storage_key <> ${input.storageKey}
      AND NOT EXISTS (SELECT 1 FROM blobs b WHERE s.doc_id IS NULL AND b.workspace_id = s.workspace_id AND b.key = s.blob_id)
      AND NOT EXISTS (SELECT 1 FROM comment_attachments c WHERE c.workspace_id = s.workspace_id AND c.doc_id = s.doc_id AND c.key = s.blob_id)`;
    if (
      Number(pending[0].count) >= 256 ||
      Number(pending[0].bytes) + input.byteSize > 256 * 1024 * 1024
    )
      throw new ResourceError('quota_exceeded');
    return this.db.documentObjectStage.upsert({
      where: { storageKey: input.storageKey },
      create: {
        ...input,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      update: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
  }

  /** The row lock excludes renewed writers until deletion finishes. Referenced
   * immutable blobs remain owned by ordinary Blob/history retention. */
  @Transactional()
  async collectOne(remove: (storageKey: string) => Promise<unknown>) {
    const rows = await this.db.$queryRaw<
      DocumentObjectStage[]
    >`SELECT storage_key AS "storageKey", workspace_id AS "workspaceId",
      doc_id AS "docId", blob_id AS "blobId", byte_size AS "byteSize", expires_at AS "expiresAt", created_at AS "createdAt"
      FROM document_object_stages WHERE expires_at <= NOW() ORDER BY expires_at, storage_key LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const row = rows[0];
    if (!row) return false;
    const referenced = row.docId
      ? await this.db.commentAttachment.findUnique({
          where: {
            workspaceId_docId_key: {
              workspaceId: row.workspaceId,
              docId: row.docId,
              key: row.blobId,
            },
          },
        })
      : await this.db.blob.findUnique({
          where: {
            workspaceId_key: { workspaceId: row.workspaceId, key: row.blobId },
          },
        });
    if (!referenced) {
      try {
        await remove(row.storageKey);
      } catch {
        await this.db.documentObjectStage.update({
          where: { storageKey: row.storageKey },
          data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        });
        return true;
      }
    }
    await this.db.documentObjectStage.delete({
      where: { storageKey: row.storageKey },
    });
    return true;
  }
}
