import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';

import { EventBus } from '../../base';
import { Models } from '../../models';
import { PermissionAccess } from '../permission';
import { RealtimePublisher, RealtimeRegistry } from '../realtime';

@Injectable()
export class WorkspaceNativeResourceRealtime implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceNativeResourceRealtime.name);
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly registry: RealtimeRegistry,
    private readonly publisher: RealtimePublisher,
    private readonly events: EventBus,
    private readonly cls: ClsService
  ) {}

  onModuleInit() {
    this.registry.registerTopic({
      name: 'workspace.nativeResources.changed',
      input: z.object({ workspaceId: z.string().min(1).max(512) }).strict(),
      authorize: async (user, input) => {
        await this.ac
          .user(user.id)
          .workspace(input.workspaceId)
          .assert('Workspace.Blobs.Read');
      },
      room: (_user, input) => `workspace:${input.workspaceId}:native-resources`,
    });
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async publish() {
    try {
      await this.models.workspaceNativeResource.deliverChanges(async row => {
        await this.cls.run({ ifNested: 'override' }, async () => {
          this.publisher.publish(
            'workspace.nativeResources.changed',
            { workspaceId: row.workspaceId },
            { changed: true }
          );
          await this.events.emitAsync('workspace.blobs.updated', {
            workspaceId: row.workspaceId,
          });
        });
      });
    } catch {
      this.logger.warn('Workspace native resource notifications deferred');
    }
  }
}
