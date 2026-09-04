import { Injectable } from '@nestjs/common';
import type { OfficeArtifactKind } from '@prisma/client';
import { z } from 'zod';

import { Models } from '../../models';
import { PermissionAccess } from '../permission';

const id = z.string().trim().min(1).max(512);
const textPosition = z
  .object({ blockId: id, offset: z.number().int().nonnegative() })
  .strict();
const rect = z
  .object({
    xPt: z.number().finite(),
    yPt: z.number().finite(),
    widthPt: z.number().finite().positive(),
    heightPt: z.number().finite().positive(),
  })
  .strict();

export const OfficeCommentContentSchema = z
  .object({
    version: z.literal('localmind-office-comment/v1'),
    text: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1024),
    anchor: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('document'),
          revisionId: id,
          start: textPosition,
          end: textPosition,
        })
        .strict(),
      z
        .object({
          kind: z.literal('workbook'),
          revisionId: id,
          sheetId: id,
          address: z
            .string()
            .trim()
            .regex(/^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}$/i)
            .max(16),
        })
        .strict(),
      z
        .object({
          kind: z.literal('presentation'),
          revisionId: id,
          slideId: id,
          shapeId: id.optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('pdf'),
          revisionId: id,
          pageIndex: z.number().int().nonnegative().max(100_000),
          rect: rect.optional(),
        })
        .strict(),
    ]),
  })
  .strict();

export const OfficeCommentReplyContentSchema = z
  .object({
    version: z.literal('localmind-office-comment-reply/v1'),
    text: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1024),
  })
  .strict();

const ARTIFACT_KIND_BY_ANCHOR = {
  document: 'document',
  workbook: 'workbook',
  presentation: 'presentation',
  pdf: 'pdf',
} as const satisfies Record<string, OfficeArtifactKind>;

