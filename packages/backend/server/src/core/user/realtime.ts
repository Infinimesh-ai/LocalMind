import type {
  CurrentUserProfileSnapshot,
  UserSettingsSnapshot,
} from '@affine/realtime';
import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { z } from 'zod';

import { AuthenticationRequired, OnEvent, UserNotFound } from '../../base';
import { Feature, Models } from '../../models';
import { sessionUser } from '../auth/service';
import { AvailableUserFeatureConfig } from '../features/types';
import { registerRealtimeLiveQuery } from '../realtime/provider';
import { RealtimePublisher } from '../realtime/publisher';
import { RealtimeRegistry } from '../realtime/registry';
import {
  realtimeUserProfileRoom,
  realtimeUserPublicProfileRoom,
  realtimeUserSettingsRoom,
} from '../realtime/rooms';

const emptyInput = z.object({}).strict();
// Bounds a single socket.io fan-out; large audiences are sent in batches.
const PUBLIC_PROFILE_ROOM_BATCH = 500;

function assertAuthenticated(user?: { id: string }) {
  if (!user) {
    throw new AuthenticationRequired();
  }
  return user;
}

@Injectable()
export class UserRealtimeProvider
  extends AvailableUserFeatureConfig
  implements OnModuleInit
{
  constructor(
    private readonly models: Models,
    @Optional() private readonly registry?: RealtimeRegistry,
    @Optional() private readonly publisher?: RealtimePublisher
  ) {
    super();
  }

  onModuleInit() {
    if (!this.registry) return;

    registerRealtimeLiveQuery(this.registry, {
      request: {
        name: 'user.profile.get',
        input: emptyInput,
        handle: async user => ({
          user: user ? await this.getProfile(user.id) : null,
        }),
      },
      topic: {
        name: 'user.profile.changed',
        input: emptyInput,
        authorize: async () => {},
        room: user => {
          if (!user) {
            throw new Error('Authenticated user is required');
          }
          return realtimeUserProfileRoom(user.id);
        },
      },
    });

    registerRealtimeLiveQuery(this.registry, {
      request: {
        name: 'user.settings.get',
        input: emptyInput,
        handle: async user => ({
          settings: await this.getSettings(assertAuthenticated(user).id),
        }),
      },
      topic: {
        name: 'user.settings.changed',
        input: emptyInput,
        authorize: async () => {},
        room: user => {
          if (!user) {
            throw new Error('Authenticated user is required');
          }
          return realtimeUserSettingsRoom(user.id);
        },
      },
    });

    // Subscribers only ever join their own room; the server decides who is
    // told about which user ids, so the topic cannot be used to probe others.
    this.registry.registerTopic({
      name: 'user.public-profile.changed',
      input: emptyInput,
      authorize: async () => {},
      room: user => {
        if (!user) {
          throw new Error('Authenticated user is required');
        }
        return realtimeUserPublicProfileRoom(user.id);
      },
    });
  }

  @OnEvent('user.updated', { suppressError: true })
  onUserUpdated(user: Events['user.updated']) {
    this.publisher?.publishChanged('user.profile.changed', {}, 'user-updated', {
      room: realtimeUserProfileRoom(user.id),
    });
  }

  @OnEvent('user.publicProfile.updated', { suppressError: true })
  async onUserPublicProfileUpdated({
    userId,
  }: Events['user.publicProfile.updated']) {
    await this.publishPublicProfileChanged(userId, 'user-updated');
  }

  @OnEvent('user.disabled', { suppressError: true })
  async onUserDisabled({ id }: Events['user.disabled']) {
    await this.publishPublicProfileChanged(id, 'user-disabled');
  }

  private async publishPublicProfileChanged(userId: string, reason: string) {
    if (!this.publisher) return;
    const audience = await this.models.user.getPublicProfileAudience(userId);
    for (
      let offset = 0;
      offset < audience.length;
      offset += PUBLIC_PROFILE_ROOM_BATCH
    ) {
      this.publisher.publish(
        'user.public-profile.changed',
        {},
        { changed: true, reason, userIds: [userId] },
        {
          rooms: audience
            .slice(offset, offset + PUBLIC_PROFILE_ROOM_BATCH)
            .map(realtimeUserPublicProfileRoom),
        }
      );
    }
  }

  @OnEvent('user.settings.updated', { suppressError: true })
  onUserSettingsUpdated({ userId }: Events['user.settings.updated']) {
    this.publisher?.publishChanged(
      'user.settings.changed',
      {},
      'settings-updated',
      { room: realtimeUserSettingsRoom(userId) }
    );
  }

  private async getProfile(
    userId: string
  ): Promise<CurrentUserProfileSnapshot> {
    const user = await this.models.user.get(userId);
    if (!user) {
      throw new UserNotFound();
    }
    const current = sessionUser(user);
    return {
      id: current.id,
      name: current.name,
      email: current.email,
      emailVerified: current.emailVerified,
      hasPassword: current.hasPassword,
      avatarUrl: current.avatarUrl ?? null,
      features: (
        await this.models.userFeature.list(
          userId,
          undefined,
          Array.from(this.availableUserFeatures())
        )
      )
        .filter(feature => this.availableUserFeatures().has(feature))
        .map(feature => this.serializeFeature(feature)),
    };
  }

  private serializeFeature(feature: string) {
    return (
      Object.entries(Feature).find(([, value]) => value === feature)?.[0] ??
      feature
    );
  }

  private async getSettings(userId: string): Promise<UserSettingsSnapshot> {
    return await this.models.userSettings.get(userId);
  }
}
