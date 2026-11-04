import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import type { DocumentEventOutbox, Prisma } from '@prisma/client';

import type { DocumentCommentSnapshot } from '../core/doc/document-archive';
import { ResourceError } from '../core/doc/resource-types';
import { BaseModel } from './base';

export type DocumentCommentScope = {
  workspaceId: string;
  kind: 'blocksuite' | 'office';
  resourceId: string;
};

@Injectable()
export class DocumentCommentsModel extends BaseModel {
  async copySnapshot(scope: DocumentCommentScope) {
    const version = await this.version(scope, true);
    const where = {
      workspaceId: scope.workspaceId,
      docId: scope.resourceId,
      deletedAt: null,
    };
    const comments =
      scope.kind === 'blocksuite'
        ? await this.db.comment.findMany({
            where,
            orderBy: { sid: 'asc' },
            take: 1001,
          })
        : await this.db.officeComment.findMany({
            where: { ...where, projectId: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 1001,
          });
    const ids = comments.map(row => row.id);
    const replies =
      scope.kind === 'blocksuite'
        ? await this.db.reply.findMany({
            where: { ...where, commentId: { in: ids } },
            orderBy: { sid: 'asc' },
            take: 10001,
          })
        : await this.db.officeCommentReply.findMany({
            where: { commentId: { in: ids }, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 10001,
          });
    const attachments =
      scope.kind === 'blocksuite'
        ? await this.db.commentAttachment.findMany({
            where: { workspaceId: scope.workspaceId, docId: scope.resourceId },
            take: 1001,
          })
        : [];
    if (
      comments.length > 1000 ||
      comments.length + replies.length > 10000 ||
      attachments.length > 1000 ||
      Buffer.byteLength(JSON.stringify([comments, replies])) > 8 * 1024 * 1024
    )
      throw new ResourceError('content_too_large');
    return { version, comments, replies, attachments };
  }

  copyIdentities(snapshot: DocumentCommentSnapshot, operationId: string) {
    return new Map(
      [...snapshot.comments, ...snapshot.replies].map(row => [
        row.id,
        createHash('sha256')
          .update(JSON.stringify(['document-copy', operationId, row.id]))
          .digest('base64url')
          .slice(0, 32),
      ])
    );
  }

  /** Source authorship is copied evidence; copying never sends fresh mentions. */
  async copyInto(
    scope: DocumentCommentScope,
    snapshot: DocumentCommentSnapshot,
    ids: ReadonlyMap<string, string>,
    targetRevisionId?: string,
    attachmentUrls: ReadonlyMap<string, string> = new Map()
  ) {
    await this.version(scope, true);
    const mapped = (id: string) => {
      const value = ids.get(id);
      if (!value) throw new ResourceError('invalid_input');
      return value;
    };
    const copyContent = (content: Prisma.JsonValue): Prisma.InputJsonObject => {
      const result = { ...(content as Prisma.InputJsonObject) };
      if (Array.isArray(result.attachments))
        result.attachments = result.attachments.map(value => {
          if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            typeof value.url !== 'string'
          )
            return value;
          let path: string;
          try {
            path = new URL(value.url, 'https://localmind.invalid').pathname;
          } catch {
            return value;
          }
          const attachment = snapshot.attachments.find(
            row =>
              path ===
              `/api/workspaces/${row.workspaceId}/docs/${row.docId}/comment-attachments/${row.key}`
          );
          const url = attachment
            ? attachmentUrls.get(attachment.key)
            : undefined;
          return url ? { ...value, url } : value;
        });
      return result;
    };
    for (const row of snapshot.comments) {
      let content = copyContent(row.content);
      if (scope.kind === 'office') {
        const anchor = content.anchor;
        if (
          !targetRevisionId ||
          !anchor ||
          typeof anchor !== 'object' ||
          Array.isArray(anchor)
        )
          throw new ResourceError('unsupported_document_structure');
        content = {
          ...content,
          anchor: { ...anchor, revisionId: targetRevisionId },
        };
      }
      const data = {
        id: mapped(row.id),
        workspaceId: scope.workspaceId,
        docId: scope.resourceId,
        userId: row.userId,
        content,
        resolved: row.resolved,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      if (scope.kind === 'blocksuite') await this.db.comment.create({ data });
      else await this.db.officeComment.create({ data });
    }
    for (const row of snapshot.replies) {
      const data = {
        id: mapped(row.id),
        commentId: mapped(row.commentId),
        userId: row.userId,
        content: copyContent(row.content),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
      if (scope.kind === 'blocksuite')
        await this.db.reply.create({
          data: {
            ...data,
            workspaceId: scope.workspaceId,
            docId: scope.resourceId,
          },
        });
      else await this.db.officeCommentReply.create({ data });
    }
    for (const row of snapshot.attachments)
      await this.db.commentAttachment.create({
        data: {
          key: row.key,
          size: row.size,
          mime: row.mime,
          name: row.name,
          createdAt: row.createdAt,
          createdBy: row.createdBy,
          workspaceId: scope.workspaceId,
          docId: scope.resourceId,
        },
      });
    if (snapshot.attachments.length)
      await this.db.effectiveWorkspaceQuotaState.updateMany({
        where: { workspaceId: scope.workspaceId },
        data: { stale: true },
      });
  }
  async version(scope: DocumentCommentScope, lock = false) {
    if (lock) {
      await this.db
        .$executeRaw`INSERT INTO document_comment_states(workspace_id, kind, resource_id)
        VALUES (${scope.workspaceId}, ${scope.kind}, ${scope.resourceId}) ON CONFLICT DO NOTHING`;
      await this.db
        .$queryRaw`SELECT version FROM document_comment_states WHERE workspace_id = ${scope.workspaceId}
        AND kind = ${scope.kind} AND resource_id = ${scope.resourceId} FOR UPDATE`;
    }
    const state = await this.db.documentCommentState.findUnique({
      where: { workspaceId_kind_resourceId: scope },
    });
    return String(state?.version ?? 0n);
  }

  async list(
    scope: DocumentCommentScope,
    offset: number,
    limit: number,
    commentId?: string
  ) {
    if (scope.kind === 'blocksuite') {
      const where = {
        workspaceId: scope.workspaceId,
        docId: scope.resourceId,
        deletedAt: null,
      };
      if (commentId)
        return this.db.reply.findMany({
          where: { ...where, commentId, comment: { deletedAt: null } },
          orderBy: { sid: 'asc' },
          skip: offset,
          take: limit,
        });
      return this.db.comment.findMany({
        where,
        orderBy: { sid: 'asc' },
        skip: offset,
        take: limit,
      });
    }
    const where = {
      workspaceId: scope.workspaceId,
      projectId: null,
      docId: scope.resourceId,
      deletedAt: null,
    };
    if (commentId)
      return this.db.officeCommentReply.findMany({
        where: { commentId, deletedAt: null, comment: where },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      });
    return this.db.officeComment.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit,
    });
  }

  async states(scope: DocumentCommentScope, ids: string[]) {
    const where = {
      workspaceId: scope.workspaceId,
      docId: scope.resourceId,
      id: { in: ids },
      deletedAt: null,
    };
    const rows =
      scope.kind === 'blocksuite'
        ? await this.db.comment.findMany({
            where,
            select: { id: true, resolved: true },
          })
        : await this.db.officeComment.findMany({
            where,
            select: { id: true, resolved: true },
          });
    return new Map(rows.map(row => [row.id, !row.resolved]));
  }

  event(id: string, workspaceId: string, payload: Prisma.InputJsonObject) {
    return this.db.documentEventOutbox.create({
      data: { id, workspaceId, payload },
    });
  }

  async replyRecipients(
    commentId: string,
    before: Date,
    afterUserId: string | undefined,
    limit = 50
  ) {
    return this.db.$queryRaw<
      { userId: string }[]
    >`SELECT DISTINCT user_id AS "userId" FROM replies
      WHERE comment_id = ${commentId} AND deleted_at IS NULL AND created_at <= ${before}
      AND user_id > ${afterUserId ?? ''} ORDER BY user_id LIMIT ${limit}`;
  }

  async deliverBatch(
    deliver: (
      row: DocumentEventOutbox
    ) => Promise<{ id: string; payload: Prisma.InputJsonObject } | void>
  ) {
    let delivered = 0;
    for (; delivered < 25; delivered++)
      if (!(await this.deliverOne(deliver))) break;
    return delivered;
  }

  @Transactional<TransactionalAdapterPrisma>({ timeout: 60000 })
  private async deliverOne(
    deliver: (
      row: DocumentEventOutbox
    ) => Promise<{ id: string; payload: Prisma.InputJsonObject } | void>
  ) {
    const rows = await this.db.$queryRaw<
      DocumentEventOutbox[]
    >`SELECT id, workspace_id AS "workspaceId", payload, created_at AS "createdAt", attempts,
      next_attempt_at AS "nextAttemptAt", last_error AS "lastError"
      FROM document_event_outbox WHERE next_attempt_at <= NOW() ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    for (const row of rows) {
      await this.db.$executeRawUnsafe('SAVEPOINT document_event_delivery');
      try {
        const next = await deliver(row);
        if (next)
          await this.db.documentEventOutbox.create({
            data: { ...next, workspaceId: row.workspaceId },
          });
        await this.db.documentEventOutbox.delete({ where: { id: row.id } });
      } catch {
        await this.db.$executeRawUnsafe(
          'ROLLBACK TO SAVEPOINT document_event_delivery'
        );
        await this.db.documentEventOutbox.update({
          where: { id: row.id },
          data: {
            attempts: { increment: 1 },
            lastError: 'delivery_failed',
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(3600000, 5000 * 2 ** Math.min(row.attempts, 10))
            ),
          },
        });
      }
      await this.db.$executeRawUnsafe(
        'RELEASE SAVEPOINT document_event_delivery'
      );
    }
    return rows.length;
  }
}
