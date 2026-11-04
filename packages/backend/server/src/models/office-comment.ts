import { Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import type { Prisma } from '@prisma/client';

import { CommentNotFound } from '../base';
import { BaseModel } from './base';
import { type OfficeOwner, officeOwnerColumns } from './office-owner';

@Injectable()
export class OfficeCommentModel extends BaseModel {
  private async lockItem(id: string, reply = false) {
    const row = reply ? await this.getReply(id) : await this.get(id);
    if (!row) throw new CommentNotFound();
    if (row.workspaceId)
      await this.models.documentComments.version(
        { workspaceId: row.workspaceId, resourceId: row.docId, kind: 'office' },
        true
      );
  }
  @Transactional()
  async create(input: {
    id?: string;
    owner: OfficeOwner;
    docId: string;
    userId: string;
    content: Prisma.InputJsonObject;
  }) {
    const { owner, ...data } = input;
    if (typeof owner === 'string')
      await this.models.documentComments.version(
        { workspaceId: owner, resourceId: data.docId, kind: 'office' },
        true
      );
    return this.db.officeComment.create({
      data: { ...data, ...officeOwnerColumns(owner) },
    });
  }
  get(id: string) {
    return this.db.officeComment.findUnique({ where: { id, deletedAt: null } });
  }
  list(owner: OfficeOwner, docId: string, options?: { take: number }) {
    return this.db.officeComment.findMany({
      where: { ...officeOwnerColumns(owner), docId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: Math.min(100, options?.take ?? 100),
      include: {
        replies: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 100,
        },
      },
    });
  }
  @Transactional()
  async update(input: { id: string; content: Prisma.InputJsonObject }) {
    await this.lockItem(input.id);
    return this.db.officeComment.update({
      where: { id: input.id, deletedAt: null },
      data: { content: input.content },
    });
  }
  @Transactional()
  async resolve(input: { id: string; resolved: boolean }) {
    await this.lockItem(input.id);
    return this.db.officeComment.update({
      where: { id: input.id, deletedAt: null },
      data: { resolved: input.resolved },
    });
  }
  @Transactional()
  async delete(id: string) {
    await this.lockItem(id);
    return this.db.officeComment.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
  listReplies(owner: OfficeOwner, docId: string, commentId: string) {
    return this.db.officeCommentReply.findMany({
      where: {
        commentId,
        deletedAt: null,
        comment: { ...officeOwnerColumns(owner), docId, deletedAt: null },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }
  async getReply(id: string) {
    const reply = await this.db.officeCommentReply.findUnique({
      where: { id, deletedAt: null, comment: { deletedAt: null } },
      include: { comment: true },
    });
    return reply
      ? {
          ...reply,
          workspaceId: reply.comment.workspaceId,
          projectId: reply.comment.projectId,
          docId: reply.comment.docId,
        }
      : null;
  }
  @Transactional()
  async createReply(input: {
    id?: string;
    commentId: string;
    userId: string;
    content: Prisma.InputJsonObject;
  }) {
    await this.lockItem(input.commentId);
    const reply = await this.db.officeCommentReply.create({ data: input });
    const projected = await this.getReply(reply.id);
    if (!projected) throw new Error('Office comment reply disappeared');
    return projected;
  }
  @Transactional()
  async updateReply(input: { id: string; content: Prisma.InputJsonObject }) {
    await this.lockItem(input.id, true);
    await this.db.officeCommentReply.update({
      where: { id: input.id, deletedAt: null, comment: { deletedAt: null } },
      data: { content: input.content },
    });
    const projected = await this.getReply(input.id);
    if (!projected) throw new Error('Office comment reply disappeared');
    return projected;
  }
  @Transactional()
  async deleteReply(id: string) {
    await this.lockItem(id, true);
    return this.db.officeCommentReply.update({
      where: { id, deletedAt: null, comment: { deletedAt: null } },
      data: { deletedAt: new Date() },
    });
  }
}
