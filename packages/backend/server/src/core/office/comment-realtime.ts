import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { RealtimePublisher, RealtimeRegistry } from '../realtime';
import { OfficeCommentService } from './comment-service';
import { resolveOfficeCommentOwner } from './comment-types';

@Injectable()
export class OfficeCommentRealtimeProvider implements OnModuleInit {
  constructor(
    private readonly comments: OfficeCommentService,
    private readonly registry: RealtimeRegistry
  ) {}
  onModuleInit() {
    this.registry.registerTopic({
      name: 'office.comment.changed',
      input: z
        .object({
          artifactId: z.string().min(1).max(512),
          workspaceId: z.string().min(1).max(512).optional(),
          projectId: z.string().min(1).max(512).optional(),
        })
        .strict()
        .refine(
          input => Boolean(input.workspaceId) !== Boolean(input.projectId)
        ),
      authorize: async (user, input) => {
        await this.comments.assertRead(
          resolveOfficeCommentOwner(undefined, input),
          user.id,
          input.artifactId
        );
      },
      room: (_user, input) =>
        `office-comments:${JSON.stringify([input.workspaceId ?? null, input.projectId ?? null, input.artifactId])}`,
    });
  }
}

export function publishOfficeCommentChanged(
  publisher: RealtimePublisher,
  comment: {
    workspaceId: string | null;
    projectId: string | null;
    docId: string;
  }
) {
  const input = comment.projectId
    ? { projectId: comment.projectId, artifactId: comment.docId }
    : comment.workspaceId
      ? { workspaceId: comment.workspaceId, artifactId: comment.docId }
      : null;
  if (!input) throw new Error('Office comments have exactly one owner');
  publisher.publish('office.comment.changed', input, { changed: true });
}