@Injectable()
export class OfficeCommentService {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess
  ) {}

  async list(workspaceId: string, actorId: string, artifactId: string) {
    await this.assertRead(workspaceId, actorId, artifactId);
    const comments = await this.models.comment.list(workspaceId, artifactId, {
      take: 100,
    });
    const users = await this.models.user.getPublicUsersMap([
      ...comments,
      ...comments.flatMap(comment => comment.replies),
    ]);
    return comments.map(comment => ({
      ...comment,
      user: users.get(comment.userId),
      replies: comment.replies.map(reply => ({
        ...reply,
        user: users.get(reply.userId),
      })),
    }));
  }

  async collaborators(
    workspaceId: string,
    actorId: string,
    artifactId: string
  ) {
    const artifact = await this.assertRead(workspaceId, actorId, artifactId);
    const [revisions, comments] = await Promise.all([
      this.models.officeArtifact.listRevisions(workspaceId, artifactId, 100),
      this.models.comment.list(workspaceId, artifactId, { take: 100 }),
    ]);
    const userIds = new Set([
      artifact.createdBy,
      ...revisions.map(revision => revision.createdBy),
      ...comments.map(comment => comment.userId),
      ...comments.flatMap(comment =>
        comment.replies.map(reply => reply.userId)
      ),
    ]);
    const users = await this.models.user.getPublicUsersMap(
      [...userIds].map(userId => ({ userId }))
    );
    return [...userIds]
      .map(userId => users.get(userId))
      .filter(user => user !== undefined);
  }

  async create(input: {
    workspaceId: string;
    artifactId: string;
    actorId: string;
    content: unknown;
  }) {
    await this.assertWrite(input.workspaceId, input.actorId, input.artifactId);
    const content = OfficeCommentContentSchema.parse(input.content);
    await this.assertAnchor(
      input.workspaceId,
      input.artifactId,
      content.anchor
    );
    const comment = await this.models.comment.create({
      workspaceId: input.workspaceId,
      docId: input.artifactId,
      userId: input.actorId,
      content,
    });
    return await this.projectComment(comment);
  }

  async update(input: { actorId: string; id: string; content: unknown }) {
    const comment = await this.requireComment(input.id);
    await this.assertWrite(comment.workspaceId, input.actorId, comment.docId);
    const content = OfficeCommentContentSchema.parse(input.content);
    await this.assertAnchor(comment.workspaceId, comment.docId, content.anchor);
    const updated = await this.models.comment.update({
      id: comment.id,
      content,
    });
    return await this.projectComment(updated);
  }

  async resolve(input: { actorId: string; id: string; resolved: boolean }) {
    const comment = await this.requireComment(input.id);
    await this.assertWrite(comment.workspaceId, input.actorId, comment.docId);
    const updated = await this.models.comment.resolve({
      id: comment.id,
      resolved: input.resolved,
    });
    return await this.projectComment(updated);
  }

  async delete(input: { actorId: string; id: string }) {
    const comment = await this.requireComment(input.id);
    await this.assertWrite(comment.workspaceId, input.actorId, comment.docId);
    await this.models.comment.delete(comment.id);
    return comment;
  }

  async createReply(input: {
    actorId: string;
    commentId: string;
    content: unknown;
  }) {
    const comment = await this.requireComment(input.commentId);
    await this.assertWrite(comment.workspaceId, input.actorId, comment.docId);
    const content = OfficeCommentReplyContentSchema.parse(input.content);
    const reply = await this.models.comment.createReply({
      commentId: comment.id,
      userId: input.actorId,
      content,
    });
    return await this.projectReply(reply);
  }

  async updateReply(input: { actorId: string; id: string; content: unknown }) {
    const reply = await this.requireReply(input.id);
    await this.assertWrite(reply.workspaceId, input.actorId, reply.docId);
    const content = OfficeCommentReplyContentSchema.parse(input.content);
    const updated = await this.models.comment.updateReply({
      id: reply.id,
      content,
    });
    return await this.projectReply(updated);
  }

  async deleteReply(input: { actorId: string; id: string }) {
    const reply = await this.requireReply(input.id);
    await this.assertWrite(reply.workspaceId, input.actorId, reply.docId);
    await this.models.comment.deleteReply(reply.id);
    return reply;
  }

  private async assertAnchor(
    workspaceId: string,
    artifactId: string,
    anchor: z.infer<typeof OfficeCommentContentSchema>['anchor']
  ) {
    const artifact = await this.models.officeArtifact.get(
      workspaceId,
      artifactId
    );
    if (!artifact || artifact.kind !== ARTIFACT_KIND_BY_ANCHOR[anchor.kind]) {
      throw new Error('Office comment anchor does not match artifact kind');
    }
    const revision = await this.models.officeArtifact.getRevision(
      workspaceId,
      artifactId,
      anchor.revisionId
    );
    if (!revision) {
      throw new Error(
        `Office comment revision not found: ${anchor.revisionId}`
      );
    }
    if (
      anchor.kind === 'document' &&
      anchor.start.blockId === anchor.end.blockId &&
      anchor.start.offset > anchor.end.offset
    ) {
      throw new Error('Office comment text range is reversed');
    }
  }

  private async assertRead(
    workspaceId: string,
    actorId: string,
    artifactId: string
  ) {
    await this.ac
      .user(actorId)
      .workspace(workspaceId)
      .assert('Workspace.Blobs.Read');
    const artifact = await this.models.officeArtifact.get(
      workspaceId,
      artifactId
    );
    if (!artifact) throw new Error(`Office artifact not found: ${artifactId}`);
    return artifact;
  }

  private async assertWrite(
    workspaceId: string,
    actorId: string,
    artifactId: string
  ) {
    await Promise.all([
      this.assertRead(workspaceId, actorId, artifactId),
      this.ac
        .user(actorId)
        .workspace(workspaceId)
        .assert('Workspace.Blobs.Write'),
    ]);
  }

  private async requireComment(id: string) {
    const comment = await this.models.comment.get(id);
    if (!comment) throw new Error(`Office comment not found: ${id}`);
    const artifact = await this.models.officeArtifact.get(
      comment.workspaceId,
      comment.docId
    );
    if (!artifact) throw new Error(`Office comment not found: ${id}`);
    OfficeCommentContentSchema.parse(comment.content);
    return comment;
  }

  private async requireReply(id: string) {
    const reply = await this.models.comment.getReply(id);
    if (!reply) throw new Error(`Office comment reply not found: ${id}`);
    const artifact = await this.models.officeArtifact.get(
      reply.workspaceId,
      reply.docId
    );
    if (!artifact) throw new Error(`Office comment reply not found: ${id}`);
    OfficeCommentReplyContentSchema.parse(reply.content);
    return reply;
  }

  private async projectComment<
    T extends {
      id: string;
      workspaceId: string;
      docId: string;
      userId: string;
    },
  >(comment: T) {
    const replies = await this.models.comment.listReplies(
      comment.workspaceId,
      comment.docId,
      comment.id
    );
    const users = await this.models.user.getPublicUsersMap([
      comment,
      ...replies,
    ]);
    return {
      ...comment,
      user: users.get(comment.userId),
      replies: replies.map(reply => ({
        ...reply,
        user: users.get(reply.userId),
      })),
    };
  }

  private async projectReply<T extends { userId: string }>(reply: T) {
    return {
      ...reply,
      user: await this.models.user.getPublicUser(reply.userId),
    };
  }
}
