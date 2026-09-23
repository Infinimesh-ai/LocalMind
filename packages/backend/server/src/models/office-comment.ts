import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BaseModel } from './base';
import { type OfficeOwner, officeOwnerColumns } from './office-owner';

@Injectable()
export class OfficeCommentModel extends BaseModel {
  create(input: {
    owner: OfficeOwner;
    docId: string;
    userId: string;
    content: Prisma.InputJsonObject;
  }) {
    const { owner, ...data } = input;
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
  update(input: { id: string; content: Prisma.InputJsonObject }) {
    return this.db.officeComment.update({
      where: { id: input.id, deletedAt: null },
      data: { content: input.content },
    });
  }
  resolve(input: { id: string; resolved: boolean }) {
    return this.db.officeComment.update({
      where: { id: input.id, deletedAt: null },
      data: { resolved: input.resolved },
    });
  }
  delete(id: string) {
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
  async createReply(input: {
    commentId: string;
    userId: string;
    content: Prisma.InputJsonObject;
  }) {
    const reply = await this.db.officeCommentReply.create({ data: input });
    const projected = await this.getReply(reply.id);
    if (!projected) throw new Error('Office comment reply disappeared');
    return projected;
  }
  async updateReply(input: { id: string; content: Prisma.InputJsonObject }) {
    await this.db.officeCommentReply.update({
      where: { id: input.id, deletedAt: null, comment: { deletedAt: null } },
      data: { content: input.content },
    });
    const projected = await this.getReply(input.id);
    if (!projected) throw new Error('Office comment reply disappeared');
    return projected;
  }
  deleteReply(id: string) {
    return this.db.officeCommentReply.update({
      where: { id, deletedAt: null, comment: { deletedAt: null } },
      data: { deletedAt: new Date() },
    });
  }
}
