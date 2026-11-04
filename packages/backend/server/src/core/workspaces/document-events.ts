import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { z } from 'zod';

import { EventBus, JobQueue } from '../../base';
import { DocMode, Models } from '../../models';
import { PermissionAccess } from '../permission';
import { RealtimePublisher } from '../realtime';

const eventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('access.changed'),
      event: z.enum([
        'doc.public_state.changed',
        'doc.grants.changed',
        'doc.owner.changed',
        'doc.default_role.changed',
      ]),
      resourceId: z.string(),
      userId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('comments.changed'),
      kind: z.enum(['blocksuite', 'office']),
      resourceId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('comment.notification'),
      resourceId: z.string(),
      actorId: z.string(),
      commentId: z.string(),
      replyId: z.string().nullable(),
      mentions: z.array(z.string()),
      title: z.string(),
      mode: z.enum(['page', 'edgeless']),
      rootEventId: z.string().max(512).optional(),
      afterUserId: z.string().max(256).optional(),
      audienceBefore: z.string().datetime().optional(),
    })
    .strict(),
]);

@Injectable()
export class DocumentEventsService {
  constructor(
    private readonly event: EventBus,
    private readonly models: Models,
    private readonly realtime: RealtimePublisher,
    private readonly queue: JobQueue,
    private readonly ac: PermissionAccess
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async deliver() {
    return this.models.documentComments.deliverBatch(async row => {
      const event = eventSchema.parse(row.payload),
        workspaceId = row.workspaceId;
      if (event.type === 'access.changed') {
        const payload = { workspaceId, docId: event.resourceId };
        if (event.event === 'doc.owner.changed') {
          if (!event.userId)
            throw new Error('Missing document owner event identity');
          this.event.emit(event.event, { ...payload, userId: event.userId });
        } else this.event.emit(event.event, payload);
        return;
      }
      if (event.type === 'comments.changed') {
        const sent =
          event.kind === 'blocksuite'
            ? this.realtime.publish(
                'comment.changed',
                { workspaceId, docId: event.resourceId },
                { changed: true }
              )
            : this.realtime.publish(
                'office.comment.changed',
                { workspaceId, artifactId: event.resourceId },
                { changed: true }
              );
        if (!sent)
          throw new Error('Document comment invalidation delivery failed');
        return;
      }
      const comment = await this.models.comment.get(event.commentId);
      if (
        !comment ||
        comment.workspaceId !== workspaceId ||
        comment.docId !== event.resourceId
      )
        return;
      const rootEventId = event.rootEventId ?? row.id,
        audienceBefore = event.audienceBefore ?? row.createdAt.toISOString();
      const recipients = new Set(event.afterUserId ? [] : event.mentions);
      const owner = await this.models.docUser.getOwner(
        workspaceId,
        event.resourceId
      );
      if (owner && !event.afterUserId) recipients.add(owner.userId);
      let nextUserId: string | undefined;
      if (event.replyId) {
        if (!event.afterUserId) recipients.add(comment.userId);
        const replies = await this.models.documentComments.replyRecipients(
          comment.id,
          new Date(audienceBefore),
          event.afterUserId,
          51
        );
        replies.slice(0, 50).forEach(reply => recipients.add(reply.userId));
        if (replies.length > 50) nextUserId = replies[49].userId;
      }
      for (const userId of recipients) {
        if (
          userId === event.actorId ||
          !(await this.ac
            .user(userId)
            .workspace(workspaceId)
            .doc(event.resourceId)
            .projectScope(null)
            .can('Doc.Comments.Read'))
        )
          continue;
        await this.queue.add(
          'notification.sendComment',
          {
            userId,
            deliveryKey: rootEventId,
            isMention: event.mentions.includes(userId),
            body: {
              workspaceId,
              createdByUserId: event.actorId,
              commentId: comment.id,
              replyId: event.replyId ?? undefined,
              doc: {
                id: event.resourceId,
                title: event.title.slice(0, 255),
                mode: event.mode === 'page' ? DocMode.page : DocMode.edgeless,
              },
            },
          },
          {
            jobId: `document-event:${rootEventId}:${userId}`,
            removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10000 },
          }
        );
      }
      if (nextUserId)
        return {
          id: createHash('sha256')
            .update(JSON.stringify([rootEventId, nextUserId]))
            .digest('hex'),
          payload: {
            ...event,
            rootEventId,
            afterUserId: nextUserId,
            audienceBefore,
          },
        };
      return;
    });
  }
}
